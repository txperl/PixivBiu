package download

import (
	"bytes"
	"crypto/rand"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"text/template"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/txperl/PixivBiu/internal/config"
)

// NameContext is the root object passed to every template. Field
// names map to template identifiers (e.g. {{.Title}} / {{.Index}}).
//
// Now is set once per Job so that every file within a single Job
// resolves to the same OutputDir timestamp (avoids the "midnight
// rollover splits a 20-page manga into two dated folders" case).
type NameContext struct {
	IllustID  int64
	Title     string
	Type      string
	UserID    int64
	UserName  string
	CreatedAt time.Time
	Now       time.Time
	Index     int
	Ext       string // includes leading dot, e.g. ".jpg"
	Home      string
	Root      string
}

// Renderer holds pre-parsed templates. Build it once at startup from
// DownloadConfig so that bad template syntax fails the server boot
// rather than surfacing mid-download.
//
// BaseDir anchors a relative `output_dir` so the on-disk write path
// does not drift with the process CWD. Empty BaseDir leaves relative
// paths unresolved.
type Renderer struct {
	OutputDir *template.Template
	FileName  *template.Template
	FileGroup *template.Template
	BaseDir   string
}

// NewRenderer parses all three templates with the shared funcmap.
// Any parse error short-circuits and identifies which template is
// broken so operators can fix config.yaml quickly. baseDir anchors a
// relative `output_dir`; pass ExecRoot() in production.
func NewRenderer(cfg config.DownloadConfig, baseDir string) (*Renderer, error) {
	fm := funcMap()
	out, err := template.New("output_dir").Funcs(fm).Parse(cfg.OutputDir)
	if err != nil {
		return nil, fmt.Errorf("parse output_dir template: %w", err)
	}
	file, err := template.New("file_template").Funcs(fm).Parse(cfg.FileTemplate)
	if err != nil {
		return nil, fmt.Errorf("parse file_template: %w", err)
	}
	group, err := template.New("file_group_template").Funcs(fm).Parse(cfg.FileGroupTemplate)
	if err != nil {
		return nil, fmt.Errorf("parse file_group_template: %w", err)
	}
	return &Renderer{OutputDir: out, FileName: file, FileGroup: group, BaseDir: baseDir}, nil
}

// RenderRelativePath executes `tmpl` against ctx and returns a cleaned,
// sanitised path that is ALWAYS relative. Every path segment is run
// through Sanitize even if the template author did not pipe through
// the `sanitize` function; this is the last-line-of-defense against
// illegal filesystem characters leaking from user-supplied titles.
//
// A leading "/" in the rendered output is stripped — this is the
// documented behaviour for file_template / file_group_template so a
// user's leading "/" is normalised into a sub-path under output_dir
// rather than escaping it. Use RenderRootPath for the output-dir
// template where an absolute anchor must be preserved.
func (r *Renderer) RenderRelativePath(tmpl *template.Template, ctx NameContext) (string, error) {
	raw, err := executeTemplate(tmpl, ctx)
	if err != nil {
		return "", err
	}
	cleaned, err := cleanSegments(tmpl.Name(), filepath.ToSlash(raw))
	if err != nil {
		return "", err
	}
	if len(cleaned) == 0 {
		return "", fmt.Errorf("render template %q: empty path", tmpl.Name())
	}
	return filepath.FromSlash(path.Join(cleaned...)), nil
}

// RenderRootPath is the absolute-aware variant for the output-dir
// template. Absolute inputs stay absolute (the anchor is preserved);
// relative inputs stay relative. A bare anchor (e.g. output_dir: "/")
// is legal and returns just the anchor.
func (r *Renderer) RenderRootPath(tmpl *template.Template, ctx NameContext) (string, error) {
	raw, err := executeTemplate(tmpl, ctx)
	if err != nil {
		return "", err
	}

	// VolumeName pulls off a Windows drive / UNC prefix ("" on POSIX
	// or when the input has no volume). ToSlash after the volume
	// because Split must work on forward slashes.
	volume := filepath.VolumeName(raw)
	rest := filepath.ToSlash(raw[len(volume):])
	anchored := strings.HasPrefix(rest, "/")

	cleaned, err := cleanSegments(tmpl.Name(), rest)
	if err != nil {
		return "", err
	}
	if len(cleaned) == 0 && volume == "" && !anchored {
		return "", fmt.Errorf("render template %q: empty path", tmpl.Name())
	}

	joined := path.Join(cleaned...)
	if anchored {
		joined = "/" + joined
	}
	result := filepath.FromSlash(volume + joined)
	if r.BaseDir != "" && !filepath.IsAbs(result) {
		result = filepath.Join(r.BaseDir, result)
	}
	return result, nil
}

// executeTemplate runs tmpl and wraps errors with the template name.
func executeTemplate(tmpl *template.Template, ctx NameContext) (string, error) {
	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, ctx); err != nil {
		return "", fmt.Errorf("render template %q: %w", tmpl.Name(), err)
	}
	return buf.String(), nil
}

// cleanSegments splits a slash-normalised path into sanitised
// segments. Shared by RenderRelativePath and RenderRootPath so both
// methods apply identical per-segment rules.
func cleanSegments(tmplName, raw string) ([]string, error) {
	segments := strings.Split(raw, "/")
	cleaned := make([]string, 0, len(segments))
	for _, seg := range segments {
		if seg == "" || seg == "." {
			continue
		}
		if seg == ".." {
			return nil, fmt.Errorf("render template %q: segment %q not allowed", tmplName, seg)
		}
		cleaned = append(cleaned, Sanitize(seg))
	}
	if len(cleaned) > 0 {
		last := cleaned[len(cleaned)-1]
		cleaned[len(cleaned)-1] = truncFilename(last, 240)
	}
	return cleaned, nil
}

// EnsureWithinRoot reports whether child is inside root (after
// absolute normalisation). Used to guarantee that sanitisation or
// template logic didn't produce a path that jumps out via symlinks
// or relative shenanigans.
func EnsureWithinRoot(root, child string) error {
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return fmt.Errorf("resolve root: %w", err)
	}
	absChild, err := filepath.Abs(child)
	if err != nil {
		return fmt.Errorf("resolve child: %w", err)
	}
	rel, err := filepath.Rel(absRoot, absChild)
	if err != nil {
		return fmt.Errorf("relativise: %w", err)
	}
	if strings.HasPrefix(rel, "..") || rel == ".." {
		return fmt.Errorf("path %q escapes output root %q", child, root)
	}
	return nil
}

// Sanitize replaces filesystem-illegal characters, control bytes,
// and leading/trailing whitespace+dots (Windows quirk) with `_`.
//
// Rules:
//   - Characters rejected by common filesystems: / \ : * ? " < > |
//   - Control characters (< 0x20) and DEL
//   - The single-byte result of an invalid UTF-8 segment
//   - Trailing spaces and dots (Windows disallows these at end)
//   - Empty result is replaced with "_" to avoid blank segments
func Sanitize(s string) string {
	if s == "" {
		return "_"
	}
	var b strings.Builder
	b.Grow(len(s))
	for i := 0; i < len(s); {
		r, size := utf8.DecodeRuneInString(s[i:])
		if r == utf8.RuneError && size == 1 {
			b.WriteByte('_')
			i++
			continue
		}
		if isForbidden(r) {
			b.WriteByte('_')
		} else {
			b.WriteRune(r)
		}
		i += size
	}
	out := strings.TrimRightFunc(b.String(), func(r rune) bool {
		return r == ' ' || r == '.'
	})
	out = strings.TrimLeft(out, " ")
	if out == "" {
		return "_"
	}
	return out
}

func isForbidden(r rune) bool {
	switch r {
	case '/', '\\', ':', '*', '?', '"', '<', '>', '|':
		return true
	}
	if r < 0x20 || r == 0x7f {
		return true
	}
	return false
}

// truncFilename shortens name to max bytes (UTF-8 aware) while
// preserving its extension. Returns name unchanged when already under
// the limit.
func truncFilename(name string, max int) string {
	if len(name) <= max {
		return name
	}
	ext := filepath.Ext(name)
	if len(ext) >= max {
		// Pathological case: extension alone overflows. Drop it.
		return truncUTF8(name, max)
	}
	base := strings.TrimSuffix(name, ext)
	base = truncUTF8(base, max-len(ext))
	return base + ext
}

// truncUTF8 truncates s to at most max bytes without splitting a
// multi-byte rune. Also strips trailing whitespace left over from
// the cut. Used internally by the filesystem-limit guard, NOT by
// the template `trunc` function — which is rune-based.
func truncUTF8(s string, max int) string {
	if len(s) <= max {
		return s
	}
	cut := max
	// Walk back to a rune boundary.
	for cut > 0 && !utf8.RuneStart(s[cut]) {
		cut--
	}
	return strings.TrimRightFunc(s[:cut], unicode.IsSpace)
}

// truncRunes truncates s to at most n characters (runes), not bytes.
// This is what the template `trunc` func uses: a pixiv title like
// "曲奇可愛い" has 5 runes but 13 bytes, and users writing
// `{{.Title | trunc 3}}` expect the first 3 characters, not 3 bytes
// (which would yield 1 char or nothing). A non-positive n returns "".
func truncRunes(s string, n int) string {
	if n <= 0 {
		return ""
	}
	count := 0
	for i := range s {
		if count == n {
			return strings.TrimRightFunc(s[:i], unicode.IsSpace)
		}
		count++
	}
	return s
}

// funcMap is the template func set. Kept small; no sprig.
func funcMap() template.FuncMap {
	return template.FuncMap{
		"sanitize": Sanitize,
		"pad": func(width int, v any) string {
			return fmt.Sprintf("%0*d", width, toInt(v))
		},
		"date": func(layout string, t time.Time) string {
			if t.IsZero() {
				return ""
			}
			return t.Format(layout)
		},
		"lower": strings.ToLower,
		"upper": strings.ToUpper,
		"trunc": func(n int, s string) string {
			return truncRunes(s, n)
		},
		"default": func(fallback string, v string) string {
			if v == "" {
				return fallback
			}
			return v
		},
	}
}

// toInt normalises the value passed through a template pipeline into
// an int. pad only makes sense for integral values, but the template
// engine may carry int32/int64/int depending on context.
func toInt(v any) int {
	switch x := v.(type) {
	case int:
		return x
	case int32:
		return int(x)
	case int64:
		return int(x)
	case uint:
		return int(x)
	case uint32:
		return int(x)
	case uint64:
		return int(x)
	case float32:
		return int(x)
	case float64:
		return int(x)
	}
	return 0
}

// ExtFromURL extracts the file extension from a URL path, preserving
// the leading dot. Query strings and fragments are stripped. Empty
// result means "no extension" — caller may fall back to a default.
func ExtFromURL(u string) string {
	if i := strings.IndexAny(u, "?#"); i >= 0 {
		u = u[:i]
	}
	ext := path.Ext(u)
	return ext
}

// ResolveCollision returns base when it is free, otherwise appends
// " (1)", " (2)", … to the stem matching Chrome / Firefox / Finder.
// The numbered scan caps at 9999 attempts before switching to a
// random 8-hex-digit suffix, so a directory pre-filled with every
// "name (n).ext" through 9999 still resolves to a fresh path.
func ResolveCollision(base string, reserved map[string]struct{}) string {
	return resolveCollisionWith(base, reserved, fileExists)
}

func resolveCollisionWith(base string, reserved map[string]struct{}, exists func(string) bool) string {
	ext := filepath.Ext(base)
	stem := strings.TrimSuffix(base, ext)
	suffix := findFreeSuffix(func(s string) bool {
		return !taken(stem+s+ext, reserved, exists)
	})
	return stem + suffix + ext
}

// ResolveCollisionPair resolves a single " (n)" suffix such that both
// `base` and the same path with its extension swapped to `altExt` are
// free in disk + reserved. Used for ugoira where the worker writes a
// `.zip` intermediate but the eventual artefact is `.webp`/`.gif` —
// resolving only one path would leave the other vulnerable to
// overwriting an existing same-named file.
func ResolveCollisionPair(base, altExt string, reserved map[string]struct{}) (string, string) {
	return resolveCollisionPairWith(base, altExt, reserved, fileExists)
}

func resolveCollisionPairWith(base, altExt string, reserved map[string]struct{}, exists func(string) bool) (string, string) {
	ext := filepath.Ext(base)
	stem := strings.TrimSuffix(base, ext)
	suffix := findFreeSuffix(func(s string) bool {
		return !taken(stem+s+ext, reserved, exists) && !taken(stem+s+altExt, reserved, exists)
	})
	return stem + suffix + ext, stem + suffix + altExt
}

// findFreeSuffix returns "" if the bare (no-suffix) candidate set is
// free, otherwise the lowest " (n)" with n ∈ [1, 9999] that is free,
// otherwise a random 8-hex-digit fallback that has also been checked
// against `free`. `free` reports whether a candidate set built around
// the given suffix is collision-free.
func findFreeSuffix(free func(suffix string) bool) string {
	if free("") {
		return ""
	}
	for i := 1; i <= 9999; i++ {
		s := fmt.Sprintf(" (%d)", i)
		if free(s) {
			return s
		}
	}
	// 64 tries × 32 bits each: cumulative failure probability ≈ 2⁻²⁶,
	// effectively impossible unless `free` is misbehaving.
	var buf [4]byte
	for range 64 {
		_, _ = rand.Read(buf[:])
		s := fmt.Sprintf(" (%x)", buf)
		if free(s) {
			return s
		}
	}
	// Last-resort: return an unchecked suffix. Caller has to live
	// with whatever `free` claims; cleanup is ENOENT-tolerant anyway.
	_, _ = rand.Read(buf[:])
	return fmt.Sprintf(" (%x)", buf)
}

func taken(path string, reserved map[string]struct{}, exists func(string) bool) bool {
	if _, ok := reserved[path]; ok {
		return true
	}
	return exists(path)
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// HomeDir returns the user's home dir, or empty on error. Used to
// populate NameContext.Home for templates that want {{.Home}}.
func HomeDir() string {
	h, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return h
}

// ExecRoot returns the directory of the running executable, or "."
// on error. Populates NameContext.Root and anchors a relative
// download.output_dir.
//
// `go run` places the built binary under a `go-build*` temp directory
// that the toolchain wipes on process exit. Anchoring downloads there
// would silently destroy dev-mode artefacts and leave the persisted
// store pointing at missing files, so we detect that layout and fall
// back to the process CWD (which under `make dev` is the repo root).
func ExecRoot() string {
	exe, err := os.Executable()
	if err != nil {
		return "."
	}
	cwd, cwdErr := os.Getwd()
	if cwdErr != nil {
		cwd = "."
	}
	return resolveExecRoot(exe, cwd)
}

// goBuildTempRE matches Go's temp-build directory segment:
// `os.MkdirTemp(..., "go-build")` produces `go-build` + decimal digits.
// Anchoring on the bare prefix would catch install paths like
// `/opt/go-builds/...`; requiring the digit suffix scopes us to the
// real toolchain layout.
var goBuildTempRE = regexp.MustCompile(`(^|/)go-build[0-9]+(/|$)`)

func resolveExecRoot(exe, cwd string) string {
	dir := filepath.Dir(exe)
	if goBuildTempRE.MatchString(filepath.ToSlash(dir)) {
		return cwd
	}
	return dir
}
