package config

import (
	"fmt"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"time"
)

// GoType is the schema's view of a leaf's Go-side type. validateValue
// and coerceForView switch on this; using a named type makes the set
// closed at compile time so a typo in any one switch can't silently
// fall through.
type GoType string

const (
	GoTypeString   GoType = "string"
	GoTypeInt      GoType = "int"
	GoTypeBool     GoType = "bool"
	GoTypeDuration GoType = "duration"
)

// FieldMeta describes a single leaf setting.
// It backs both the generated JSON Schema and the sensitive/validation
// lookups used by Manager.Patch.
type FieldMeta struct {
	Key             string // dotted path, e.g. "download.max_concurrent"
	Category        string // top-level section ("download", "pixiv", …)
	GoType          GoType
	JSONType        string // JSON Schema "type"
	Description     string // human-readable
	Default         any    // value from defaults()
	Min             *int64 // for ints
	Max             *int64 // for ints
	Enum            []string
	Sensitive       bool
	RestartRequired bool
	Advanced        bool
	// Internal marks a setting as program-only (ops/maintenance, not UX):
	// it can only be changed by editing the config file. Manager.Patch and
	// the keyed Reset reject it, Reset(all) preserves it, and the frontend
	// renders it read-only.
	Internal bool
}

// Schema is the cached, reflected view of Config.
// JSON is the nested JSON Schema document handed to the frontend.
// Fields is the flat lookup keyed by dotted path.
type Schema struct {
	JSON   map[string]any
	Fields map[string]*FieldMeta
}

// IsSensitive returns whether the leaf at key is flagged sensitive.
// Unknown keys default to false (Patch's validation rejects them elsewhere).
func (s *Schema) IsSensitive(key string) bool {
	f, ok := s.Fields[key]
	return ok && f.Sensitive
}

// IsInternal returns whether the leaf at key is program-only (file-edit
// only). Unknown keys default to false.
func (s *Schema) IsInternal(key string) bool {
	f, ok := s.Fields[key]
	return ok && f.Internal
}

// BuildSchema reflects Config and returns the schema document.
// The result is intended to be built once at startup and treated as
// read-only thereafter.
func BuildSchema() (*Schema, error) {
	s := &Schema{
		JSON:   map[string]any{},
		Fields: map[string]*FieldMeta{},
	}
	defs := defaults()

	root := map[string]any{
		"$schema": "https://json-schema.org/draft/2020-12/schema",
		"type":    "object",
		"title":   "PixivBiu settings",
		"x-cfg-schema-version": SchemaVersion,
	}
	props := map[string]any{}
	root["properties"] = props

	t := reflect.TypeOf(Config{})
	if err := s.walk(t, "", "", props, defs); err != nil {
		return nil, err
	}

	s.JSON = root
	return s, nil
}

// walk recursively visits the struct, building both s.Fields and
// the corresponding JSON Schema object under parentProps.
func (s *Schema) walk(t reflect.Type, prefix, parentCategory string, parentProps map[string]any, defs map[string]any) error {
	if t.Kind() != reflect.Struct {
		return fmt.Errorf("walk: expected struct, got %s", t.Kind())
	}
	for i := 0; i < t.NumField(); i++ {
		f := t.Field(i)
		koanfName := strings.Split(f.Tag.Get("koanf"), ",")[0]
		if koanfName == "" || koanfName == "-" {
			continue
		}
		key := koanfName
		if prefix != "" {
			key = prefix + "." + koanfName
		}
		meta := parseTag(f.Tag.Get("cfg"))
		category := parentCategory
		if meta.category != "" {
			category = meta.category
		}

		ft := f.Type
		// Duration is also a struct-kindish thing (int64 alias); treat as leaf.
		if ft == reflect.TypeOf(time.Duration(0)) {
			s.addLeaf(key, category, GoTypeDuration, meta, defs[key], parentProps, koanfName)
			continue
		}
		switch ft.Kind() {
		case reflect.Struct:
			child := map[string]any{
				"type":       "object",
				"properties": map[string]any{},
			}
			if meta.description != "" {
				child["description"] = meta.description
			}
			if category != "" {
				child["x-cfg-category"] = category
			}
			parentProps[koanfName] = child
			if err := s.walk(ft, key, category, child["properties"].(map[string]any), defs); err != nil {
				return err
			}
		case reflect.String:
			s.addLeaf(key, category, GoTypeString, meta, defs[key], parentProps, koanfName)
		case reflect.Bool:
			s.addLeaf(key, category, GoTypeBool, meta, defs[key], parentProps, koanfName)
		case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
			reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
			s.addLeaf(key, category, GoTypeInt, meta, defs[key], parentProps, koanfName)
		default:
			return fmt.Errorf("walk %q: unsupported kind %s", key, ft.Kind())
		}
	}
	return nil
}

func (s *Schema) addLeaf(key, category string, goType GoType, meta cfgTag, def any, parentProps map[string]any, propName string) {
	fm := &FieldMeta{
		Key:             key,
		Category:        category,
		GoType:          goType,
		Description:     meta.description,
		Default:         def,
		Enum:            meta.enum,
		Sensitive:       meta.sensitive,
		RestartRequired: meta.restart,
		Advanced:        meta.advanced,
		Internal:        meta.internal,
	}
	switch goType {
	case GoTypeInt:
		fm.JSONType = "integer"
		fm.Min = meta.min
		fm.Max = meta.max
	case GoTypeBool:
		fm.JSONType = "boolean"
	case GoTypeDuration, GoTypeString:
		fm.JSONType = "string"
	}
	s.Fields[key] = fm

	js := map[string]any{"type": fm.JSONType}
	if def != nil {
		js["default"] = def
	}
	if fm.Description != "" {
		js["description"] = fm.Description
	}
	if fm.Min != nil {
		js["minimum"] = *fm.Min
	}
	if fm.Max != nil {
		js["maximum"] = *fm.Max
	}
	if len(fm.Enum) > 0 {
		// Sort enum for stable rendering; defaults() values keep their literal form.
		e := append([]string(nil), fm.Enum...)
		sort.Strings(e)
		anys := make([]any, len(e))
		for i, v := range e {
			anys[i] = v
		}
		js["enum"] = anys
	}
	if goType == GoTypeDuration {
		js["format"] = "duration"
		js["x-cfg-go-type"] = "duration"
		js["pattern"] = `^[0-9]+(ns|us|µs|ms|s|m|h)([0-9]+(ns|us|µs|ms|s|m|h))*$`
	}
	if category != "" {
		js["x-cfg-category"] = category
	}
	if fm.Sensitive {
		js["x-cfg-sensitive"] = true
	}
	if fm.RestartRequired {
		js["x-cfg-restart-required"] = true
	}
	if fm.Advanced {
		js["x-cfg-advanced"] = true
	}
	if fm.Internal {
		js["x-cfg-internal"] = true
	}
	parentProps[propName] = js
}

// cfgTag is the parsed form of a `cfg:"..."` struct tag.
type cfgTag struct {
	category    string
	description string
	enum        []string
	min, max    *int64
	sensitive   bool
	restart     bool
	advanced    bool
	internal    bool
}

func parseTag(raw string) cfgTag {
	var t cfgTag
	if raw == "" {
		return t
	}
	for _, part := range strings.Split(raw, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		key, val, _ := strings.Cut(part, "=")
		key = strings.TrimSpace(key)
		val = strings.TrimSpace(val)
		switch key {
		case "category":
			t.category = val
		case "desc":
			t.description = val
		case "enum":
			t.enum = strings.Split(val, "|")
		case "min":
			if n, err := strconv.ParseInt(val, 10, 64); err == nil {
				t.min = &n
			}
		case "max":
			if n, err := strconv.ParseInt(val, 10, 64); err == nil {
				t.max = &n
			}
		case "sensitive":
			t.sensitive = val == "" || strings.EqualFold(val, "true")
		case "restart":
			t.restart = val == "" || strings.EqualFold(val, "true")
		case "advanced":
			t.advanced = val == "" || strings.EqualFold(val, "true")
		case "internal":
			t.internal = val == "" || strings.EqualFold(val, "true")
		}
	}
	return t
}
