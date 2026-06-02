package update

import (
	"bytes"
	"context"
	"errors"
	"testing"

	"github.com/txperl/PixivBiu/internal/config"
)

// Apply is single-flight: a second call while one is already in progress is
// rejected as a conflict instead of racing two binary swaps on the same
// executable.
func TestApplyRejectsConcurrent(t *testing.T) {
	s := NewService("3.0.0", "txperl", "PixivBiu", config.UpdateConfig{}, "")
	s.applying.Store(true) // simulate an apply already running
	err := s.Apply(context.Background())
	var ue *Error
	if !errors.As(err, &ue) || ue.Kind != KindConflict {
		t.Fatalf("concurrent Apply = %v, want a KindConflict *Error", err)
	}
}

// readCapped must reject a stream larger than the cap rather than silently
// truncating it: the archive checksum doesn't cover the extracted binary, so a
// truncated member would otherwise be applied as a corrupt executable.
func TestReadCapped(t *testing.T) {
	// Larger than the cap → error, no partial data.
	if b, err := readCapped(bytes.NewReader(make([]byte, 11)), 10); err == nil {
		t.Errorf("readCapped(11, limit 10) = %d bytes, nil error; want oversize error", len(b))
	}
	// Exactly at the cap → returned whole (not truncated).
	if b, err := readCapped(bytes.NewReader(make([]byte, 10)), 10); err != nil || len(b) != 10 {
		t.Errorf("readCapped(10, limit 10) = (%d bytes, %v); want (10, nil)", len(b), err)
	}
	// Under the cap → returned verbatim.
	if b, err := readCapped(bytes.NewReader([]byte("hello")), 10); err != nil || string(b) != "hello" {
		t.Errorf("readCapped(5, limit 10) = (%q, %v); want (hello, nil)", b, err)
	}
}
