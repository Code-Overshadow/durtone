package main

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"strings"
	"testing"
	"time"
)

// seedRoute installs a single-entry routing table directly, bypassing the poll loop - the same
// atomic swap the real poller uses (routing.go's applyRoutingTable), just with test-controlled data.
func seedRoute(t *testing.T, server *proxyServer, hostname, tenantID, upstreamURL, mode string, stealth, honeytokens bool) {
	parsed, err := url.Parse(upstreamURL)
	if err != nil {
		t.Fatalf("invalid test upstream URL %q: %v", upstreamURL, err)
	}
	table := routingTable{
		hostname: {
			tenantID:    tenantID,
			mode:        mode,
			upstream:    upstreamURL,
			stealth:     stealth,
			honeytokens: honeytokens,
			proxy:       httputil.NewSingleHostReverseProxy(parsed),
		},
	}
	server.routes.Store(&table)
}

func TestTokenBucketLimiter(t *testing.T) {
	limiter := newTokenBucketLimiter(1, 2)
	if !limiter.allow("client", time.Now()) || !limiter.allow("client", time.Now()) {
		t.Fatal("expected burst requests to pass")
	}
	if limiter.allow("client", time.Now()) {
		t.Fatal("expected third request to be limited")
	}
}

func TestUnknownHostReturns404(t *testing.T) {
	server, err := newServer(defaultConfig())
	if err != nil {
		t.Fatal(err)
	}
	defer server.close()
	response := httptest.NewRecorder()
	server.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "http://nobody-configured-this.example.com/", nil))
	if response.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for an unrecognized host, got %d", response.Code)
	}
}

func TestMultiTenantHostRouting(t *testing.T) {
	upstreamA := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(writer, "tenant-a")
	}))
	defer upstreamA.Close()
	upstreamB := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(writer, "tenant-b")
	}))
	defer upstreamB.Close()

	config := defaultConfig()
	config.RulesFile = ""
	server, err := newServer(config)
	if err != nil {
		t.Fatal(err)
	}
	defer server.close()

	parsedA, _ := url.Parse(upstreamA.URL)
	parsedB, _ := url.Parse(upstreamB.URL)
	server.routes.Store(&routingTable{
		"a.test": {tenantID: "tenant-a", mode: "monitor", upstream: upstreamA.URL, proxy: httputil.NewSingleHostReverseProxy(parsedA)},
		"b.test": {tenantID: "tenant-b", mode: "monitor", upstream: upstreamB.URL, proxy: httputil.NewSingleHostReverseProxy(parsedB)},
	})

	responseA := httptest.NewRecorder()
	server.ServeHTTP(responseA, httptest.NewRequest(http.MethodGet, "http://a.test/", nil))
	if responseA.Body.String() != "tenant-a" {
		t.Fatalf("expected Host a.test to reach tenant A's upstream, got %q", responseA.Body.String())
	}

	responseB := httptest.NewRecorder()
	server.ServeHTTP(responseB, httptest.NewRequest(http.MethodGet, "http://b.test/", nil))
	if responseB.Body.String() != "tenant-b" {
		t.Fatalf("expected Host b.test to reach tenant B's upstream, got %q", responseB.Body.String())
	}
}

func TestDurtWallBlocksSQLInjection(t *testing.T) {
	server, err := newServer(defaultConfig())
	if err != nil {
		t.Fatal(err)
	}
	defer server.close()
	seedRoute(t, server, "durtwall.local", "tenant-1", "http://127.0.0.1:1", "block", false, false)
	request := httptest.NewRequest(http.MethodGet, "http://durtwall.local/?id=1%27%20OR%20%271%27=%271", nil)
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", response.Code, response.Body.String())
	}
}

func TestDurtWallProxiesSafeRequest(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		body, _ := io.ReadAll(request.Body)
		_, _ = io.WriteString(writer, "upstream ok "+string(body))
	}))
	defer upstream.Close()
	config := defaultConfig()
	config.RulesFile = ""
	server, err := newServer(config)
	if err != nil {
		t.Fatal(err)
	}
	defer server.close()
	seedRoute(t, server, "durtwall.local", "tenant-1", upstream.URL, "monitor", false, false)
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "http://durtwall.local/health", strings.NewReader(`{"safe":true}`))
	request.Header.Set("Content-Type", "application/json")
	server.ServeHTTP(response, request)
	if !strings.Contains(response.Body.String(), `upstream ok {"safe":true}`) {
		t.Fatalf("unexpected upstream response: %q", response.Body.String())
	}
}

func TestScannerDetection(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "http://durtwall.local/admin/backup", nil)
	if !isScanner(request) {
		t.Fatal("expected scanner path to be detected")
	}
}

func TestHoneytokenInjection(t *testing.T) {
	body, injected := injectHoneytoken([]byte(`{"ok":true}`), "application/json")
	if !injected || !strings.Contains(string(body), "durtone_honeytoken") {
		t.Fatalf("expected honeytoken in response: %s", body)
	}
	if _, injected := injectHoneytoken([]byte(`plain`), "text/plain"); injected {
		t.Fatal("did not expect injection for non-JSON response")
	}
}

func TestDurtWallInjectsHoneytokenIntoJSONResponse(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(writer, `{"ok":true}`)
	}))
	defer upstream.Close()
	config := defaultConfig()
	config.RulesFile = ""
	server, err := newServer(config)
	if err != nil {
		t.Fatal(err)
	}
	defer server.close()
	seedRoute(t, server, "durtwall.local", "tenant-1", upstream.URL, "block", false, true)
	response := httptest.NewRecorder()
	server.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "http://durtwall.local/data", nil))
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "durtone_honeytoken") {
		t.Fatalf("unexpected JSON response: %d %q", response.Code, response.Body.String())
	}
}

func TestStealthModeReturnsEmptyOK(t *testing.T) {
	config := defaultConfig()
	server, err := newServer(config)
	if err != nil {
		t.Fatal(err)
	}
	defer server.close()
	seedRoute(t, server, "durtwall.local", "tenant-1", "http://127.0.0.1:1", "block", true, false)
	response := httptest.NewRecorder()
	server.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "http://durtwall.local/?id=1%27%20OR%20%271%27=%271", nil))
	if response.Code != http.StatusOK || response.Body.Len() != 0 {
		t.Fatalf("expected empty 200 stealth response, got %d %q", response.Code, response.Body.String())
	}
}

// fakeHoneypotManager proves honeypotStrategy is genuinely swappable (see honeypot.go) - a future
// Fly Machines-backed strategy just needs to satisfy this same interface.
type fakeHoneypotManager struct{}

func (fakeHoneypotManager) Respond(_ context.Context, _ *tenantRoute, _ *http.Request, writer http.ResponseWriter) (int, error) {
	writer.WriteHeader(http.StatusTeapot)
	return http.StatusTeapot, nil
}

func (fakeHoneypotManager) Close() {}

func (fakeHoneypotManager) Healthy(context.Context) bool { return true }

func TestHoneypotStrategyIsSwappable(t *testing.T) {
	server, err := newServer(defaultConfig())
	if err != nil {
		t.Fatal(err)
	}
	defer server.close()
	server.honeypot = fakeHoneypotManager{}
	seedRoute(t, server, "durtwall.local", "tenant-1", "http://127.0.0.1:1", "block", false, false)

	response := httptest.NewRecorder()
	server.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "http://durtwall.local/admin/backup", nil))
	if response.Code != http.StatusTeapot {
		t.Fatalf("expected ServeHTTP to dispatch the scan to the swapped-in honeypot strategy, got %d", response.Code)
	}
}
