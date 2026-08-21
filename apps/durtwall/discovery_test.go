package main

import (
	"os"
	"testing"
)

func TestDiscoverEndpointsAndClassifiesShadowAPIs(t *testing.T) {
	directory := t.TempDir()
	logs := `{"method":"GET","path":"/users/42","status":200}
{"method":"GET","path":"/users/42","status":404}
{"method":"POST","path":"/internal/debug","status":200}
`
	logPath := directory + "\\durtwall.jsonl"
	openAPIPath := directory + "\\openapi.json"
	if err := os.WriteFile(logPath, []byte(logs), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(openAPIPath, []byte(`{"openapi":"3.0.0","paths":{"/users/{id}":{"get":{}}}}`), 0o600); err != nil {
		t.Fatal(err)
	}

	items, err := discoverEndpoints(logPath, openAPIPath)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 {
		t.Fatalf("expected 2 endpoints, got %d", len(items))
	}
	var users, shadow *endpoint
	for index := range items {
		if items[index].Path == "/users/42" {
			users = &items[index]
		}
		if items[index].Path == "/internal/debug" {
			shadow = &items[index]
		}
	}
	if users == nil || users.Count != 2 || users.StatusCodes["200"] != 1 || users.StatusCodes["404"] != 1 {
		t.Fatalf("unexpected user endpoint metrics: %+v", users)
	}
	if shadow == nil || !shadow.Shadow || shadow.Documented {
		t.Fatalf("expected internal endpoint to be shadow: %+v", shadow)
	}
}

func TestOpenAPIPathMatching(t *testing.T) {
	documented := map[string]map[string]struct{}{"GET": {"/orders/{orderId}": {}}}
	if !matchesDocumentedPath(documented, "GET", "/orders/abc") {
		t.Fatal("expected path parameter to match")
	}
	if matchesDocumentedPath(documented, "POST", "/orders/abc") {
		t.Fatal("expected method mismatch")
	}
}
