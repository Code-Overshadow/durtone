package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestBestMatchingEndpointPrefersSameMethodAndDepthAndDocumented(t *testing.T) {
	known := []knownEndpoint{
		{method: "GET", path: "/api/orders/9", documented: false},
		{method: "GET", path: "/api/users/17", documented: true},
		{method: "POST", path: "/api/users/17", documented: true},
		{method: "GET", path: "/api/users/17/profile", documented: true},
	}

	match := bestMatchingEndpoint(known, "GET", "/api/users/999999")
	if match == nil || match.path != "/api/users/17" || !match.documented {
		t.Fatalf("expected the documented, same-depth GET /api/users/{id} to win, got %+v", match)
	}

	if got := bestMatchingEndpoint(known, "DELETE", "/api/users/1"); got != nil {
		t.Fatalf("expected no match for a method never observed, got %+v", got)
	}
}

func TestSyntheticBodyReflectsRequestPathAndMatch(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "http://durtwall.local/api/users/42", nil)
	match := &knownEndpoint{method: "GET", path: "/api/users/17", documented: true}

	body := syntheticBody(request, match)
	var decoded map[string]interface{}
	if err := json.Unmarshal(body, &decoded); err != nil {
		t.Fatalf("expected valid JSON, got %q: %v", body, err)
	}
	if decoded["id"] != "42" {
		t.Fatalf("expected the id to come from the request path, got %v", decoded["id"])
	}
	if decoded["path"] != "/api/users/17" {
		t.Fatalf("expected the matched endpoint's path to be reflected, got %v", decoded["path"])
	}
}

func TestSyntheticStatusCode(t *testing.T) {
	if got := syntheticStatusCode(http.MethodPost, nil); got != http.StatusCreated {
		t.Fatalf("expected 201 for an unmatched POST, got %d", got)
	}
	if got := syntheticStatusCode(http.MethodDelete, nil); got != http.StatusNoContent {
		t.Fatalf("expected 204 for an unmatched DELETE, got %d", got)
	}
	match := &knownEndpoint{method: "POST", path: "/api/users"}
	if got := syntheticStatusCode(http.MethodPost, match); got != http.StatusOK {
		t.Fatalf("expected 200 when a known endpoint matched, got %d", got)
	}
}

// TestSyntheticHoneypotEndToEnd exercises the default (no config.Honeypot) path through the real
// ServeHTTP: a scan against a route with DurtShield-known endpoints gets a synthetic, honeytoken-
// bearing JSON response shaped like the tenant's real /api/users/{id}, entirely in-process.
func TestSyntheticHoneypotEndToEnd(t *testing.T) {
	server, err := newServer(defaultConfig())
	if err != nil {
		t.Fatal(err)
	}
	defer server.close()
	seedRoute(t, server, "durtwall.local", "tenant-1", "http://127.0.0.1:1", "block", false, false)
	table := *server.routes.Load()
	table["durtwall.local"].knownEndpoints = []knownEndpoint{
		{method: "GET", path: "/admin/users/17", documented: true},
	}

	response := httptest.NewRecorder()
	server.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "http://durtwall.local/admin/users/999", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200 from the synthetic honeypot, got %d", response.Code)
	}
	if !strings.Contains(response.Body.String(), "durtone_honeytoken") {
		t.Fatalf("expected the honeytoken to be injected, got %q", response.Body.String())
	}
	var decoded map[string]interface{}
	if err := json.Unmarshal(response.Body.Bytes(), &decoded); err != nil {
		t.Fatalf("expected valid JSON from the synthetic honeypot: %v", err)
	}
	if decoded["path"] != "/admin/users/17" {
		t.Fatalf("expected the response to be shaped after the matching known endpoint, got %v", decoded["path"])
	}
}
