package main

import (
	"fmt"
	"log/slog"
	"os"
	"strings"

	"github.com/go-chi/httplog/v3"

	"github.com/txperl/PixivBiu/internal/config"
)

// parseLogLevel converts a config log level string into a slog.Level.
// Shared by newLogger and the log.level reload hook.
func parseLogLevel(s string) (slog.Level, error) {
	var level slog.Level
	if err := level.UnmarshalText([]byte(strings.ToUpper(s))); err != nil {
		return 0, fmt.Errorf("invalid log level %q: %w", s, err)
	}
	return level, nil
}

// newLogger builds the slog logger and returns the *slog.LevelVar that
// gates it, so the log.level reload hook can change the level live. The
// handler type is fixed by log.format (restart-required), so only the
// level is adjustable at runtime.
func newLogger(cfg config.LogConfig) (*slog.Logger, *slog.LevelVar, error) {
	level, err := parseLogLevel(cfg.Level)
	if err != nil {
		return nil, nil, err
	}
	levelVar := new(slog.LevelVar)
	levelVar.Set(level)

	opts := &slog.HandlerOptions{
		Level:       levelVar,
		ReplaceAttr: httplog.SchemaECS.ReplaceAttr,
	}
	var handler slog.Handler
	switch strings.ToLower(cfg.Format) {
	case "json":
		handler = slog.NewJSONHandler(os.Stdout, opts)
	case "", "text":
		handler = slog.NewTextHandler(os.Stdout, opts)
	default:
		return nil, nil, fmt.Errorf("invalid log format %q (want text|json)", cfg.Format)
	}
	return slog.New(handler), levelVar, nil
}
