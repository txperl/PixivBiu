package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"slices"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// SensitiveMask is the string returned in place of sensitive field
// values. PATCH treats receiving this value (or "") as "do not modify",
// so the frontend can safely round-trip a redacted GET back as a PATCH.
const SensitiveMask = "***"

// errInternalKey is the per-field message returned when a Patch or keyed
// Reset targets a program-only setting — those may only be changed by
// editing the config file directly.
const errInternalKey = "internal setting: edit the config file to change it"

// Source identifies which layer supplied a key's effective value.
type Source string

const (
	SourceDefaults Source = "defaults"
	SourceFile     Source = "file"
	SourceEnv      Source = "env"
)

// View is the wire-shape consumed by GET /config.
// Effective and File both have sensitive fields masked.
type View struct {
	Effective map[string]any    `json:"effective"`
	File      map[string]any    `json:"file"`
	Sources   map[string]Source `json:"sources"`
	// PendingRestart lists the restart-required dotted keys whose
	// persisted (file/env/default) value currently differs from the
	// value the running process started with. These are the changes
	// that won't take effect until the process restarts; hot-reloadable
	// keys never appear here because Effective already reflects them.
	PendingRestart []string `json:"pending_restart"`
	SchemaVersion  string   `json:"schema_version"`
}

// PatchError carries per-key validation failures for PATCH/POST reset.
// Keys are dotted setting paths (e.g. "download.max_concurrent"). The
// reserved key "_" is used for failures that don't bind to a specific
// field — empty bodies, mutually-exclusive flags, or service-level
// validator errors that didn't self-attribute.
type PatchError struct {
	Errors map[string]string
}

func (e *PatchError) Error() string {
	keys := make([]string, 0, len(e.Errors))
	for k := range e.Errors {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		parts = append(parts, fmt.Sprintf("%s: %s", k, e.Errors[k]))
	}
	return strings.Join(parts, "; ")
}

// effSnapshot is the merged (defaults → file → env) layered view plus
// per-key sources, swapped behind one atomic.Pointer so View() reads a
// mutually consistent pair without locking. It holds the fresh value
// for every key; buildView pins restart-required keys to the startup
// value at presentation time.
type effSnapshot struct {
	eff map[string]any
	src map[string]Source
}

// Manager owns the on-disk settings file, the schema, the startup
// snapshot, and the live "effective" view that drives hot-reload.
//
// Services register reload hooks via OnReload. On a successful
// Patch/Reset, Manager persists the new file layer, swaps the live
// effective snapshot, and fires the hooks so each service re-derives
// the config-dependent state it can change without a restart.
//
// The effective view is computed PER KEY in buildView: hot-reloadable
// keys reflect the freshly-applied value immediately, while
// restart-required keys stay pinned to the value the process started
// with (effSnap/srcSnap) until the next restart and surface in
// pending_restart. This keeps the file/effective/pending_restart triad
// mutually consistent and honest about what is actually running.
//
// envSnap / effSnap / srcSnap are frozen at NewManager time. cfg is the
// startup snapshot returned by Config().
type Manager struct {
	store      *Store
	schema     *Schema
	envSnap    map[string]any
	effSnap    map[string]any
	srcSnap    map[string]Source
	cfg        *Config
	validators []func(*Config) error

	// effView is swapped atomically on every successful Patch/Reset so
	// View() (which takes no lock) always reads a consistent snapshot.
	effView atomic.Pointer[effSnapshot]

	mu    sync.Mutex      // serialises Patch/Reset writes AND hook firing
	hooks []func(*Config) // reload subscribers; registered before serving
}

// Option configures a Manager at construction time.
type Option func(*Manager)

// WithValidator registers a candidate-config check that runs both at
// startup (against the file+env merged Config) and inside Patch/Reset
// before persisting. Services with non-trivial parse rules (download
// templates, pixiv proxy URL) inject themselves here so the same
// invariants gate startup AND PATCH — preventing a "settings save
// succeeded but next boot crashes" footgun.
//
// Returning *PatchError preserves per-field attribution; any other
// error is surfaced under the generic "_" key.
func WithValidator(fn func(*Config) error) Option {
	return func(m *Manager) { m.validators = append(m.validators, fn) }
}

// NewManager opens the settings file at path, builds the schema, and
// captures the immutable startup snapshot used by all subsequent reads.
func NewManager(path string, opts ...Option) (*Manager, error) {
	schema, err := BuildSchema()
	if err != nil {
		return nil, fmt.Errorf("build schema: %w", err)
	}
	store := NewStore(path)
	envSnap := snapshotEnv(schema)

	fileLayer, err := store.Load()
	if err != nil {
		return nil, err
	}
	k, err := buildKoanf(fileLayer)
	if err != nil {
		return nil, err
	}
	cfg, err := unmarshalConfig(k)
	if err != nil {
		return nil, err
	}
	eff, sources := snapshotEffective(schema, fileLayer, envSnap)

	m := &Manager{
		store:   store,
		schema:  schema,
		envSnap: envSnap,
		effSnap: eff,
		srcSnap: sources,
		cfg:     cfg,
	}
	// Seed the live view from the startup snapshot. effSnap/srcSnap are
	// read-only and effView is only ever replaced wholesale, so sharing
	// the maps is safe; a fresh process reports no pending restarts
	// because the live snapshot equals the startup one.
	m.effView.Store(&effSnapshot{eff: eff, src: sources})

	for _, opt := range opts {
		opt(m)
	}
	if err := m.runValidators(cfg); err != nil {
		return nil, err
	}
	return m, nil
}

// OnReload registers a hook fired after a successful Patch/Reset with
// the newly-applied config; each hook re-derives whatever
// hot-reloadable state it owns.
//
// Must be called during startup, before the HTTP server begins serving
// (registration is not synchronised). Hooks run synchronously under
// m.mu in registration order. A hook MUST NOT call back into Patch/Reset
// — that would deadlock on m.mu — and must not block.
func (m *Manager) OnReload(fn func(*Config)) {
	m.hooks = append(m.hooks, fn)
}

// Config returns the startup snapshot that services were initialised
// with. The pointer is stable for the Manager's lifetime; the pointed-to
// Config is treated as immutable and must not be modified by callers.
// No lock is required: Patch/Reset never re-assign m.cfg.
func (m *Manager) Config() *Config { return m.cfg }

func (m *Manager) Schema() *Schema   { return m.schema }
func (m *Manager) StorePath() string { return m.store.Path() }

// View returns the masked, layered view for GET /config.
// `Effective` reflects what the running services use: it advances on
// Patch/Reset for hot-reloadable keys and stays pinned to the startup
// value for restart-required keys (which then surface in
// `PendingRestart`). `File` always shows the persisted overrides.
func (m *Manager) View() (*View, error) {
	return m.buildView()
}

// Patch merges `patch` (flat dotted-key map; nested maps also accepted)
// into the file layer, revalidates the candidate config, and atomically
// writes the diff-against-defaults form to disk. Sensitive fields
// receiving the mask sentinel or "" are skipped.
//
// On success it applies the new config live: hot-reloadable keys take
// effect immediately (Effective advances and reload hooks fire), while
// restart-required keys stay pinned to the startup value and appear in
// View.PendingRestart until the process restarts.
func (m *Manager) Patch(patch map[string]any) (*View, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	flat := flatten("", patch)
	if len(flat) == 0 {
		return nil, &PatchError{Errors: map[string]string{
			"_": "patch must contain at least one setting",
		}}
	}
	if perr := m.precheckPatch(flat); perr != nil {
		return nil, perr
	}

	fileLayer, err := m.store.Load()
	if err != nil {
		return nil, err
	}
	for k, v := range flat {
		if m.schema.IsSensitive(k) && isMaskSentinel(v) {
			continue
		}
		fileLayer[k] = v
	}
	newCfg, persisted, err := m.validateAndPersist(fileLayer)
	if err != nil {
		return nil, err
	}
	m.applyLive(persisted, newCfg)
	return m.buildView()
}

// Reset removes keys from the file layer (or clears it entirely with
// all=true), reverting affected fields to the next layer's value. Like
// Patch, the revert applies live for hot-reloadable keys and waits for
// a restart for restart-required ones. `all` and `keys` are mutually
// exclusive: passing both is rejected as a 400 so a UI bug can't
// accidentally wipe the entire override layer.
//
// Internal keys are program-only: a keyed Reset of one is rejected, and
// Reset(all) preserves their existing file overrides — they may only be
// changed by editing the config file directly. Reset(all) also preserves
// hidden keys: they're absent from the UI's rendered schema, so a blanket
// reset must not wipe a setting the user was never shown (a keyed Reset of a
// hidden key, which only the API can issue, is still honoured).
func (m *Manager) Reset(keys []string, all bool) (*View, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if all && len(keys) > 0 {
		return nil, &PatchError{Errors: map[string]string{
			"_": "`all` and `keys` are mutually exclusive",
		}}
	}
	if !all && len(keys) == 0 {
		return nil, &PatchError{Errors: map[string]string{
			"_": "must set `all: true` or pass non-empty `keys`",
		}}
	}

	var fileLayer map[string]any
	if all {
		// `all` clears the override layer but preserves keys the UI can't
		// manage: internal keys are program-only (file-edit only), and hidden
		// keys are absent from the rendered schema entirely. A UI "reset all"
		// must not silently wipe a setting it never showed the user.
		current, err := m.store.Load()
		if err != nil {
			return nil, err
		}
		fileLayer = map[string]any{}
		for k, v := range current {
			if fm, ok := m.schema.Fields[k]; ok && (fm.Internal || fm.Hidden) {
				fileLayer[k] = v
			}
		}
	} else {
		current, err := m.store.Load()
		if err != nil {
			return nil, err
		}
		fileLayer = current
		bad := map[string]string{}
		for _, k := range keys {
			fm, ok := m.schema.Fields[k]
			if !ok {
				bad[k] = "unknown setting key"
				continue
			}
			if fm.Internal {
				bad[k] = errInternalKey
				continue
			}
			delete(fileLayer, k)
		}
		if len(bad) > 0 {
			return nil, &PatchError{Errors: bad}
		}
	}

	newCfg, persisted, err := m.validateAndPersist(fileLayer)
	if err != nil {
		return nil, err
	}
	m.applyLive(persisted, newCfg)
	return m.buildView()
}

// validateAndPersist rebuilds the candidate Config from the proposed
// file layer to confirm it would parse cleanly, runs the registered
// validators, then strips entries that match defaults (diff-only) and
// writes the result atomically. It returns the parsed Config and the
// pruned layer that was actually persisted, so applyLive snapshots the
// same shape that lands on disk (otherwise a key reset to its default
// would still be labelled source=file in the live view).
//
// Caller MUST hold m.mu — the lock protects the read-modify-write of
// the on-disk file (concurrent Patch/Reset would otherwise lose writes).
func (m *Manager) validateAndPersist(fileLayer map[string]any) (*Config, map[string]any, error) {
	k, err := buildKoanf(fileLayer)
	if err != nil {
		return nil, nil, err
	}
	cfg, err := unmarshalConfig(k)
	if err != nil {
		return nil, nil, &PatchError{Errors: map[string]string{"_": err.Error()}}
	}
	if err := m.runValidators(cfg); err != nil {
		return nil, nil, err
	}
	pruned := pruneAgainstDefaults(fileLayer)
	if err := m.store.Save(pruned); err != nil {
		return nil, nil, err
	}
	return cfg, pruned, nil
}

// applyLive recomputes the merged effective snapshot for the just-
// persisted (pruned) file layer, swaps it in, and fires the reload
// hooks. The snapshot holds fresh values for every key; buildView pins
// restart-required keys back to the startup value at presentation time.
// Caller MUST hold m.mu — hooks run under it, so a hook must never call
// Patch/Reset.
func (m *Manager) applyLive(persisted map[string]any, newCfg *Config) {
	eff, src := snapshotEffective(m.schema, persisted, m.envSnap)
	m.effView.Store(&effSnapshot{eff: eff, src: src})
	for _, h := range m.hooks {
		h(newCfg)
	}
}

// runValidators runs every registered validator against cfg, returning
// the first failure. *PatchError returns are passed through so per-field
// attribution survives; bare errors are wrapped under the generic "_"
// key.
func (m *Manager) runValidators(cfg *Config) error {
	for _, v := range m.validators {
		err := v(cfg)
		if err == nil {
			continue
		}
		var pe *PatchError
		if errors.As(err, &pe) {
			return pe
		}
		return &PatchError{Errors: map[string]string{"_": err.Error()}}
	}
	return nil
}

// precheckPatch validates dotted keys, types, ranges and enums against
// the schema. It returns nil when the patch can proceed to merge.
func (m *Manager) precheckPatch(flat map[string]any) error {
	bad := map[string]string{}
	for k, v := range flat {
		fm, ok := m.schema.Fields[k]
		if !ok {
			bad[k] = "unknown setting key"
			continue
		}
		if fm.Internal {
			bad[k] = errInternalKey
			continue
		}
		if fm.Sensitive && isMaskSentinel(v) {
			continue // drop later
		}
		if err := validateValue(fm, v); err != nil {
			bad[k] = err.Error()
		}
	}
	if len(bad) > 0 {
		return &PatchError{Errors: bad}
	}
	return nil
}

// buildView returns the masked, layered view in a single pass over the
// schema. Effective + sources come from the live snapshot, but
// restart-required keys are pinned to the startup value (the running
// services still use it) and collected into PendingRestart when they've
// drifted. File is read fresh each call so a PATCH's persisted change is
// visible immediately. No lock: effView is atomic and the other reads
// are of immutable state or the independent on-disk file.
func (m *Manager) buildView() (*View, error) {
	fileLayer, err := m.store.Load()
	if err != nil {
		return nil, err
	}

	live := m.effView.Load()
	eff := make(map[string]any, len(live.eff))
	srcs := make(map[string]Source, len(live.src))
	pending := []string{} // non-nil so the JSON view is [] rather than null
	for k, fm := range m.schema.Fields {
		v, src := live.eff[k], live.src[k]
		if fm.RestartRequired {
			if !sameJSON(v, m.effSnap[k]) {
				pending = append(pending, k)
			}
			v, src = m.effSnap[k], m.srcSnap[k]
		}
		if fm.Sensitive {
			v = maskValue(v)
		}
		eff[k] = v
		srcs[k] = src
	}
	sort.Strings(pending)

	fileMasked := make(map[string]any, len(fileLayer))
	for k, v := range fileLayer {
		if m.schema.IsSensitive(k) {
			v = maskValue(v)
		}
		fileMasked[k] = v
	}

	return &View{
		Effective:      unflatten(eff),
		File:           unflatten(fileMasked),
		Sources:        srcs,
		PendingRestart: pending,
		SchemaVersion:  SchemaVersion,
	}, nil
}

// snapshotEffective freezes the layered (defaults → file → env) view
// at startup, with per-key source labels. The values are coerced into
// their schema-declared types so env-string entries don't bleed into
// the API response.
func snapshotEffective(schema *Schema, fileLayer, envSnap map[string]any) (map[string]any, map[string]Source) {
	eff := make(map[string]any, len(schema.Fields))
	sources := make(map[string]Source, len(schema.Fields))
	defs := defaults()
	for k, fm := range schema.Fields {
		val, src := defs[k], SourceDefaults
		if v, ok := fileLayer[k]; ok {
			val, src = v, SourceFile
		}
		if v, ok := envSnap[k]; ok {
			val, src = v, SourceEnv
		}
		eff[k] = coerceForView(fm, val)
		sources[k] = src
	}
	return eff, sources
}

// snapshotEnv enumerates PIXIVBIU_* env vars that resolve to known
// schema keys. Mirrors koanf's env provider but yields a plain map so
// we can label per-key sources without re-running the koanf pipeline.
// Called once at NewManager time and treated as immutable thereafter.
func snapshotEnv(schema *Schema) map[string]any {
	known := make(map[string]struct{}, len(schema.Fields))
	for k := range schema.Fields {
		known[k] = struct{}{}
	}
	resolver := newEnvKeyResolver(known)
	out := map[string]any{}
	for _, kv := range os.Environ() {
		if !strings.HasPrefix(kv, envPrefix) {
			continue
		}
		name, val, _ := strings.Cut(kv, "=")
		key := resolver(name)
		if _, ok := known[key]; !ok {
			continue
		}
		out[key] = val
	}
	return out
}

// pruneAgainstDefaults drops keys whose value matches the built-in
// default. Comparison is done via JSON encoding to normalise the
// int-vs-float64 mismatch produced by encoding/json.
//
// It compares against the static baseDefaults, not defaults(): app.update.
// channel has no static default (it is build-derived, see SetDefaultUpdate
// channel) and so is absent here, which means it is never pruned. That is
// deliberate — diff-only pruning against the live build's default would
// silently drop an explicit channel choice that happens to equal the running
// build's default (e.g. "beta" saved on a beta build), so the override would
// vanish and revert to stable after updating to a stable build. Keeping the
// key makes an explicitly-chosen channel durable across builds; an unset
// channel still has nothing persisted and follows the build-derived default.
func pruneAgainstDefaults(flat map[string]any) map[string]any {
	out := map[string]any{}
	defs := baseDefaults()
	for k, v := range flat {
		if def, ok := defs[k]; ok && sameJSON(v, def) {
			continue
		}
		out[k] = v
	}
	return out
}

func sameJSON(a, b any) bool {
	aj, errA := json.Marshal(a)
	bj, errB := json.Marshal(b)
	if errA != nil || errB != nil {
		return false
	}
	return string(aj) == string(bj)
}

func isMaskSentinel(v any) bool {
	s, ok := v.(string)
	if !ok {
		return false
	}
	return s == SensitiveMask || s == ""
}

func maskValue(v any) any {
	if v == nil {
		return ""
	}
	s, ok := v.(string)
	if !ok {
		return SensitiveMask
	}
	if s == "" {
		return ""
	}
	return SensitiveMask
}

// validateValue checks type + range + enum constraints for a single
// leaf. JSON unmarshal hands numbers in as float64, so int validation
// accepts whole-valued floats and rejects fractional ones.
func validateValue(fm *FieldMeta, v any) error {
	switch fm.GoType {
	case GoTypeString:
		if _, ok := v.(string); !ok {
			return fmt.Errorf("expected string, got %T", v)
		}
		if len(fm.Enum) > 0 {
			if !slices.Contains(fm.Enum, v.(string)) {
				return fmt.Errorf("must be one of %s", strings.Join(fm.Enum, "|"))
			}
		}
	case GoTypeBool:
		if _, ok := v.(bool); !ok {
			return fmt.Errorf("expected boolean, got %T", v)
		}
	case GoTypeInt:
		n, err := toInt64(v)
		if err != nil {
			return err
		}
		if fm.Min != nil && n < *fm.Min {
			return fmt.Errorf("must be >= %d", *fm.Min)
		}
		if fm.Max != nil && n > *fm.Max {
			return fmt.Errorf("must be <= %d", *fm.Max)
		}
	case GoTypeDuration:
		s, ok := v.(string)
		if !ok {
			return fmt.Errorf("expected duration string, got %T", v)
		}
		if s == "" {
			return nil
		}
		if _, err := time.ParseDuration(s); err != nil {
			return fmt.Errorf("invalid duration: %w", err)
		}
	}
	return nil
}

// coerceForView normalises a raw layered value to the schema's leaf type
// so the GET response uses ints, bools, and the like — not the string
// form env vars arrive in.
func coerceForView(fm *FieldMeta, v any) any {
	if v == nil {
		return nil
	}
	switch fm.GoType {
	case GoTypeInt:
		if s, ok := v.(string); ok {
			var n int64
			if _, err := fmt.Sscanf(s, "%d", &n); err == nil {
				return n
			}
			return v
		}
		if n, err := toInt64(v); err == nil {
			return n
		}
	case GoTypeBool:
		if s, ok := v.(string); ok {
			switch strings.ToLower(s) {
			case "true", "1", "yes", "on":
				return true
			case "false", "0", "no", "off":
				return false
			}
		}
	}
	return v
}

func toInt64(v any) (int64, error) {
	switch x := v.(type) {
	case int:
		return int64(x), nil
	case int64:
		return x, nil
	case float64:
		if x != float64(int64(x)) {
			return 0, fmt.Errorf("expected integer, got fractional %v", x)
		}
		return int64(x), nil
	case json.Number:
		return x.Int64()
	}
	return 0, fmt.Errorf("expected integer, got %T", v)
}
