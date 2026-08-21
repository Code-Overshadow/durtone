package main

import (
	"context"
	"net/http"
	"os"
	"testing"
	"time"
)

func TestDockerHoneypotIntegration(t *testing.T) {
	if os.Getenv("DURTWALL_DOCKER_INTEGRATION") != "1" {
		t.Skip("set DURTWALL_DOCKER_INTEGRATION=1 to run against Docker Desktop")
	}
	config := defaultConfig()
	config.HoneypotImage = "nginx:alpine"
	config.HoneypotPort = 18081
	manager, err := newDockerHoneypotManager(config)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	honeypotURL, cleanup, err := manager.Start(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, honeypotURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	client := &http.Client{Timeout: 20 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("expected honeypot HTTP 200, got %d", response.StatusCode)
	}
}
