package download

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// buildTestZip writes a zip containing `n` distinct 16x16 PNG frames
// into a temp file and returns its path. Each frame is a solid fill
// in a cycling colour so decode produces different pixels per frame.
func buildTestZip(t *testing.T, n int) string {
	t.Helper()
	dir := t.TempDir()
	zipPath := filepath.Join(dir, "ugoira.zip")
	f, err := os.Create(zipPath)
	if err != nil {
		t.Fatalf("create zip: %v", err)
	}
	defer f.Close()
	zw := zip.NewWriter(f)
	for i := 0; i < n; i++ {
		w, err := zw.Create(frameName(i))
		if err != nil {
			t.Fatalf("zip entry: %v", err)
		}
		img := image.NewRGBA(image.Rect(0, 0, 16, 16))
		c := color.RGBA{uint8((i * 40) % 255), uint8((i * 70) % 255), uint8((i * 110) % 255), 255}
		for y := 0; y < 16; y++ {
			for x := 0; x < 16; x++ {
				img.Set(x, y, c)
			}
		}
		if err := png.Encode(w, img); err != nil {
			t.Fatalf("encode png: %v", err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("close zip: %v", err)
	}
	return zipPath
}

func frameName(i int) string {
	// Pixiv uses zero-padded names like 000000.jpg. Use the same
	// lexical shape so the zip member lookup path is exercised.
	return toSixDigit(i) + ".png"
}

func toSixDigit(i int) string {
	out := [6]byte{'0', '0', '0', '0', '0', '0'}
	for idx := 5; i > 0 && idx >= 0; idx-- {
		out[idx] = byte('0' + (i % 10))
		i /= 10
	}
	return string(out[:])
}

func frameMeta(n int) []UgoiraFrame {
	frames := make([]UgoiraFrame, n)
	for i := range frames {
		frames[i] = UgoiraFrame{File: frameName(i), Delay: 60 * time.Millisecond}
	}
	return frames
}

func TestConvertUgoira_WebP(t *testing.T) {
	zipPath := buildTestZip(t, 4)
	frames := frameMeta(4)

	out, err := ConvertUgoira(context.Background(), zipPath, frames, UgoiraFormatWebP)
	if err != nil {
		t.Fatalf("convert: %v", err)
	}
	if filepath.Ext(out) != ".webp" {
		t.Errorf("want .webp extension, got %q", out)
	}
	data, err := os.ReadFile(out)
	if err != nil {
		t.Fatalf("read output: %v", err)
	}
	// WebP files start with RIFF....WEBP
	if !bytes.HasPrefix(data, []byte("RIFF")) || !bytes.Contains(data[:16], []byte("WEBP")) {
		t.Errorf("output is not a WebP file (first 16 bytes: % x)", data[:16])
	}
	// VP8X container is required for animated WebP.
	if !bytes.Contains(data[:64], []byte("VP8X")) {
		t.Errorf("animated WebP must contain VP8X chunk")
	}
}

func TestConvertUgoira_GIF(t *testing.T) {
	zipPath := buildTestZip(t, 3)
	frames := frameMeta(3)

	out, err := ConvertUgoira(context.Background(), zipPath, frames, UgoiraFormatGIF)
	if err != nil {
		t.Fatalf("convert: %v", err)
	}
	if filepath.Ext(out) != ".gif" {
		t.Errorf("want .gif extension, got %q", out)
	}
	data, err := os.ReadFile(out)
	if err != nil {
		t.Fatalf("read output: %v", err)
	}
	if !bytes.HasPrefix(data, []byte("GIF89a")) && !bytes.HasPrefix(data, []byte("GIF87a")) {
		t.Errorf("output is not a GIF file (first bytes: % x)", data[:6])
	}
}

func TestConvertUgoira_None(t *testing.T) {
	zipPath := buildTestZip(t, 2)
	out, err := ConvertUgoira(context.Background(), zipPath, frameMeta(2), UgoiraFormatNone)
	if err != nil {
		t.Fatalf("convert: %v", err)
	}
	if out != zipPath {
		t.Errorf("format=none must return zip path unchanged, got %q", out)
	}
	if _, err := os.Stat(zipPath); err != nil {
		t.Errorf("zip should still exist, stat: %v", err)
	}
}

func TestConvertUgoira_RemovesZipAfterConvert(t *testing.T) {
	zipPath := buildTestZip(t, 2)
	if _, err := ConvertUgoira(context.Background(), zipPath, frameMeta(2), UgoiraFormatWebP); err != nil {
		t.Fatalf("convert: %v", err)
	}
	if _, err := os.Stat(zipPath); !os.IsNotExist(err) {
		t.Errorf("zip should have been removed, stat err: %v", err)
	}
}

func TestConvertUgoira_MissingFrame(t *testing.T) {
	zipPath := buildTestZip(t, 2)
	// Reference a frame name not in the zip.
	frames := []UgoiraFrame{
		{File: "does-not-exist.png", Delay: 40 * time.Millisecond},
	}
	if _, err := ConvertUgoira(context.Background(), zipPath, frames, UgoiraFormatWebP); err == nil {
		t.Fatal("expected error for missing frame, got nil")
	}
}

// TestCtxWriter covers the cancellation-aware writer used to make the
// encoders interruptible. A cancelled ctx must short-circuit Write
// before touching the underlying sink; an open ctx must pass through.
func TestCtxWriter(t *testing.T) {
	var sink bytes.Buffer

	ctx, cancel := context.WithCancel(context.Background())
	cw := ctxWriter{ctx: ctx, w: &sink}
	if n, err := cw.Write([]byte("ok")); n != 2 || err != nil {
		t.Fatalf("open ctx: want (2, nil), got (%d, %v)", n, err)
	}
	cancel()
	if n, err := cw.Write([]byte("nope")); n != 0 || !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled ctx: want (0, Canceled), got (%d, %v)", n, err)
	}
	if got := sink.String(); got != "ok" {
		t.Errorf("sink should only contain pre-cancel bytes, got %q", got)
	}
}

// Regression: a typo in download.ugoira.format used to make outPath
// collide with the source zip (extForFormat fell back to ".zip"),
// so os.Create truncated and the error-cleanup path deleted it. The
// function now fails fast on an unknown format, before any filesystem
// mutation, and the zip must be byte-identical after the call.
func TestConvertUgoira_UnsupportedFormatPreservesZip(t *testing.T) {
	zipPath := buildTestZip(t, 3)
	before, err := os.ReadFile(zipPath)
	if err != nil {
		t.Fatalf("read zip before: %v", err)
	}

	out, err := ConvertUgoira(context.Background(), zipPath, frameMeta(3), UgoiraFormat("lol"))
	if err == nil {
		t.Fatalf("expected error for unsupported format, got out=%q", out)
	}
	if out != "" {
		t.Errorf("out path on error should be empty, got %q", out)
	}

	after, err := os.ReadFile(zipPath)
	if err != nil {
		t.Fatalf("zip missing after failed convert: %v", err)
	}
	if !bytes.Equal(before, after) {
		t.Errorf("zip was mutated: before=%d bytes, after=%d bytes", len(before), len(after))
	}
}

// TestConvertUgoira_CancelBeforeStart verifies that a context already
// done at call time short-circuits to ctx.Err() and produces no output
// file, while leaving the source zip intact for a future retry.
func TestConvertUgoira_CancelBeforeStart(t *testing.T) {
	zipPath := buildTestZip(t, 4)
	frames := frameMeta(4)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	out, err := ConvertUgoira(ctx, zipPath, frames, UgoiraFormatWebP)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("want context.Canceled, got out=%q err=%v", out, err)
	}
	if _, statErr := os.Stat(zipPath); statErr != nil {
		t.Errorf("zip should be preserved on cancel, stat: %v", statErr)
	}
	outPath := replaceExt(zipPath, ".webp")
	if _, statErr := os.Stat(outPath); !os.IsNotExist(statErr) {
		t.Errorf("partial output should be removed on cancel, stat err: %v", statErr)
	}
}
