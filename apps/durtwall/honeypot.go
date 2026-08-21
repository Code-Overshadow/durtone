package main

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
)

// honeypotStrategy responds to a request isScanner flagged, instead of forwarding it to the real
// upstream. syntheticHoneypot (below) is the default and only one wired up on the shared,
// multi-tenant fleet: it fabricates the response in-process, so it needs no per-tenant isolated
// infra. dockerHoneypotManager (deception.go) implements the same interface for standalone/local
// use, where a Docker daemon is available, to prove the abstraction is actually swappable rather
// than aspirational. A future strategy backed by the Fly Machines API (one ephemeral VM per
// tenant - real isolation, unlike a shared container - would work on the managed fleet where
// Docker doesn't) can implement this same interface without any change to ServeHTTP.
//
// Contract: on success, Respond must have already written a status and body to writer, and
// statusCode must be exactly what was written (ServeHTTP only uses it for logging - it does not
// write anything itself). Returning a non-nil err means nothing was written yet; ServeHTTP writes
// a generic 503 in that case.
type honeypotStrategy interface {
	Respond(ctx context.Context, route *tenantRoute, request *http.Request, writer http.ResponseWriter) (statusCode int, err error)
	Close()
}

// knownEndpoint is DurtShield's discovery data for one tenant (apps/api's `endpoints` table),
// synced into tenantRoute.knownEndpoints via the routing table poll (routing.go).
type knownEndpoint struct {
	method     string
	path       string
	documented bool
}

// syntheticHoneypot fabricates a plausible response instead of running anything. It uses the
// tenant's own discovered endpoints to answer with the same method/shape a scanner would expect
// from that tenant's real API, and reuses injectHoneytoken - the exact function real traffic goes
// through - so a "credential" harvested from the decoy is traceable exactly like a real one leaked
// through honeytokens.
type syntheticHoneypot struct{}

func newSyntheticHoneypot() *syntheticHoneypot {
	return &syntheticHoneypot{}
}

func (*syntheticHoneypot) Close() {}

func (*syntheticHoneypot) Respond(_ context.Context, route *tenantRoute, request *http.Request, writer http.ResponseWriter) (int, error) {
	var match *knownEndpoint
	if route != nil {
		match = bestMatchingEndpoint(route.knownEndpoints, request.Method, request.URL.Path)
	}
	status := syntheticStatusCode(request.Method, match)
	body := syntheticBody(request, match)
	if injected, ok := injectHoneytoken(body, "application/json"); ok {
		body = injected
	}

	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	_, err := writer.Write(body)
	return status, err
}

// bestMatchingEndpoint picks the tenant's known endpoint that looks most like the scanned request:
// same method, and the same number of path segments, so e.g. a scan of /api/users/999999 lines up
// with a previously observed /api/users/17 even though the trailing value differs. When more than
// one candidate matches equally well, a documented endpoint wins over a shadow one - a shadow
// endpoint isn't a convincing decoy for "the app's real, known API".
func bestMatchingEndpoint(known []knownEndpoint, method, path string) *knownEndpoint {
	method = strings.ToUpper(method)
	depth := pathDepth(path)
	var best *knownEndpoint
	for i := range known {
		candidate := known[i]
		if !strings.EqualFold(candidate.method, method) || pathDepth(candidate.path) != depth {
			continue
		}
		if best == nil || (!best.documented && candidate.documented) {
			best = &candidate
		}
	}
	return best
}

func pathDepth(path string) int {
	trimmed := strings.Trim(path, "/")
	if trimmed == "" {
		return 0
	}
	return len(strings.Split(trimmed, "/"))
}

func syntheticStatusCode(method string, match *knownEndpoint) int {
	if match != nil {
		return http.StatusOK
	}
	switch strings.ToUpper(method) {
	case http.MethodPost:
		return http.StatusCreated
	case http.MethodDelete:
		return http.StatusNoContent
	default:
		return http.StatusOK
	}
}

// syntheticBody builds a generic-but-plausible JSON object shaped by the request path itself: the
// last numeric/opaque segment is treated as a resource id, and the segment before it names the
// resource key. There's no real field-level schema to draw from - the OpenAPI spec a tenant
// uploads isn't persisted with response schemas today (tracked as backlog) - so this stays
// intentionally generic rather than pretending to know fields it doesn't.
func syntheticBody(request *http.Request, match *knownEndpoint) []byte {
	segments := strings.Split(strings.Trim(request.URL.Path, "/"), "/")
	resource, id := "resource", ""
	for i := len(segments) - 1; i >= 0; i-- {
		if segments[i] == "" {
			continue
		}
		if id == "" && looksLikeIdentifier(segments[i]) {
			id = segments[i]
			continue
		}
		resource = segments[i]
		break
	}

	payload := map[string]interface{}{
		"id":   id,
		"data": map[string]interface{}{"id": id, "type": resource, "status": "ok"},
	}
	if match != nil {
		payload["path"] = match.path
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return []byte(`{"status":"ok"}`)
	}
	return body
}

// looksLikeIdentifier is a coarse heuristic for "this path segment is a value, not a resource
// name": mostly digits, or long enough to plausibly be a UUID/opaque token.
func looksLikeIdentifier(segment string) bool {
	if segment == "" {
		return false
	}
	if len(segment) >= 20 {
		return true
	}
	digits := 0
	for _, r := range segment {
		if r >= '0' && r <= '9' {
			digits++
		}
	}
	return digits*2 >= len(segment)
}
