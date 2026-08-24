package main

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"time"
)

const routingPollInterval = 15 * time.Second

type remoteEndpointHint struct {
	Method     string `json:"method"`
	Path       string `json:"path"`
	Documented bool   `json:"documented"`
}

type remoteRoute struct {
	Hostname        string                 `json:"hostname"`
	TenantID        string                 `json:"tenantId"`
	Upstream        string                 `json:"upstream"`
	Mode            string                 `json:"mode"`
	AlertWebhookURL string                 `json:"alertWebhookUrl"`
	Settings        map[string]interface{} `json:"settings"`
	// KnownEndpoints is DurtShield's discovered-endpoint data for this tenant, used by the
	// synthetic honeypot (honeypot.go) to mimic the tenant's real API shape instead of a generic
	// decoy. Populated by apps/api's storage.listActiveRoutes.
	KnownEndpoints []remoteEndpointHint `json:"knownEndpoints"`
}

type routingTableResponse struct {
	Routes []remoteRoute `json:"routes"`
}

func (server *proxyServer) startRoutingPoll() {
	if server.config.ControlPlaneURL == "" || server.config.FleetToken == "" {
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	server.stopPoll = cancel
	go server.routingPollLoop(ctx)
}

func (server *proxyServer) routingPollLoop(ctx context.Context) {
	client := &http.Client{Timeout: 5 * time.Second}
	ticker := time.NewTicker(routingPollInterval)
	defer ticker.Stop()
	server.pollRoutingTableOnce(ctx, client)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			server.pollRoutingTableOnce(ctx, client)
		}
	}
}

func (server *proxyServer) pollRoutingTableOnce(ctx context.Context, client *http.Client) {
	request, err := http.NewRequest(http.MethodGet, server.config.ControlPlaneURL+"/api/v1/edge/routing-table", nil)
	if err != nil {
		return
	}
	request.Header.Set("Authorization", "Bearer "+server.config.FleetToken)
	response, err := client.Do(request)
	if err != nil {
		log.Printf("durtwall: routing table poll failed: %v", err)
		return
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		log.Printf("durtwall: routing table poll returned status %d", response.StatusCode)
		return
	}
	var parsed routingTableResponse
	if err := json.NewDecoder(response.Body).Decode(&parsed); err != nil {
		log.Printf("durtwall: routing table poll decode failed: %v", err)
		return
	}
	routesApplied := server.applyRoutingTable(parsed.Routes)
	server.sendHeartbeat(ctx, client, routesApplied)
}

type heartbeatPayload struct {
	RoutesApplied   int    `json:"routesApplied"`
	HoneypotMode    string `json:"honeypotMode"`
	HoneypotHealthy bool   `json:"honeypotHealthy"`
}

// sendHeartbeat piggybacks on the same 15s cycle as the routing table poll - one fewer timer, and
// it only makes sense to report "DurtWall is healthy" right after actually confirming it can talk
// to the control plane. Reuses the same authenticated client/fleet token.
func (server *proxyServer) sendHeartbeat(ctx context.Context, client *http.Client, routesApplied int) {
	body, err := json.Marshal(heartbeatPayload{
		RoutesApplied:   routesApplied,
		HoneypotMode:    server.honeypotMode,
		HoneypotHealthy: server.honeypot.Healthy(ctx),
	})
	if err != nil {
		return
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, server.config.ControlPlaneURL+"/api/v1/edge/heartbeat", bytes.NewReader(body))
	if err != nil {
		return
	}
	request.Header.Set("Authorization", "Bearer "+server.config.FleetToken)
	request.Header.Set("Content-Type", "application/json")
	response, err := client.Do(request)
	if err != nil {
		log.Printf("durtwall: heartbeat failed: %v", err)
		return
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		log.Printf("durtwall: heartbeat returned status %d", response.StatusCode)
	}
}

// applyRoutingTable replaces the whole routing table on every poll rather than diffing against the
// previous one - simpler, and rebuilding a handful of *httputil.ReverseProxy values every 15s is
// cheap. Revisit with an actual diff if the tenant count ever makes that measurably expensive.
func (server *proxyServer) applyRoutingTable(remoteRoutes []remoteRoute) int {
	table := routingTable{}
	for _, remote := range remoteRoutes {
		if remote.Hostname == "" || remote.TenantID == "" {
			continue
		}
		parsed, err := url.Parse(remote.Upstream)
		if err != nil || parsed.Scheme == "" || parsed.Host == "" {
			log.Printf("durtwall: skipping route for %s: invalid upstream %q", remote.Hostname, remote.Upstream)
			continue
		}
		mode := remote.Mode
		if mode != "block" && mode != "monitor" {
			mode = "block"
		}
		knownEndpoints := make([]knownEndpoint, 0, len(remote.KnownEndpoints))
		for _, hint := range remote.KnownEndpoints {
			knownEndpoints = append(knownEndpoints, knownEndpoint{method: hint.Method, path: hint.Path, documented: hint.Documented})
		}
		table[remote.Hostname] = &tenantRoute{
			tenantID:        remote.TenantID,
			mode:            mode,
			upstream:        remote.Upstream,
			alertWebhookURL: remote.AlertWebhookURL,
			stealth:         boolSetting(remote.Settings, "stealth"),
			honeytokens:     boolSetting(remote.Settings, "honeytokens"),
			proxy:           httputil.NewSingleHostReverseProxy(parsed),
			knownEndpoints:  knownEndpoints,
		}
	}
	server.routes.Store(&table)
	log.Printf("durtwall: applied routing table (%d routes)", len(table))
	return len(table)
}

func boolSetting(settings map[string]interface{}, key string) bool {
	if settings == nil {
		return false
	}
	value, ok := settings[key].(bool)
	return ok && value
}
