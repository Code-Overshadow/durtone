package main

import (
	"errors"
	"os"
	"path/filepath"
	"strconv"

	"gopkg.in/yaml.v3"
)

// Config holds the local, per-process settings for the edge proxy fleet: which control plane to
// poll, how to run the shared WAF engine, and rate limiting. There is no per-tenant upstream/mode
// here anymore - those come from the routing table (see routing.go) because one process serves
// every tenant's domain, resolved by the incoming request's Host header.
type Config struct {
	Port            int    `yaml:"port"`
	RulesFile       string `yaml:"rules_file"`
	LogFile         string `yaml:"log_file"`
	RateLimit       int    `yaml:"rate_limit"`
	RateBurst       int    `yaml:"rate_burst"`
	RequestBodyMax  int64  `yaml:"request_body_max"`
	Honeypot        bool   `yaml:"honeypot"`
	HoneypotImage   string `yaml:"honeypot_image"`
	HoneypotPort    int    `yaml:"honeypot_port"`
	ControlPlaneURL string `yaml:"control_plane_url"`
	FleetToken      string `yaml:"fleet_token"`
}

func defaultConfig() Config {
	return Config{Port: 8080, RulesFile: "rules.conf", RateLimit: 60, RateBurst: 20, RequestBodyMax: 1 << 20, HoneypotImage: "nginx:alpine", HoneypotPort: 8081}
}

func loadConfig(path string) (Config, error) {
	config := defaultConfig()
	if path != "" {
		data, err := os.ReadFile(path)
		if err != nil {
			return Config{}, err
		}
		if err := yaml.Unmarshal(data, &config); err != nil {
			return Config{}, err
		}
		if config.RulesFile != "" && !filepath.IsAbs(config.RulesFile) {
			config.RulesFile = filepath.Join(filepath.Dir(path), config.RulesFile)
		}
	}
	if value := os.Getenv("DURTWALL_CONTROL_PLANE_URL"); value != "" {
		config.ControlPlaneURL = value
	}
	if value := os.Getenv("DURTWALL_FLEET_TOKEN"); value != "" {
		config.FleetToken = value
	}
	if value := os.Getenv("PORT"); value != "" {
		if parsed, err := strconv.Atoi(value); err == nil {
			config.Port = parsed
		}
	}
	if config.Port < 1 || config.Port > 65535 {
		return Config{}, errors.New("port must be between 1 and 65535")
	}
	if config.RateLimit < 1 || config.RateBurst < 1 {
		return Config{}, errors.New("rate_limit and rate_burst must be positive")
	}
	if config.HoneypotPort < 1 || config.HoneypotPort > 65535 {
		return Config{}, errors.New("honeypot_port must be between 1 and 65535")
	}
	return config, nil
}
