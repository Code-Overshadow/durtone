package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestApplyRoutingTableBuildsRoutesAndSkipsInvalidEntries(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(writer, "ok")
	}))
	defer upstream.Close()

	config := defaultConfig()
	server, err := newServer(config)
	if err != nil {
		t.Fatal(err)
	}
	defer server.close()

	server.applyRoutingTable([]remoteRoute{
		{Hostname: "app.example.com", TenantID: "tenant-1", Upstream: upstream.URL, Mode: "monitor", Settings: map[string]interface{}{"stealth": true}},
		{Hostname: "", TenantID: "tenant-2", Upstream: upstream.URL, Mode: "block"},          // missing hostname, skipped
		{Hostname: "broken.example.com", TenantID: "tenant-3", Upstream: "not-a-url", Mode: "block"}, // invalid upstream, skipped
		{Hostname: "unknown-mode.example.com", TenantID: "tenant-4", Upstream: upstream.URL, Mode: "whatever"},
	})

	table := *server.routes.Load()
	if len(table) != 2 {
		t.Fatalf("expected 2 valid routes, got %d: %+v", len(table), table)
	}
	route, ok := table["app.example.com"]
	if !ok {
		t.Fatal("expected app.example.com to be routed")
	}
	if route.tenantID != "tenant-1" || route.mode != "monitor" || !route.stealth {
		t.Fatalf("unexpected route: %+v", route)
	}
	if _, ok := table["broken.example.com"]; ok {
		t.Fatal("expected the route with an invalid upstream to be skipped")
	}
	fallback, ok := table["unknown-mode.example.com"]
	if !ok || fallback.mode != "block" {
		t.Fatalf("expected an unrecognized mode to default to block, got %+v", fallback)
	}
}

func TestPollRoutingTableOnceAppliesTheFleetResponse(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(writer, "polled")
	}))
	defer upstream.Close()

	var receivedAuth string
	controlPlane := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		receivedAuth = request.Header.Get("Authorization")
		if !strings.HasSuffix(request.URL.Path, "/api/v1/edge/routing-table") {
			writer.WriteHeader(http.StatusNotFound)
			return
		}
		writer.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(writer).Encode(routingTableResponse{Routes: []remoteRoute{
			{Hostname: "app.example.com", TenantID: "tenant-1", Upstream: upstream.URL, Mode: "block"},
		}})
	}))
	defer controlPlane.Close()

	config := defaultConfig()
	config.FleetToken = "fleet-secret"
	server, err := newServer(config)
	if err != nil {
		t.Fatal(err)
	}
	defer server.close()
	server.config.ControlPlaneURL = controlPlane.URL

	server.pollRoutingTableOnce(context.Background(), &http.Client{Timeout: 2 * time.Second})

	if receivedAuth != "Bearer fleet-secret" {
		t.Fatalf("expected the fleet token to be sent, got %q", receivedAuth)
	}
	table := *server.routes.Load()
	if _, ok := table["app.example.com"]; !ok {
		t.Fatalf("expected the polled route to be applied, got %+v", table)
	}
}
