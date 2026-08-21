package main

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"os"
	"sync"
	"time"
)

type requestLogger struct {
	logger            *slog.Logger
	closer            io.Closer
	shipQueue         chan []byte
	shipDone          chan struct{}
	shipWG            sync.WaitGroup
	controlPlaneURL   string
	controlPlaneToken string
}

func newRequestLogger(path, controlPlaneURL, controlPlaneToken string) (*requestLogger, error) {
	var output io.Writer = os.Stdout
	var closer io.Closer
	if path != "" {
		file, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
		if err != nil {
			return nil, err
		}
		output, closer = file, file
	}
	requestLogger := &requestLogger{logger: slog.New(slog.NewJSONHandler(output, &slog.HandlerOptions{Level: slog.LevelInfo})), closer: closer, controlPlaneURL: controlPlaneURL, controlPlaneToken: controlPlaneToken}
	if controlPlaneURL != "" {
		requestLogger.shipQueue = make(chan []byte, 256)
		requestLogger.shipDone = make(chan struct{})
		requestLogger.shipWG.Add(1)
		go requestLogger.shipLoop()
	}
	return requestLogger, nil
}

func (logger *requestLogger) close() error {
	if logger.shipQueue != nil {
		close(logger.shipQueue)
		logger.shipWG.Wait()
		close(logger.shipDone)
	}
	if logger.closer == nil {
		return nil
	}
	return logger.closer.Close()
}

func (logger *requestLogger) request(tenantID string, request *http.Request, status, duration int, blocked bool, reason string) {
	event := map[string]interface{}{"tenantId": tenantID, "timestamp": time.Now().UTC().Format(time.RFC3339Nano), "method": request.Method, "path": request.URL.Path, "query": request.URL.RawQuery, "remote_ip": clientKey(request), "status": status, "duration_ms": duration, "blocked": blocked, "reason": reason}
	logger.logger.Info("request", "tenant_id", tenantID, "timestamp", event["timestamp"], "method", request.Method, "path", request.URL.Path, "query", request.URL.RawQuery, "remote_ip", clientKey(request), "status", status, "duration_ms", duration, "blocked", blocked, "reason", reason)
	if logger.shipQueue != nil {
		if payload, err := json.Marshal(event); err == nil {
			select {
			case logger.shipQueue <- payload:
			default:
			}
		}
	}
}

func (logger *requestLogger) shipLoop() {
	defer logger.shipWG.Done()
	client := &http.Client{Timeout: 5 * time.Second}
	for payload := range logger.shipQueue {
		for attempt := 0; attempt < 3; attempt++ {
			request, err := http.NewRequest(http.MethodPost, logger.controlPlaneURL+"/api/v1/ingest/logs", bytes.NewReader(append([]byte(`{"logs":[`), append(payload, []byte(`]}`)...)...)))
			if err != nil {
				break
			}
			request.Header.Set("Content-Type", "application/json")
			if logger.controlPlaneToken != "" {
				request.Header.Set("Authorization", "Bearer "+logger.controlPlaneToken)
			}
			response, err := client.Do(request)
			if err == nil && response.StatusCode < http.StatusInternalServerError {
				_ = response.Body.Close()
				break
			}
			if response != nil {
				_ = response.Body.Close()
			}
			time.Sleep(time.Duration(attempt+1) * 100 * time.Millisecond)
		}
	}
}

func writeJSONError(writer http.ResponseWriter, status int, message string) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(map[string]string{"error": message})
}
