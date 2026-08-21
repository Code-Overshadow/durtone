package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path"
	"strings"
)

type endpoint struct {
	Method      string         `json:"method"`
	Path        string         `json:"path"`
	Count       int            `json:"count"`
	StatusCodes map[string]int `json:"status_codes"`
	Documented  bool           `json:"documented"`
	Shadow      bool           `json:"shadow"`
}

type accessLog struct {
	Method string `json:"method"`
	Path   string `json:"path"`
	Status int    `json:"status"`
}

type openAPIDocument struct {
	Paths map[string]map[string]json.RawMessage `json:"paths"`
}

func discoverEndpoints(logPath, openAPIPath string) ([]endpoint, error) {
	input, err := os.Open(logPath)
	if err != nil {
		return nil, err
	}
	defer input.Close()

	documentedPaths, err := loadDocumentedPaths(openAPIPath)
	if err != nil {
		return nil, err
	}
	aggregated := make(map[string]*endpoint)
	scanner := bufio.NewScanner(input)
	for scanner.Scan() {
		var entry accessLog
		if err := json.Unmarshal(scanner.Bytes(), &entry); err != nil {
			continue
		}
		if entry.Method == "" || entry.Path == "" {
			continue
		}
		entry.Method = strings.ToUpper(entry.Method)
		key := entry.Method + " " + entry.Path
		item := aggregated[key]
		if item == nil {
			item = &endpoint{Method: entry.Method, Path: entry.Path, StatusCodes: make(map[string]int), Documented: matchesDocumentedPath(documentedPaths, entry.Method, entry.Path)}
			item.Shadow = !item.Documented
			aggregated[key] = item
		}
		item.Count++
		item.StatusCodes[fmt.Sprintf("%d", entry.Status)]++
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	result := make([]endpoint, 0, len(aggregated))
	for _, item := range aggregated {
		result = append(result, *item)
	}
	sortEndpoints(result)
	return result, nil
}

func loadDocumentedPaths(openAPIPath string) (map[string]map[string]struct{}, error) {
	documented := make(map[string]map[string]struct{})
	if openAPIPath == "" {
		return documented, nil
	}
	data, err := os.ReadFile(openAPIPath)
	if err != nil {
		return nil, err
	}
	var document openAPIDocument
	if err := json.Unmarshal(data, &document); err != nil {
		return nil, fmt.Errorf("parse OpenAPI document: %w", err)
	}
	for route, methods := range document.Paths {
		for method := range methods {
			method = strings.ToUpper(method)
			if method == "PARAMETERS" {
				continue
			}
			if documented[method] == nil {
				documented[method] = make(map[string]struct{})
			}
			documented[method][route] = struct{}{}
		}
	}
	return documented, nil
}

func matchesDocumentedPath(documented map[string]map[string]struct{}, method, requestPath string) bool {
	pathOnly := requestPath
	if parsed, err := url.Parse(requestPath); err == nil {
		pathOnly = parsed.Path
	}
	for route := range documented[method] {
		if route == pathOnly || openAPIPathMatches(route, pathOnly) {
			return true
		}
	}
	return false
}

func openAPIPathMatches(route, requestPath string) bool {
	routeParts := strings.Split(strings.Trim(path.Clean(route), "/"), "/")
	requestParts := strings.Split(strings.Trim(path.Clean(requestPath), "/"), "/")
	if len(routeParts) != len(requestParts) {
		return false
	}
	for index, routePart := range routeParts {
		if strings.HasPrefix(routePart, "{") && strings.HasSuffix(routePart, "}") {
			continue
		}
		if routePart != requestParts[index] {
			return false
		}
	}
	return true
}

func sortEndpoints(items []endpoint) {
	for index := 0; index < len(items); index++ {
		for next := index + 1; next < len(items); next++ {
			if items[next].Path < items[index].Path || (items[next].Path == items[index].Path && items[next].Method < items[index].Method) {
				items[index], items[next] = items[next], items[index]
			}
		}
	}
}

func sendShadowAlerts(webhook string, items []endpoint) error {
	if webhook == "" {
		return nil
	}
	for _, item := range items {
		if !item.Shadow {
			continue
		}
		payload, err := json.Marshal(map[string]string{"text": fmt.Sprintf("DurtShield Shadow API: %s %s (%d requests)", item.Method, item.Path, item.Count)})
		if err != nil {
			return err
		}
		response, err := http.Post(webhook, "application/json", strings.NewReader(string(payload)))
		if err != nil {
			return err
		}
		response.Body.Close()
		if response.StatusCode >= http.StatusBadRequest {
			return fmt.Errorf("webhook returned HTTP %d", response.StatusCode)
		}
	}
	return nil
}
