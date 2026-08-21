package main

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

type bucket struct {
	tokens float64
	seen   time.Time
}

type tokenBucketLimiter struct {
	mu       sync.Mutex
	rate     float64
	burst    float64
	buckets  map[string]bucket
	lastTrim time.Time
}

func newTokenBucketLimiter(rate, burst int) *tokenBucketLimiter {
	return &tokenBucketLimiter{rate: float64(rate), burst: float64(burst), buckets: make(map[string]bucket)}
}

func (limiter *tokenBucketLimiter) allow(key string, now time.Time) bool {
	limiter.mu.Lock()
	defer limiter.mu.Unlock()
	state, exists := limiter.buckets[key]
	if !exists {
		state = bucket{tokens: limiter.burst, seen: now}
	}
	state.tokens = min(limiter.burst, state.tokens+now.Sub(state.seen).Seconds()*limiter.rate)
	state.seen = now
	if state.tokens < 1 {
		limiter.buckets[key] = state
		return false
	}
	state.tokens--
	limiter.buckets[key] = state
	if now.Sub(limiter.lastTrim) > 10*time.Minute {
		for candidate, value := range limiter.buckets {
			if now.Sub(value.seen) > 15*time.Minute {
				delete(limiter.buckets, candidate)
			}
		}
		limiter.lastTrim = now
	}
	return true
}

func clientKey(request *http.Request) string {
	if forwarded := request.Header.Get("X-Forwarded-For"); forwarded != "" {
		return strings.TrimSpace(strings.Split(forwarded, ",")[0])
	}
	host, _, err := net.SplitHostPort(request.RemoteAddr)
	if err == nil {
		return host
	}
	return request.RemoteAddr
}

func min(left, right float64) float64 {
	if left < right {
		return left
	}
	return right
}
