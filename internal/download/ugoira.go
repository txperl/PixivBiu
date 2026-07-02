package download

import (
	"archive/zip"
	"bytes"
	"context"
	"fmt"
	"image"
	"image/color/palette"
	"image/draw"
	"image/gif"
	_ "image/jpeg" // register JPEG decoder for ugoira frames
	_ "image/png"  // register PNG decoder for ugoira frames
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/HugoSmits86/nativewebp"
)

// UgoiraFormat names the target encoding for ugoira zip post-processing.
type UgoiraFormat string

const (
	UgoiraFormatWebP UgoiraFormat = "webp"
	UgoiraFormatGIF  UgoiraFormat = "gif"
	UgoiraFormatNone UgoiraFormat = "none"
)

// ConvertUgoira decodes each frame from the ugoira zip at zipPath and
// encodes it as an animated image in `format`. The resulting file is
// written next to the zip with the matching extension, and the
// returned path points at it. The original zip is removed after a
// successful conversion.
//
// For format=="none" / "" the function is a no-op and returns
// (zipPath, nil) — the zip is the final artefact.
//
// Cancellation: ctx is observed between decoded frames and on every
// Write into the output file. The CPU-bound segments inside the
// third-party encoders themselves are not interruptible, so worst-case
// latency to honour cancel is bounded by encoding one frame.
func ConvertUgoira(ctx context.Context, zipPath string, frames []UgoiraFrame, format UgoiraFormat) (string, error) {
	if format == "" || format == UgoiraFormatNone {
		return zipPath, nil
	}
	// Reject unknown formats before touching the filesystem. Otherwise
	// extForFormat's ".zip" fallback would make outPath == zipPath, and
	// os.Create + the error cleanup below would truncate then delete
	// the just-downloaded source archive.
	switch format {
	case UgoiraFormatWebP, UgoiraFormatGIF:
	default:
		return "", fmt.Errorf("ugoira: unsupported format %q", format)
	}
	if len(frames) == 0 {
		return "", fmt.Errorf("ugoira: no frames in metadata")
	}

	images, durations, err := loadFrames(ctx, zipPath, frames)
	if err != nil {
		return "", err
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}

	outPath := replaceExt(zipPath, extForFormat(format))
	out, err := os.Create(outPath)
	if err != nil {
		return "", fmt.Errorf("ugoira: create output: %w", err)
	}
	cw := ctxWriter{ctx: ctx, w: out}
	writeErr := func() error {
		switch format {
		case UgoiraFormatWebP:
			return encodeWebP(cw, images, durations)
		case UgoiraFormatGIF:
			return encodeGIF(cw, images, durations)
		}
		// Unreachable: format was validated above.
		return fmt.Errorf("ugoira: unsupported format %q", format)
	}()
	closeErr := out.Close()

	// Honour a cancel that landed between the last Write and Close.
	if writeErr == nil && closeErr == nil && ctx.Err() != nil {
		_ = os.Remove(outPath)
		return "", ctx.Err()
	}
	if writeErr != nil {
		_ = os.Remove(outPath)
		return "", writeErr
	}
	if closeErr != nil {
		_ = os.Remove(outPath)
		return "", fmt.Errorf("ugoira: close output: %w", closeErr)
	}
	_ = os.Remove(zipPath)
	return outPath, nil
}

// ctxWriter aborts further writes once ctx is done, propagating
// ctx.Err() back through the encoder so cancellation surfaces as a
// regular write failure.
type ctxWriter struct {
	ctx context.Context
	w   io.Writer
}

func (cw ctxWriter) Write(p []byte) (int, error) {
	if err := cw.ctx.Err(); err != nil {
		return 0, err
	}
	return cw.w.Write(p)
}

// loadFrames opens the zip once, decodes every named frame in order,
// and returns parallel slices ready for the encoders. Decoding runs
// in zip order rather than metadata order so that frame-name mismatches
// surface as an explicit error instead of silently producing a
// degenerate animation.
func loadFrames(ctx context.Context, zipPath string, frames []UgoiraFrame) ([]image.Image, []int, error) {
	zr, err := zip.OpenReader(zipPath)
	if err != nil {
		return nil, nil, fmt.Errorf("ugoira: open zip: %w", err)
	}
	defer zr.Close()

	// Index zip members by filename for O(1) lookup when iterating
	// the metadata frame order.
	byName := make(map[string]*zip.File, len(zr.File))
	for _, f := range zr.File {
		byName[f.Name] = f
	}

	images := make([]image.Image, 0, len(frames))
	durations := make([]int, 0, len(frames))

	for _, fr := range frames {
		if err := ctx.Err(); err != nil {
			return nil, nil, err
		}
		zf, ok := byName[fr.File]
		if !ok {
			return nil, nil, fmt.Errorf("ugoira: frame %q missing from zip", fr.File)
		}
		img, err := decodeZipFrame(zf)
		if err != nil {
			return nil, nil, fmt.Errorf("ugoira: decode %q: %w", fr.File, err)
		}
		ms := int(fr.Delay.Milliseconds())
		if ms <= 0 {
			ms = 40 // fallback ~25 fps if metadata is broken
		}
		images = append(images, img)
		durations = append(durations, ms)
	}
	return images, durations, nil
}

// Bounds on a single decoded ugoira frame. Frames come from Pixiv's own
// CDN, but decoding image bytes can allocate memory proportional to the
// dimensions declared in the header, so we cap both the compressed input
// and the pixel budget. This neutralises the whole decode/decompression-
// bomb OOM class — the same class as the golang.org/x/image TIFF-decoder
// advisory — independently of which decoder is linked in.
const (
	maxFrameBytes  = 32 << 20 // 32 MiB per frame (bounded read)
	maxFramePixels = 64 << 20 // 64 megapixels (width*height) decode cap
)

func decodeZipFrame(zf *zip.File) (image.Image, error) {
	// Cheap pre-check: reject an absurd *declared* size before reading.
	// The real cap is still enforced by decodeFrame, since this value
	// is attacker-controlled zip metadata and can lie.
	if zf.UncompressedSize64 > maxFrameBytes {
		return nil, fmt.Errorf("frame too large: %d bytes", zf.UncompressedSize64)
	}
	rc, err := zf.Open()
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	return decodeFrame(rc)
}

// decodeFrame reads at most maxFrameBytes from r, then does a header-only
// pass (image.DecodeConfig) to reject non-allowlisted formats and over-
// budget dimensions before any pixel buffer is allocated, and only then
// decodes the frame.
func decodeFrame(r io.Reader) (image.Image, error) {
	buf, err := io.ReadAll(io.LimitReader(r, maxFrameBytes+1))
	if err != nil {
		return nil, err
	}
	if len(buf) > maxFrameBytes {
		return nil, fmt.Errorf("frame exceeds %d bytes", maxFrameBytes)
	}
	// Header-only decode: no pixel memory is allocated yet.
	cfg, format, err := image.DecodeConfig(bytes.NewReader(buf))
	if err != nil {
		return nil, err
	}
	// Explicit allowlist. Only png/jpeg/gif/webp decoders are linked in
	// today; this switch keeps that guarantee even if another decoder
	// (e.g. tiff/bmp) is blank-imported by accident in the future.
	switch format {
	case "png", "jpeg", "gif", "webp":
	default:
		return nil, fmt.Errorf("unsupported frame format %q", format)
	}
	if int64(cfg.Width)*int64(cfg.Height) > maxFramePixels {
		return nil, fmt.Errorf("frame %dx%d exceeds pixel budget", cfg.Width, cfg.Height)
	}
	img, _, err := image.Decode(bytes.NewReader(buf))
	return img, err
}

// encodeWebP uses nativewebp.EncodeAll to emit an animated WebP.
// Durations are in ms, matching the Animation struct contract.
func encodeWebP(w io.Writer, images []image.Image, durationsMs []int) error {
	ani := &nativewebp.Animation{
		Images:    images,
		Durations: make([]uint, len(durationsMs)),
		Disposals: make([]uint, len(durationsMs)), // 0 = keep (default)
		LoopCount: 0,                              // 0 = loop forever
	}
	for i, d := range durationsMs {
		ani.Durations[i] = uint(d)
	}
	if err := nativewebp.EncodeAll(w, ani, nil); err != nil {
		return fmt.Errorf("ugoira: encode webp: %w", err)
	}
	return nil
}

// encodeGIF converts each RGBA frame to a paletted image (Plan9 web-
// safe palette) and writes an animated GIF. GIF delays are in
// 1/100th-second units; we round up so 40ms ≈ 4 centiseconds.
func encodeGIF(w io.Writer, images []image.Image, durationsMs []int) error {
	g := &gif.GIF{
		Image:     make([]*image.Paletted, 0, len(images)),
		Delay:     make([]int, 0, len(images)),
		Disposal:  make([]byte, 0, len(images)),
		LoopCount: 0,
	}
	for i, img := range images {
		bounds := img.Bounds()
		p := image.NewPaletted(bounds, palette.Plan9)
		draw.Draw(p, bounds, img, bounds.Min, draw.Src)
		g.Image = append(g.Image, p)
		// Centisecond delay, always ≥ 2 so players don't freeze.
		cs := (durationsMs[i] + 9) / 10
		if cs < 2 {
			cs = 2
		}
		g.Delay = append(g.Delay, cs)
		g.Disposal = append(g.Disposal, gif.DisposalNone)
	}
	if err := gif.EncodeAll(w, g); err != nil {
		return fmt.Errorf("ugoira: encode gif: %w", err)
	}
	return nil
}

// extForFormat maps UgoiraFormat to the leading-dot extension used
// by both the renderer and the file-rename step. Panics on an
// unknown format — callers must validate first (config.validate +
// ConvertUgoira's entry check).
func extForFormat(f UgoiraFormat) string {
	switch f {
	case UgoiraFormatWebP:
		return ".webp"
	case UgoiraFormatGIF:
		return ".gif"
	case UgoiraFormatNone:
		return ".zip"
	}
	panic(fmt.Sprintf("ugoira: extForFormat called with unvalidated format %q", f))
}

// replaceExt swaps the trailing extension of path for newExt (which
// must include the leading dot). If path has no extension, newExt is
// appended.
func replaceExt(path, newExt string) string {
	ext := filepath.Ext(path)
	if ext == "" {
		return path + newExt
	}
	return strings.TrimSuffix(path, ext) + newExt
}
