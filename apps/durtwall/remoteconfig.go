package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"time"
)

const configPollInterval = 15 * time.Second

type remoteConfig struct {
	Upstream string `json:"upstream"`
	Mode     string `json:"mode"`
}

func (server *proxyServer) startConfigPolling() {
	if server.config.ControlPlaneURL == "" || server.config.ControlPlaneToken == "" {
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	server.stopPoll = cancel
	go server.pollConfigLoop(ctx)
}

func (server *proxyServer) pollConfigLoop(ctx context.Context) {
	client := &http.Client{Timeout: 5 * time.Second}
	ticker := time.NewTicker(configPollInterval)
	defer ticker.Stop()
	server.pollConfigOnce(client)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			server.pollConfigOnce(client)
		}
	}
}

func (server *proxyServer) pollConfigOnce(client *http.Client) {
	request, err := http.NewRequest(http.MethodGet, server.config.ControlPlaneURL+"/api/v1/agents/config", nil)
	if err != nil {
		return
	}
	request.Header.Set("Authorization", "Bearer "+server.config.ControlPlaneToken)
	response, err := client.Do(request)
	if err != nil {
		log.Printf("durtwall: config poll failed: %v", err)
		return
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		log.Printf("durtwall: config poll returned status %d", response.StatusCode)
		return
	}
	var remote remoteConfig
	if err := json.NewDecoder(response.Body).Decode(&remote); err != nil {
		log.Printf("durtwall: config poll decode failed: %v", err)
		return
	}
	server.applyRemoteConfig(remote)
}

func (server *proxyServer) applyRemoteConfig(remote remoteConfig) {
	current := server.live.Load()
	mode := current.mode
	if remote.Mode == "block" || remote.Mode == "monitor" {
		mode = remote.Mode
	}
	upstream := current.upstream
	proxy := current.proxy
	if remote.Upstream != "" && remote.Upstream != current.upstream {
		if parsed, err := url.Parse(remote.Upstream); err == nil && parsed.Scheme != "" && parsed.Host != "" {
			upstream = remote.Upstream
			proxy = httputil.NewSingleHostReverseProxy(parsed)
		}
	}
	if mode == current.mode && upstream == current.upstream {
		return
	}
	server.live.Store(&liveState{mode: mode, upstream: upstream, proxy: proxy})
	log.Printf("durtwall: applied remote config (mode=%s upstream=%s)", mode, upstream)
}
