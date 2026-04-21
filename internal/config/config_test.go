package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func writeConfig(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}
	return path
}

func TestLoad_RejectsUnknownUgoiraFormat(t *testing.T) {
	path := writeConfig(t, "download:\n  ugoira:\n    format: lol\n")
	_, err := Load(path)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !strings.Contains(err.Error(), "ugoira.format") {
		t.Errorf("error should mention the bad field, got: %v", err)
	}
}

func TestLoad_AcceptsKnownUgoiraFormats(t *testing.T) {
	for _, f := range []string{"webp", "gif", "none", "WEBP", "Gif", ""} {
		t.Run(f, func(t *testing.T) {
			body := "download:\n  ugoira:\n    format: " + f + "\n"
			if f == "" {
				body = "download:\n  ugoira: {}\n"
			}
			if _, err := Load(writeConfig(t, body)); err != nil {
				t.Fatalf("Load(%q): %v", f, err)
			}
		})
	}
}

// Regression: env overrides on underscored koanf tags used to be no-ops.
func TestLoad_EnvOverride_UnderscoredKey(t *testing.T) {
	t.Setenv("PIXIVBIU_DOWNLOAD_MAX_CONCURRENT", "8")
	cfg, err := Load("")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Download.MaxConcurrent != 8 {
		t.Errorf("MaxConcurrent = %d, want 8", cfg.Download.MaxConcurrent)
	}
}

func TestLoad_EnvOverride_NestedWithUnderscore(t *testing.T) {
	t.Setenv("PIXIVBIU_PIXIV_BYPASS_SNI", "true")
	t.Setenv("PIXIVBIU_INBOX_BUFFER_SIZE", "500")
	cfg, err := Load("")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if !cfg.Pixiv.BypassSNI {
		t.Errorf("BypassSNI = false, want true")
	}
	if cfg.Inbox.BufferSize != 500 {
		t.Errorf("BufferSize = %d, want 500", cfg.Inbox.BufferSize)
	}
}

func TestLoad_EnvOverride_PureNesting(t *testing.T) {
	t.Setenv("PIXIVBIU_SERVER_TIMEOUTS_SHUTDOWN", "20s")
	cfg, err := Load("")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Server.Timeouts.Shutdown != 20*time.Second {
		t.Errorf("Shutdown = %s, want 20s", cfg.Server.Timeouts.Shutdown)
	}
}

// Exercises the tie-break when multiple underscores admit several splits.
func TestLoad_EnvOverride_MultiUnderscoreTemplate(t *testing.T) {
	want := "custom/{{.IllustID}}_{{.Title}}/{{.Index}}{{.Ext}}"
	t.Setenv("PIXIVBIU_DOWNLOAD_FILE_GROUP_TEMPLATE", want)
	cfg, err := Load("")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Download.FileGroupTemplate != want {
		t.Errorf("FileGroupTemplate = %q, want %q", cfg.Download.FileGroupTemplate, want)
	}
}
