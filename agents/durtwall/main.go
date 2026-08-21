package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strconv"
	"time"
)

func main() {
	configPath := flag.String("config", "config.yaml", "path to the DurtWall YAML configuration")
	discover := flag.Bool("discover", false, "analyze DurtWall JSON logs instead of starting the proxy")
	logsPath := flag.String("logs", "", "JSON log file to analyze with -discover")
	openAPIPath := flag.String("openapi", "", "OpenAPI JSON file used to identify Shadow APIs")
	outputPath := flag.String("output", "", "optional JSON output path for discovered endpoints")
	webhook := flag.String("webhook", "", "optional webhook URL for Shadow API alerts")
	flag.Parse()
	if *discover {
		if *logsPath == "" {
			log.Fatal("-logs is required with -discover")
		}
		items, err := discoverEndpoints(*logsPath, *openAPIPath)
		if err != nil {
			log.Fatal(err)
		}
		data, err := json.MarshalIndent(items, "", "  ")
		if err != nil {
			log.Fatal(err)
		}
		if *outputPath != "" {
			if err := os.WriteFile(*outputPath, data, 0o600); err != nil {
				log.Fatal(err)
			}
		} else {
			fmt.Println(string(data))
		}
		if err := sendShadowAlerts(*webhook, items); err != nil {
			log.Fatal(err)
		}
		return
	}
	config, err := loadConfigIfPresent(*configPath)
	if err != nil {
		log.Fatal(err)
	}
	server, err := newServer(config)
	if err != nil {
		log.Fatal(err)
	}
	defer server.close()
	address := ":" + strconv.Itoa(config.Port)
	log.Printf("DurtWall agent listening on http://localhost%s -> %s (%s)", address, config.Upstream, config.Mode)
	log.Fatal(http.ListenAndServe(address, server))
}

func loadConfigIfPresent(path string) (Config, error) {
	if _, err := os.Stat(path); err != nil {
		if os.IsNotExist(err) {
			return loadConfig("")
		}
		return Config{}, err
	}
	return loadConfig(path)
}

type proxyServer struct {
	config   Config
	proxy    *httputil.ReverseProxy
	limiter  *tokenBucketLimiter
	waf      *wafEngine
	logger   *requestLogger
	honeypot honeypotManager
}

func (server *proxyServer) close() {
	if server.honeypot != nil {
		server.honeypot.Close()
	}
	_ = server.logger.close()
}

func newServer(config Config) (*proxyServer, error) {
	upstream, err := url.Parse(config.Upstream)
	if err != nil || upstream.Scheme == "" || upstream.Host == "" {
		return nil, fmt.Errorf("invalid upstream URL: %s", config.Upstream)
	}
	waf, err := newWAF(config)
	if err != nil {
		return nil, err
	}
	logger, err := newRequestLogger(config.LogFile, config.ControlPlaneURL, config.ControlPlaneToken)
	if err != nil {
		return nil, err
	}
	var honeypot honeypotManager
	if config.Honeypot {
		honeypot, err = newDockerHoneypotManager(config)
		if err != nil {
			return nil, fmt.Errorf("create honeypot manager: %w", err)
		}
	}
	return &proxyServer{config: config, proxy: httputil.NewSingleHostReverseProxy(upstream), limiter: newTokenBucketLimiter(config.RateLimit, config.RateBurst), waf: waf, logger: logger, honeypot: honeypot}, nil
}

func (server *proxyServer) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	started := time.Now()
	if !server.limiter.allow(clientKey(request), started) {
		server.logger.request(request, http.StatusTooManyRequests, elapsedMilliseconds(started), true, "rate_limit")
		writeJSONError(writer, http.StatusTooManyRequests, "rate limit exceeded")
		return
	}
	if server.honeypot != nil && isScanner(request) {
		honeypotURL, _, err := server.honeypot.Start(context.Background())
		if err != nil {
			server.logger.request(request, http.StatusServiceUnavailable, elapsedMilliseconds(started), true, "honeypot_error")
			writeJSONError(writer, http.StatusServiceUnavailable, "honeypot unavailable")
			return
		}
		if err := proxyToURL(server.proxy, honeypotURL, request, writer); err != nil {
			server.logger.request(request, http.StatusBadGateway, elapsedMilliseconds(started), true, "honeypot_proxy_error")
			writeJSONError(writer, http.StatusBadGateway, "honeypot proxy failed")
			return
		}
		server.logger.request(request, http.StatusOK, elapsedMilliseconds(started), true, "honeypot")
		return
	}
	interruption, err := server.waf.inspect(request)
	if err != nil {
		server.logger.request(request, http.StatusInternalServerError, elapsedMilliseconds(started), true, "waf_error")
		writeJSONError(writer, http.StatusInternalServerError, "WAF inspection failed")
		return
	}
	if interruption != nil && server.config.Mode == "block" {
		status := interruption.Status
		if status == 0 {
			status = http.StatusForbidden
		}
		if server.config.Stealth {
			server.logger.request(request, http.StatusOK, elapsedMilliseconds(started), true, "stealth")
			writer.WriteHeader(http.StatusOK)
			return
		}
		server.logger.request(request, status, elapsedMilliseconds(started), true, "waf")
		writeJSONError(writer, status, "request blocked by DurtWall")
		return
	}
	if server.config.Honeytokens {
		buffer := newBufferedResponseWriter()
		server.proxy.ServeHTTP(buffer, request)
		body, injected := injectHoneytoken(buffer.body, buffer.header.Get("Content-Type"))
		if injected {
			buffer.body = body
			buffer.header.Set("Content-Length", strconv.Itoa(len(body)))
		}
		buffer.flushTo(writer)
		server.logger.request(request, buffer.status, elapsedMilliseconds(started), interruption != nil, reasonFor(interruption))
		return
	}
	statusWriter := &responseStatusWriter{ResponseWriter: writer}
	server.proxy.ServeHTTP(statusWriter, request)
	server.logger.request(request, statusWriter.status(), elapsedMilliseconds(started), interruption != nil, reasonFor(interruption))
}

func elapsedMilliseconds(started time.Time) int { return int(time.Since(started) / time.Millisecond) }
func reasonFor(interruption interface{}) string {
	if interruption != nil {
		return "waf_monitor"
	}
	return ""
}

type responseStatusWriter struct {
	http.ResponseWriter
	code int
}

func (writer *responseStatusWriter) WriteHeader(code int) {
	writer.code = code
	writer.ResponseWriter.WriteHeader(code)
}
func (writer *responseStatusWriter) Write(body []byte) (int, error) {
	if writer.code == 0 {
		writer.code = http.StatusOK
	}
	return writer.ResponseWriter.Write(body)
}
func (writer *responseStatusWriter) status() int {
	if writer.code == 0 {
		return http.StatusOK
	}
	return writer.code
}
