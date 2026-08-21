package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestApplyRemoteConfigUpdatesModeAndUpstream(t *testing.T) {
	initialUpstream := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(writer, "initial")
	}))
	defer initialUpstream.Close()
	newUpstream := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(writer, "new-upstream")
	}))
	defer newUpstream.Close()

	config := defaultConfig()
	config.Upstream = initialUpstream.URL
	config.RulesFile = ""
	config.Mode = "block"
	server, err := newServer(config)
	if err != nil {
		t.Fatal(err)
	}
	defer server.close()

	server.applyRemoteConfig(remoteConfig{Upstream: newUpstream.URL, Mode: "monitor"})

	state := server.live.Load()
	if state.mode != "monitor" {
		t.Fatalf("expected mode to be updated to monitor, got %q", state.mode)
	}
	if state.upstream != newUpstream.URL {
		t.Fatalf("expected upstream to be updated to %q, got %q", newUpstream.URL, state.upstream)
	}

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "http://durtwall.local/?id=1%27%20OR%20%271%27=%271", nil)
	server.ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "new-upstream") {
		t.Fatalf("expected request to reach the new upstream in monitor mode, got %d %q", response.Code, response.Body.String())
	}
}

func TestPollConfigOnceAppliesRemoteConfig(t *testing.T) {
	newUpstream := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(writer, "polled-upstream")
	}))
	defer newUpstream.Close()

	controlPlane := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "Bearer test-token" {
			writer.WriteHeader(http.StatusUnauthorized)
			return
		}
		writer.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(writer).Encode(remoteConfig{Upstream: newUpstream.URL, Mode: "monitor"})
	}))
	defer controlPlane.Close()

	config := defaultConfig()
	config.RulesFile = ""
	config.ControlPlaneToken = "test-token"
	server, err := newServer(config)
	if err != nil {
		t.Fatal(err)
	}
	defer server.close()
	server.config.ControlPlaneURL = controlPlane.URL

	server.pollConfigOnce(&http.Client{Timeout: 2 * time.Second})

	state := server.live.Load()
	if state.mode != "monitor" || state.upstream != newUpstream.URL {
		t.Fatalf("expected polled config to be applied, got mode=%q upstream=%q", state.mode, state.upstream)
	}
}
