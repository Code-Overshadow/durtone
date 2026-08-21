package main

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestTokenBucketLimiter(t *testing.T) {
	limiter := newTokenBucketLimiter(1, 2)
	if !limiter.allow("client", time.Now()) || !limiter.allow("client", time.Now()) {
		t.Fatal("expected burst requests to pass")
	}
	if limiter.allow("client", time.Now()) {
		t.Fatal("expected third request to be limited")
	}
}

func TestDurtWallBlocksSQLInjection(t *testing.T) {
	server, err := newServer(defaultConfig())
	if err != nil {
		t.Fatal(err)
	}
	defer server.logger.close()
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
	config.Upstream = upstream.URL
	config.RulesFile = ""
	config.Mode = "monitor"
	server, err := newServer(config)
	if err != nil {
		t.Fatal(err)
	}
	defer server.logger.close()
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
	config.Upstream = upstream.URL
	config.RulesFile = ""
	config.Honeytokens = true
	server, err := newServer(config)
	if err != nil {
		t.Fatal(err)
	}
	defer server.logger.close()
	response := httptest.NewRecorder()
	server.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "http://durtwall.local/data", nil))
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "durtone_honeytoken") {
		t.Fatalf("unexpected JSON response: %d %q", response.Code, response.Body.String())
	}
}

func TestStealthModeReturnsEmptyOK(t *testing.T) {
	config := defaultConfig()
	config.Stealth = true
	server, err := newServer(config)
	if err != nil {
		t.Fatal(err)
	}
	defer server.logger.close()
	response := httptest.NewRecorder()
	server.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "http://durtwall.local/?id=1%27%20OR%20%271%27=%271", nil))
	if response.Code != http.StatusOK || response.Body.Len() != 0 {
		t.Fatalf("expected empty 200 stealth response, got %d %q", response.Code, response.Body.String())
	}
}

type fakeHoneypotManager struct{}

func (fakeHoneypotManager) Start(context.Context) (string, func(), error) {
	return "http://honeypot.local", func() {}, nil
}

func (fakeHoneypotManager) Close() {}
