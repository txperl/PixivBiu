package config

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

func newMgr(t *testing.T, settingsBody string) *Manager {
	t.Helper()
	path := filepath.Join(t.TempDir(), "settings.json")
	if settingsBody != "" {
		if err := os.WriteFile(path, []byte(settingsBody), 0o600); err != nil {
			t.Fatalf("write settings: %v", err)
		}
	}
	mgr, err := NewManager(path)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	return mgr
}

func TestLoad_MissingFile_UsesDefaults(t *testing.T) {
	mgr := newMgr(t, "")
	cfg := mgr.Config()
	if cfg.Download.MaxConcurrent != 4 {
		t.Errorf("default MaxConcurrent = %d, want 4", cfg.Download.MaxConcurrent)
	}
	if cfg.Server.Port != 8080 {
		t.Errorf("default Server.Port = %d, want 8080", cfg.Server.Port)
	}
}

func TestLoad_RejectsInvalidJSON(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	if err := os.WriteFile(path, []byte("{not json"), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}
	if _, err := NewManager(path); err == nil {
		t.Fatal("expected parse error, got nil")
	}
}

func TestLoad_RejectsUnknownUgoiraFormat(t *testing.T) {
	body := `{"download": {"ugoira": {"format": "lol"}}}`
	path := filepath.Join(t.TempDir(), "settings.json")
	_ = os.WriteFile(path, []byte(body), 0o600)
	if _, err := NewManager(path); err == nil || !strings.Contains(err.Error(), "ugoira.format") {
		t.Errorf("expected ugoira.format error, got: %v", err)
	}
}

func TestEnvOverride_UnderscoredKey(t *testing.T) {
	t.Setenv("PIXIVBIU_DOWNLOAD_MAX_CONCURRENT", "8")
	mgr := newMgr(t, "")
	if mgr.Config().Download.MaxConcurrent != 8 {
		t.Errorf("MaxConcurrent = %d, want 8", mgr.Config().Download.MaxConcurrent)
	}
}

func TestEnvOverride_NestedWithUnderscore(t *testing.T) {
	t.Setenv("PIXIVBIU_PIXIV_BYPASS_SNI", "true")
	t.Setenv("PIXIVBIU_INBOX_BUFFER_SIZE", "500")
	mgr := newMgr(t, "")
	cfg := mgr.Config()
	if !cfg.Pixiv.BypassSNI {
		t.Errorf("BypassSNI = false, want true")
	}
	if cfg.Inbox.BufferSize != 500 {
		t.Errorf("BufferSize = %d, want 500", cfg.Inbox.BufferSize)
	}
}

func TestEnvOverride_PureNesting(t *testing.T) {
	t.Setenv("PIXIVBIU_SERVER_TIMEOUTS_SHUTDOWN", "20s")
	if mgr := newMgr(t, ""); mgr.Config().Server.Timeouts.Shutdown != 20*time.Second {
		t.Errorf("Shutdown = %s, want 20s", mgr.Config().Server.Timeouts.Shutdown)
	}
}

func TestEnvOverride_MultiUnderscoreTemplate(t *testing.T) {
	want := "custom/{{.IllustID}}_{{.Title}}/{{.Index}}{{.Ext}}"
	t.Setenv("PIXIVBIU_DOWNLOAD_FILE_GROUP_TEMPLATE", want)
	if got := newMgr(t, "").Config().Download.FileGroupTemplate; got != want {
		t.Errorf("FileGroupTemplate = %q, want %q", got, want)
	}
}

func TestPatch_DiffOnlyPersistence(t *testing.T) {
	mgr := newMgr(t, "")
	if _, err := mgr.Patch(map[string]any{"download.max_concurrent": 16}); err != nil {
		t.Fatalf("Patch: %v", err)
	}
	data, _ := os.ReadFile(mgr.StorePath())
	var nested map[string]any
	_ = json.Unmarshal(data, &nested)
	// Only the changed key + its parents should be present.
	dl, _ := nested["download"].(map[string]any)
	if dl == nil || dl["max_concurrent"] == nil {
		t.Fatalf("expected diff to contain download.max_concurrent, got: %s", data)
	}
	for k := range nested {
		if k != "download" {
			t.Errorf("unexpected top-level key in diff: %q", k)
		}
	}
	for k := range dl {
		if k != "max_concurrent" {
			t.Errorf("unexpected download key in diff: %q", k)
		}
	}
}

func TestPatch_BackToDefaultRemovesEntry(t *testing.T) {
	mgr := newMgr(t, `{"download":{"max_concurrent": 16}}`)
	if _, err := mgr.Patch(map[string]any{"download.max_concurrent": 4}); err != nil { // 4 is default
		t.Fatalf("Patch: %v", err)
	}
	data, _ := os.ReadFile(mgr.StorePath())
	var nested map[string]any
	_ = json.Unmarshal(data, &nested)
	if nestedGet(nested, "download", "max_concurrent") != nil {
		t.Errorf("expected default value to be pruned, got: %s", data)
	}
}

func TestPatch_RejectsUnknownKey(t *testing.T) {
	mgr := newMgr(t, "")
	_, err := mgr.Patch(map[string]any{"download.does_not_exist": 1})
	pe, ok := err.(*PatchError)
	if !ok || pe.Errors["download.does_not_exist"] == "" {
		t.Errorf("expected PatchError on unknown key, got: %v", err)
	}
}

func TestPatch_RejectsEmptyEnum(t *testing.T) {
	mgr := newMgr(t, "")
	for _, key := range []string{"log.level", "log.format", "download.ugoira.format"} {
		t.Run(key, func(t *testing.T) {
			_, err := mgr.Patch(map[string]any{key: ""})
			pe, ok := err.(*PatchError)
			if !ok || pe.Errors[key] == "" {
				t.Errorf("expected PatchError on empty enum value, got: %v", err)
			}
		})
	}
}

func TestPatch_EnforcesMinMax(t *testing.T) {
	mgr := newMgr(t, "")
	if _, err := mgr.Patch(map[string]any{"download.max_concurrent": -1}); err == nil {
		t.Error("expected min violation error")
	}
	if _, err := mgr.Patch(map[string]any{"download.max_concurrent": 9999}); err == nil {
		t.Error("expected max violation error")
	}
}

func TestPatch_SensitiveMaskIsNoOp(t *testing.T) {
	mgr := newMgr(t, `{"pixiv":{"proxy":"http://u:p@h:1"}}`)
	if _, err := mgr.Patch(map[string]any{"pixiv.proxy": SensitiveMask}); err != nil {
		t.Fatalf("Patch mask: %v", err)
	}
	if mgr.Config().Pixiv.Proxy != "http://u:p@h:1" {
		t.Errorf("mask should not overwrite; got %q", mgr.Config().Pixiv.Proxy)
	}
}

func TestPatch_SensitiveRealValueOverwrites(t *testing.T) {
	mgr := newMgr(t, "")
	if _, err := mgr.Patch(map[string]any{"pixiv.proxy": "http://x:1"}); err != nil {
		t.Fatalf("Patch: %v", err)
	}
	var nested map[string]any
	data, _ := os.ReadFile(mgr.StorePath())
	_ = json.Unmarshal(data, &nested)
	if nestedGet(nested, "pixiv", "proxy") != "http://x:1" {
		t.Errorf("file proxy = %v, want http://x:1", nestedGet(nested, "pixiv", "proxy"))
	}
}

func TestReset_Keys(t *testing.T) {
	mgr := newMgr(t, `{"download":{"max_concurrent": 16},"pixiv":{"proxy":"http://x:1"}}`)
	if _, err := mgr.Reset([]string{"download.max_concurrent"}, false); err != nil {
		t.Fatalf("Reset: %v", err)
	}
	var nested map[string]any
	data, _ := os.ReadFile(mgr.StorePath())
	_ = json.Unmarshal(data, &nested)
	if nestedGet(nested, "download", "max_concurrent") != nil {
		t.Errorf("reset should have dropped max_concurrent from file, got: %s", data)
	}
	if nestedGet(nested, "pixiv", "proxy") != "http://x:1" {
		t.Errorf("unrelated key was reset from file: %s", data)
	}
}

func TestPatch_RejectsEmptyBody(t *testing.T) {
	mgr := newMgr(t, "")
	_, err := mgr.Patch(map[string]any{})
	pe, ok := err.(*PatchError)
	if !ok || pe.Errors["_"] == "" {
		t.Errorf("expected PatchError on empty patch, got: %v", err)
	}
}

func TestReset_RejectsNeitherAllNorKeys(t *testing.T) {
	mgr := newMgr(t, `{"download":{"max_concurrent": 16}}`)
	_, err := mgr.Reset(nil, false)
	pe, ok := err.(*PatchError)
	if !ok || pe.Errors["_"] == "" {
		t.Errorf("expected PatchError on empty reset, got: %v", err)
	}
	// File must be untouched.
	data, _ := os.ReadFile(mgr.StorePath())
	var nested map[string]any
	_ = json.Unmarshal(data, &nested)
	if nestedGet(nested, "download", "max_concurrent") == nil {
		t.Errorf("file should be untouched after rejected reset, got: %s", data)
	}
}

func TestReset_AllAndKeysRejected(t *testing.T) {
	mgr := newMgr(t, `{"download":{"max_concurrent": 16}}`)
	_, err := mgr.Reset([]string{"download.max_concurrent"}, true)
	pe, ok := err.(*PatchError)
	if !ok {
		t.Fatalf("expected PatchError, got: %v", err)
	}
	if pe.Errors["_"] == "" {
		t.Errorf("expected mutex error message, got: %v", pe.Errors)
	}
	// Confirm the file is unchanged: the previous override survived.
	data, _ := os.ReadFile(mgr.StorePath())
	var nested map[string]any
	_ = json.Unmarshal(data, &nested)
	if nestedGet(nested, "download", "max_concurrent") == nil {
		t.Errorf("file should be untouched after rejected reset, got: %s", data)
	}
}

func TestReset_All(t *testing.T) {
	mgr := newMgr(t, `{"download":{"max_concurrent": 16},"pixiv":{"proxy":"http://x:1"}}`)
	if _, err := mgr.Reset(nil, true); err != nil {
		t.Fatalf("Reset all: %v", err)
	}
	data, _ := os.ReadFile(mgr.StorePath())
	if strings.TrimSpace(string(data)) != "{}" {
		t.Errorf("reset all should have cleared file, got: %s", data)
	}
}

// Internal keys are program-only: PATCH must reject them outright and
// must not touch the file (the change can only happen by editing it).
func TestPatch_RejectsInternalKey(t *testing.T) {
	mgr := newMgr(t, "")
	_, err := mgr.Patch(map[string]any{"server.port": 9090})
	pe, ok := err.(*PatchError)
	if !ok || pe.Errors["server.port"] == "" {
		t.Fatalf("expected PatchError on internal key, got: %v", err)
	}
	if _, err := os.Stat(mgr.StorePath()); !os.IsNotExist(err) {
		t.Errorf("settings.json should not be written when patching an internal key, stat err=%v", err)
	}
}

// A keyed Reset of an internal key is rejected, and the existing file
// override survives untouched.
func TestReset_RejectsInternalKey(t *testing.T) {
	mgr := newMgr(t, `{"server":{"port":9090}}`)
	_, err := mgr.Reset([]string{"server.port"}, false)
	pe, ok := err.(*PatchError)
	if !ok || pe.Errors["server.port"] == "" {
		t.Fatalf("expected PatchError on internal key reset, got: %v", err)
	}
	data, _ := os.ReadFile(mgr.StorePath())
	var nested map[string]any
	_ = json.Unmarshal(data, &nested)
	if nestedGet(nested, "server", "port") == nil {
		t.Errorf("internal override should survive a rejected reset, got: %s", data)
	}
}

// Reset(all) clears ordinary overrides but preserves internal ones, since
// they may only be changed by editing the config file.
func TestReset_AllPreservesInternal(t *testing.T) {
	mgr := newMgr(t, `{"server":{"port":9090},"pixiv":{"proxy":"http://x:1"}}`)
	if _, err := mgr.Reset(nil, true); err != nil {
		t.Fatalf("Reset all: %v", err)
	}
	data, _ := os.ReadFile(mgr.StorePath())
	var nested map[string]any
	_ = json.Unmarshal(data, &nested)
	if nestedGet(nested, "server", "port") != float64(9090) {
		t.Errorf("internal server.port should survive reset-all, got: %s", data)
	}
	if nestedGet(nested, "pixiv", "proxy") != nil {
		t.Errorf("ordinary pixiv.proxy should be cleared by reset-all, got: %s", data)
	}
}

// EffectiveStaysFrozen pins down the contract: Patch/Reset persist
// changes to the file layer but never mutate what the running process
// uses. Frontend learns "restart needed" by comparing View.File to
// View.Effective.
func TestPatch_EffectiveStaysFrozen(t *testing.T) {
	mgr := newMgr(t, "")
	before := mgr.Config().Download.MaxConcurrent
	view, err := mgr.Patch(map[string]any{"download.max_concurrent": 32})
	if err != nil {
		t.Fatalf("Patch: %v", err)
	}
	if mgr.Config().Download.MaxConcurrent != before {
		t.Errorf("startup snapshot mutated: got %d, want %d", mgr.Config().Download.MaxConcurrent, before)
	}
	// Effective values pass through coerceForView (returns int64), while
	// File values are the raw JSON map (encoding/json gives float64 for
	// numbers). The asymmetric type assertions reflect that pipeline.
	if got := nestedGet(view.Effective, "download", "max_concurrent"); got != int64(before) {
		t.Errorf("view.Effective.max_concurrent = %v, want frozen %d", got, before)
	}
	if got := nestedGet(view.File, "download", "max_concurrent"); got != float64(32) {
		t.Errorf("view.File.max_concurrent = %v, want 32 (the patched value)", got)
	}
}

func TestPatch_HotKeyAppliesLive(t *testing.T) {
	mgr := newMgr(t, "")
	view, err := mgr.Patch(map[string]any{"log.level": "debug"})
	if err != nil {
		t.Fatalf("Patch: %v", err)
	}
	// log.level is hot-reloadable: effective must advance immediately.
	if got := nestedGet(view.Effective, "log", "level"); got != "debug" {
		t.Errorf("view.Effective.log.level = %v, want live-applied %q", got, "debug")
	}
	if len(view.PendingRestart) != 0 {
		t.Errorf("hot key should not need a restart, got pending_restart=%v", view.PendingRestart)
	}
}

func TestPatch_RestartKeyPendingThenReset(t *testing.T) {
	mgr := newMgr(t, "")
	// pixiv.bypass_sni is restart-required AND patchable (server.port is now
	// internal, so it can't drive this restart-required-key contract).
	view, err := mgr.Patch(map[string]any{"pixiv.bypass_sni": true})
	if err != nil {
		t.Fatalf("Patch: %v", err)
	}
	// effective stays at the startup value, file advances, and the key
	// surfaces in pending_restart.
	if got := nestedGet(view.Effective, "pixiv", "bypass_sni"); got != false {
		t.Errorf("view.Effective.pixiv.bypass_sni = %v, want frozen false", got)
	}
	if got := nestedGet(view.File, "pixiv", "bypass_sni"); got != true {
		t.Errorf("view.File.pixiv.bypass_sni = %v, want true", got)
	}
	if !slices.Contains(view.PendingRestart, "pixiv.bypass_sni") {
		t.Errorf("pending_restart = %v, want it to contain pixiv.bypass_sni", view.PendingRestart)
	}

	// Reverting the override clears the pending-restart marker.
	view, err = mgr.Reset([]string{"pixiv.bypass_sni"}, false)
	if err != nil {
		t.Fatalf("Reset: %v", err)
	}
	if len(view.PendingRestart) != 0 {
		t.Errorf("after reset, pending_restart should be empty, got %v", view.PendingRestart)
	}
}

// app.language is consumed by the frontend directly (via GET /config), so
// the backend only persists it — there's no restart gate. Patching must
// advance both File and Effective immediately, with nothing pending.
func TestPatch_AppLanguageLiveApplied(t *testing.T) {
	mgr := newMgr(t, "")
	view, err := mgr.Patch(map[string]any{"app.language": "ja"})
	if err != nil {
		t.Fatalf("Patch: %v", err)
	}
	if got := nestedGet(view.Effective, "app", "language"); got != "ja" {
		t.Errorf("view.Effective.app.language = %v, want %q", got, "ja")
	}
	if got := nestedGet(view.File, "app", "language"); got != "ja" {
		t.Errorf("view.File.app.language = %v, want %q", got, "ja")
	}
	if len(view.PendingRestart) != 0 {
		t.Errorf("pending_restart = %v, want empty", view.PendingRestart)
	}
}

// Patching a hot key back to its built-in default prunes it from the
// file layer; the live view must then report source=defaults and drop
// it from File, matching what's actually persisted.
func TestPatch_HotKeyToDefaultPrunesSource(t *testing.T) {
	mgr := newMgr(t, `{"log":{"level":"debug"}}`)
	if got := mustView(t, mgr).Sources["log.level"]; got != SourceFile {
		t.Fatalf("precondition: log.level source = %q, want file", got)
	}

	view, err := mgr.Patch(map[string]any{"log.level": "info"}) // "info" is the default
	if err != nil {
		t.Fatalf("Patch: %v", err)
	}
	if got := view.Sources["log.level"]; got != SourceDefaults {
		t.Errorf("source = %q, want defaults after reset-to-default", got)
	}
	if v := nestedGet(view.File, "log", "level"); v != nil {
		t.Errorf("File still carries pruned key: %v", v)
	}
	if v := nestedGet(view.Effective, "log", "level"); v != "info" {
		t.Errorf("effective log.level = %v, want info", v)
	}
}

func mustView(t *testing.T, mgr *Manager) *View {
	t.Helper()
	v, err := mgr.View()
	if err != nil {
		t.Fatalf("View: %v", err)
	}
	return v
}

func TestOnReload_FiresOnSuccessNotOnFailure(t *testing.T) {
	mgr := newMgr(t, "")
	var calls int
	var lastNew *Config
	mgr.OnReload(func(n *Config) {
		calls++
		lastNew = n
	})

	// A rejected patch (bad enum) must not fire the hook.
	if _, err := mgr.Patch(map[string]any{"log.level": "nope"}); err == nil {
		t.Fatal("expected validation error for bad log.level enum")
	}
	if calls != 0 {
		t.Fatalf("hook fired on a rejected patch: calls=%d", calls)
	}

	// A successful patch fires the hook once with the new config.
	if _, err := mgr.Patch(map[string]any{"log.level": "warn"}); err != nil {
		t.Fatalf("Patch: %v", err)
	}
	if calls != 1 {
		t.Fatalf("hook calls = %d, want 1", calls)
	}
	if lastNew == nil || lastNew.Log.Level != "warn" {
		t.Errorf("hook received wrong config: %+v", lastNew)
	}
}

func TestView_SourcesAndMasking(t *testing.T) {
	t.Setenv("PIXIVBIU_DOWNLOAD_MAX_CONCURRENT", "99")
	mgr := newMgr(t, `{"pixiv":{"proxy":"http://u:p@h:1"}}`)
	view, err := mgr.View()
	if err != nil {
		t.Fatalf("View: %v", err)
	}
	if view.Sources["download.max_concurrent"] != SourceEnv {
		t.Errorf("env source not labeled, sources=%v", view.Sources)
	}
	if view.Sources["pixiv.proxy"] != SourceFile {
		t.Errorf("file source not labeled, got %v", view.Sources["pixiv.proxy"])
	}
	if view.Sources["server.port"] != SourceDefaults {
		t.Errorf("defaults source not labeled, got %v", view.Sources["server.port"])
	}
	// proxy is sensitive: both file and effective views must mask it
	if eff := nestedGet(view.Effective, "pixiv", "proxy"); eff != SensitiveMask {
		t.Errorf("effective proxy not masked: %v", eff)
	}
	if fp := nestedGet(view.File, "pixiv", "proxy"); fp != SensitiveMask {
		t.Errorf("file proxy not masked: %v", fp)
	}
}

func TestView_CoercesEnvStringsToSchemaTypes(t *testing.T) {
	t.Setenv("PIXIVBIU_SERVER_PORT", "9090")
	t.Setenv("PIXIVBIU_PIXIV_BYPASS_SNI", "true")
	mgr := newMgr(t, "")
	view, err := mgr.View()
	if err != nil {
		t.Fatalf("View: %v", err)
	}
	port := nestedGet(view.Effective, "server", "port")
	if _, ok := port.(int64); !ok {
		t.Errorf("server.port should be int64 after env coercion, got %T (%v)", port, port)
	}
	sni := nestedGet(view.Effective, "pixiv", "bypass_sni")
	if b, ok := sni.(bool); !ok || !b {
		t.Errorf("pixiv.bypass_sni should be true (bool) after env coercion, got %T (%v)", sni, sni)
	}
}

func TestSchema_HasExpectedShape(t *testing.T) {
	mgr := newMgr(t, "")
	sc := mgr.Schema()
	if _, ok := sc.Fields["download.max_concurrent"]; !ok {
		t.Fatal("schema missing download.max_concurrent")
	}
	fm := sc.Fields["pixiv.proxy"]
	if fm == nil || !fm.Sensitive {
		t.Errorf("pixiv.proxy not flagged sensitive: %+v", fm)
	}
	uf := sc.Fields["download.ugoira.format"]
	if uf == nil || len(uf.Enum) == 0 {
		t.Errorf("ugoira.format enum missing: %+v", uf)
	}
	mc := sc.Fields["download.max_concurrent"]
	if mc == nil || mc.Min == nil || mc.Max == nil {
		t.Errorf("max_concurrent min/max missing: %+v", mc)
	}
}

func TestSchema_FlagsInternal(t *testing.T) {
	sc := newMgr(t, "").Schema()

	for _, key := range []string{
		"server.host", "server.port",
		"server.timeouts.read", "server.timeouts.write", "server.timeouts.shutdown",
		"pixiv.state_file", "download.referer", "download.store_file",
		"inbox.buffer_size", "inbox.progress_throttle", "inbox.heartbeat",
	} {
		if fm := sc.Fields[key]; fm == nil || !fm.Internal {
			t.Errorf("%s should be flagged internal: %+v", key, fm)
		}
		if !sc.IsInternal(key) {
			t.Errorf("IsInternal(%q) = false, want true", key)
		}
	}

	// A user-facing key must stay non-internal.
	if sc.IsInternal("download.max_concurrent") {
		t.Error("download.max_concurrent should not be internal")
	}

	// The JSON Schema document surfaces the flag for the frontend.
	props := sc.JSON["properties"].(map[string]any)
	server := props["server"].(map[string]any)["properties"].(map[string]any)
	port := server["port"].(map[string]any)
	if port["x-cfg-internal"] != true {
		t.Errorf("server.port JSON node missing x-cfg-internal: %+v", port)
	}
}

// rejectBadTemplate is the kind of cheap predicate-style validator the
// download package would register from main.go; it lets these tests
// exercise the validator wiring without taking on the download import.
func rejectBadTemplate(c *Config) error {
	if strings.Contains(c.Download.FileTemplate, "<<BAD>>") {
		return errors.New("file_template: rejected by test validator")
	}
	return nil
}

func newMgrWithValidators(t *testing.T, settingsBody string, vs ...func(*Config) error) (*Manager, error) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "settings.json")
	if settingsBody != "" {
		if err := os.WriteFile(path, []byte(settingsBody), 0o600); err != nil {
			t.Fatalf("write settings: %v", err)
		}
	}
	opts := make([]Option, 0, len(vs))
	for _, v := range vs {
		opts = append(opts, WithValidator(v))
	}
	return NewManager(path, opts...)
}

func TestNewManager_RunsValidators(t *testing.T) {
	body := `{"download":{"file_template":"<<BAD>>"}}`
	_, err := newMgrWithValidators(t, body, rejectBadTemplate)
	pe := &PatchError{}
	if !errors.As(err, &pe) || !strings.Contains(pe.Errors["_"], "rejected by test validator") {
		t.Errorf("expected validator error at startup, got: %v", err)
	}
}

func TestPatch_ValidatorRejectsAndFileUntouched(t *testing.T) {
	mgr, err := newMgrWithValidators(t, "", rejectBadTemplate)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	_, err = mgr.Patch(map[string]any{
		"download.file_template": "<<BAD>>",
	})
	pe := &PatchError{}
	if !errors.As(err, &pe) {
		t.Fatalf("expected PatchError, got: %v", err)
	}
	if !strings.Contains(pe.Errors["_"], "rejected by test validator") {
		t.Errorf("unexpected validator error: %v", pe.Errors)
	}
	if _, err := os.Stat(mgr.StorePath()); !os.IsNotExist(err) {
		t.Errorf("settings.json should not be written when validator rejects, stat err=%v", err)
	}
}

func TestPatch_ValidatorPatchErrorAttribution(t *testing.T) {
	v := func(c *Config) error {
		if !strings.Contains(c.Download.FileTemplate, "<<BAD>>") {
			return nil
		}
		return &PatchError{Errors: map[string]string{"download.file_template": "stub: bad syntax"}}
	}
	mgr, err := newMgrWithValidators(t, "", v)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	_, err = mgr.Patch(map[string]any{"download.file_template": "<<BAD>>"})
	pe := &PatchError{}
	if !errors.As(err, &pe) {
		t.Fatalf("expected PatchError, got: %v", err)
	}
	if pe.Errors["download.file_template"] == "" {
		t.Errorf("expected per-field attribution preserved, got: %v", pe.Errors)
	}
	if pe.Errors["_"] != "" {
		t.Errorf("expected no generic key when validator returned PatchError, got: %v", pe.Errors)
	}
}

func nestedGet(m map[string]any, keys ...string) any {
	var cur any = m
	for _, k := range keys {
		mm, ok := cur.(map[string]any)
		if !ok {
			return nil
		}
		cur = mm[k]
	}
	return cur
}
