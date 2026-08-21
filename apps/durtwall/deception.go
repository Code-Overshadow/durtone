package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/api/types/network"
	"github.com/moby/moby/client"
)

const honeytokenValue = "eyJhbGciOiJub25lIn0.durtone-honeytoken.invalid"

func isScanner(request *http.Request) bool {
	value := strings.ToLower(request.URL.Path)
	markers := []string{"/admin", "/backup", "/.env", "/.git", "/wp-login", "/phpmyadmin", "/server-status", "../", "/etc/passwd"}
	for _, marker := range markers {
		if strings.Contains(value, marker) {
			return true
		}
	}
	return false
}

type honeypotManager interface {
	Start(context.Context) (string, func(), error)
	Close()
}

type dockerHoneypotManager struct {
	client *client.Client
	image  string
	port   int
	mu     sync.Mutex
	url    string
	stop   func()
}

func newDockerHoneypotManager(config Config) (*dockerHoneypotManager, error) {
	dockerClient, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return nil, err
	}
	return &dockerHoneypotManager{client: dockerClient, image: config.HoneypotImage, port: config.HoneypotPort}, nil
}

func (manager *dockerHoneypotManager) Start(ctx context.Context) (string, func(), error) {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	if manager.url != "" {
		return manager.url, manager.stop, nil
	}
	port, err := network.ParsePort("80/tcp")
	if err != nil {
		return "", nil, err
	}
	pull, err := manager.client.ImagePull(ctx, manager.image, client.ImagePullOptions{})
	if err != nil {
		return "", nil, err
	}
	_, _ = io.Copy(io.Discard, pull)
	_ = pull.Close()
	created, err := manager.client.ContainerCreate(ctx, client.ContainerCreateOptions{
		Config:     &container.Config{Image: manager.image, ExposedPorts: network.PortSet{port: struct{}{}}},
		HostConfig: &container.HostConfig{PortBindings: network.PortMap{port: []network.PortBinding{{HostIP: netip.MustParseAddr("127.0.0.1"), HostPort: fmt.Sprintf("%d", manager.port)}}}},
		Name:       "durtone-honeypot",
	})
	if err != nil {
		return "", nil, err
	}
	if _, err := manager.client.ContainerStart(ctx, created.ID, client.ContainerStartOptions{}); err != nil {
		return "", nil, err
	}
	manager.url = (&url.URL{Scheme: "http", Host: fmt.Sprintf("127.0.0.1:%d", manager.port)}).String()
	manager.stop = func() {
		_, _ = manager.client.ContainerStop(context.Background(), created.ID, client.ContainerStopOptions{})
		_, _ = manager.client.ContainerRemove(context.Background(), created.ID, client.ContainerRemoveOptions{Force: true})
	}
	if err := waitForHoneypot(ctx, manager.url); err != nil {
		manager.stop()
		manager.url, manager.stop = "", nil
		return "", nil, err
	}
	return manager.url, manager.stop, nil
}

func (manager *dockerHoneypotManager) Close() {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	if manager.stop != nil {
		manager.stop()
		manager.url, manager.stop = "", nil
	}
}

func waitForHoneypot(ctx context.Context, target string) error {
	client := &http.Client{Timeout: 2 * time.Second}
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	for {
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
		if err == nil {
			response, requestErr := client.Do(request)
			if requestErr == nil {
				_ = response.Body.Close()
				if response.StatusCode < http.StatusInternalServerError {
					return nil
				}
			}
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

func injectHoneytoken(body []byte, contentType string) ([]byte, bool) {
	if !strings.Contains(strings.ToLower(contentType), "application/json") {
		return body, false
	}
	var document map[string]json.RawMessage
	if err := json.Unmarshal(body, &document); err != nil {
		return body, false
	}
	token, _ := json.Marshal(honeytokenValue)
	document["durtone_honeytoken"] = token
	result, err := json.Marshal(document)
	if err != nil {
		return body, false
	}
	return result, true
}

type bufferedResponseWriter struct {
	header http.Header
	status int
	body   []byte
}

func newBufferedResponseWriter() *bufferedResponseWriter {
	return &bufferedResponseWriter{header: make(http.Header)}
}
func (writer *bufferedResponseWriter) Header() http.Header { return writer.header }
func (writer *bufferedResponseWriter) WriteHeader(status int) {
	if writer.status == 0 {
		writer.status = status
	}
}
func (writer *bufferedResponseWriter) Write(body []byte) (int, error) {
	if writer.status == 0 {
		writer.status = http.StatusOK
	}
	writer.body = append(writer.body, body...)
	return len(body), nil
}
func (writer *bufferedResponseWriter) flushTo(target http.ResponseWriter) {
	for key, values := range writer.header {
		target.Header()[key] = values
	}
	if writer.status == 0 {
		writer.status = http.StatusOK
	}
	target.WriteHeader(writer.status)
	_, _ = target.Write(writer.body)
}

func proxyToURL(proxy http.Handler, target string, request *http.Request, writer http.ResponseWriter) error {
	parsed, err := url.Parse(target)
	if err != nil {
		return err
	}
	clone := request.Clone(request.Context())
	clone.URL.Scheme, clone.URL.Host = parsed.Scheme, parsed.Host
	proxy.ServeHTTP(writer, clone)
	return nil
}
