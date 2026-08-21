package main

import (
	"errors"
	"os"
	"path/filepath"
	"strconv"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Upstream          string `yaml:"upstream"`
	Port              int    `yaml:"port"`
	Mode              string `yaml:"mode"`
	RulesFile         string `yaml:"rules_file"`
	LogFile           string `yaml:"log_file"`
	RateLimit         int    `yaml:"rate_limit"`
	RateBurst         int    `yaml:"rate_burst"`
	RequestBodyMax    int64  `yaml:"request_body_max"`
	Stealth           bool   `yaml:"stealth"`
	Honeytokens       bool   `yaml:"honeytokens"`
	Honeypot          bool   `yaml:"honeypot"`
	HoneypotImage     string `yaml:"honeypot_image"`
	HoneypotPort      int    `yaml:"honeypot_port"`
	ControlPlaneURL   string `yaml:"control_plane_url"`
	ControlPlaneToken string `yaml:"control_plane_token"`
}

func defaultConfig() Config {
	return Config{Upstream: "http://localhost:3001", Port: 8080, Mode: "block", RulesFile: "rules.conf", RateLimit: 60, RateBurst: 20, RequestBodyMax: 1 << 20, HoneypotImage: "nginx:alpine", HoneypotPort: 8081}
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
	if value := os.Getenv("DURTWALL_UPSTREAM"); value != "" {
		config.Upstream = value
	}
	if value := os.Getenv("DURTWALL_MODE"); value != "" {
		config.Mode = value
	}
	if value := os.Getenv("DURTWALL_CONTROL_PLANE_URL"); value != "" {
		config.ControlPlaneURL = value
	}
	if value := os.Getenv("DURTWALL_CONTROL_PLANE_TOKEN"); value != "" {
		config.ControlPlaneToken = value
	}
	if value := os.Getenv("PORT"); value != "" {
		if parsed, err := strconv.Atoi(value); err == nil {
			config.Port = parsed
		}
	}
	if config.Upstream == "" {
		return Config{}, errors.New("upstream is required")
	}
	if config.Port < 1 || config.Port > 65535 {
		return Config{}, errors.New("port must be between 1 and 65535")
	}
	if config.Mode != "block" && config.Mode != "monitor" {
		return Config{}, errors.New("mode must be block or monitor")
	}
	if config.RateLimit < 1 || config.RateBurst < 1 {
		return Config{}, errors.New("rate_limit and rate_burst must be positive")
	}
	if config.HoneypotPort < 1 || config.HoneypotPort > 65535 {
		return Config{}, errors.New("honeypot_port must be between 1 and 65535")
	}
	return config, nil
}
