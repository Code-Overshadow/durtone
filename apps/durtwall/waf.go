package main

import (
	"bytes"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"sort"
	"strings"

	coreruleset "github.com/corazawaf/coraza-coreruleset"
	"github.com/corazawaf/coraza/v3"
	"github.com/corazawaf/coraza/v3/types"
)

type wafEngine struct {
	waf            coraza.WAF
	requestBodyMax int64
}

type normalizedFS struct{ fs.FS }

func (filesystem normalizedFS) Open(name string) (fs.File, error) {
	return filesystem.FS.Open(strings.ReplaceAll(name, "\\", "/"))
}

func newWAF(config Config) (*wafEngine, error) {
	directives := `SecRuleEngine On
SecRequestBodyAccess On
Include @crs-setup.conf.example
SecRule ARGS "@rx (?i)(union[[:space:]]+select|select[[:space:]]+.*from|or[[:space:]]+['\"]?1['\"]?[[:space:]]*=[[:space:]]*['\"]?1|<script|javascript:)" "id:100001,phase:2,deny,status:403,msg:'DurtWall SQLi/XSS detection'"
SecRule REQUEST_URI "@rx (?i)(\.\./|/etc/passwd|/\.git/)" "id:100002,phase:1,deny,status:403,msg:'DurtWall path traversal detection'"`
	rules, err := fs.Glob(coreruleset.FS, "@owasp_crs/*.conf")
	if err != nil {
		return nil, fmt.Errorf("discover CRS rules: %w", err)
	}
	sort.Strings(rules)
	for _, rule := range rules {
		directives += fmt.Sprintf("\nInclude %s", rule)
	}
	if config.RulesFile != "" {
		if data, err := os.ReadFile(config.RulesFile); err == nil {
			directives += "\n" + string(data)
		} else if !os.IsNotExist(err) {
			return nil, err
		}
	}
	waf, err := coraza.NewWAF(coraza.NewWAFConfig().WithRequestBodyAccess().WithRequestBodyLimit(int(config.RequestBodyMax)).WithRootFS(normalizedFS{FS: coreruleset.FS}).WithDirectives(directives))
	if err != nil {
		return nil, fmt.Errorf("create Coraza WAF: %w", err)
	}
	return &wafEngine{waf: waf, requestBodyMax: config.RequestBodyMax}, nil
}

func (engine *wafEngine) inspect(request *http.Request) (*types.Interruption, error) {
	transaction := engine.waf.NewTransaction()
	defer transaction.Close()
	transaction.ProcessConnection(clientKey(request), 0, request.Host, 0)
	transaction.ProcessURI(request.URL.RequestURI(), request.Method, request.Proto)
	for name, values := range request.Header {
		for _, value := range values {
			transaction.AddRequestHeader(name, value)
		}
	}
	if interruption := transaction.ProcessRequestHeaders(); interruption != nil {
		return interruption, nil
	}
	if request.Body != nil {
		body, err := io.ReadAll(io.LimitReader(request.Body, engine.requestBodyMax+1))
		if err != nil {
			return nil, err
		}
		request.Body = io.NopCloser(bytes.NewReader(body))
		if int64(len(body)) > engine.requestBodyMax {
			return nil, fmt.Errorf("request body exceeds configured limit")
		}
		if _, _, err := transaction.WriteRequestBody(body); err != nil {
			return nil, err
		}
	}
	interruption, err := transaction.ProcessRequestBody()
	return interruption, err
}
