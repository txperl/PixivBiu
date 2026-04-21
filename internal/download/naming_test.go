package download

import (
	"runtime"
	"strings"
	"testing"
	"text/template"
	"time"
)

func mustParse(t *testing.T, name, src string) *template.Template {
	t.Helper()
	tmpl, err := template.New(name).Funcs(funcMap()).Parse(src)
	if err != nil {
		t.Fatalf("parse %q: %v", name, err)
	}
	return tmpl
}

func mustRender(t *testing.T, tmpl *template.Template, ctx NameContext) string {
	t.Helper()
	r := &Renderer{FileName: tmpl}
	out, err := r.RenderRelativePath(tmpl, ctx)
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	return out
}

func mustRenderRoot(t *testing.T, tmpl *template.Template, ctx NameContext) string {
	t.Helper()
	r := &Renderer{OutputDir: tmpl}
	out, err := r.RenderRootPath(tmpl, ctx)
	if err != nil {
		t.Fatalf("render root: %v", err)
	}
	return out
}

func TestRenderPath_SanitizeWithoutExplicitFunc(t *testing.T) {
	// NameContext is normally pre-sanitised by the manager so slashes
	// in titles don't sneak in as separators. The post-render guard
	// is for other forbidden characters (colons, pipes, control bytes,
	// trailing dots) that slip through a template missing `| sanitize`.
	tmpl := mustParse(t, "file", `{{.Title}}{{.Ext}}`)
	out := mustRender(t, tmpl, NameContext{
		Title: `name:with*weird?chars<>|"`,
		Ext:   ".jpg",
	})
	if strings.ContainsAny(out, `\:*?"<>|`) {
		t.Errorf("forbidden character leaked: %q", out)
	}
}

func TestRenderPath_SlashInTemplateIsSeparator(t *testing.T) {
	// Literal `/` in the template is an explicit author choice for
	// subdirectories. It must not be escaped.
	tmpl := mustParse(t, "file", `{{.Title}}/{{.Ext}}.bin`)
	out := mustRender(t, tmpl, NameContext{Title: "folder", Ext: "a"})
	want := "folder" + string(filepathSep()) + "a.bin"
	if out != want {
		t.Errorf("want %q, got %q", want, out)
	}
}

func TestTrunc_CountsRunesNotBytes(t *testing.T) {
	// "曲奇" is 2 runes, 6 bytes in UTF-8. A byte-based trunc would
	// return "" for trunc 2; a rune-based trunc keeps "曲奇".
	tmpl := mustParse(t, "file", `{{.Title | trunc 2}}/{{.Title | trunc 120}}{{.Ext}}`)
	out := mustRender(t, tmpl, NameContext{
		Title: "曲奇可愛い",
		Ext:   ".jpg",
	})
	want := "曲奇" + string(filepathSep()) + "曲奇可愛い.jpg"
	if out != want {
		t.Errorf("want %q, got %q", want, out)
	}
}

func TestTrunc_ZeroReturnsEmpty(t *testing.T) {
	// Explicit trunc 0 is a "drop this segment" signal; leading
	// empty segments are skipped by RenderPath. Users should not
	// rely on this but the behaviour must be deterministic.
	tmpl := mustParse(t, "file", `{{.Title | trunc 0}}/real{{.Ext}}`)
	out := mustRender(t, tmpl, NameContext{Title: "whatever", Ext: ".bin"})
	if out != "real.bin" {
		t.Errorf("want %q, got %q", "real.bin", out)
	}
}

func TestSanitize_StripsSlashes(t *testing.T) {
	// The manager calls Sanitize on Title/UserName before building
	// NameContext. Verify that removes forward AND back slashes so a
	// pixiv title like "a/b" cannot sneak in a subdir.
	if got := Sanitize(`a/b\c`); got != "a_b_c" {
		t.Errorf("Sanitize: want %q, got %q", "a_b_c", got)
	}
}

func TestRenderPath_SubdirectoriesFromSlash(t *testing.T) {
	tmpl := mustParse(t, "group", `{{.Title}}/{{.Title}}_{{.Index | pad 2}}{{.Ext}}`)
	out := mustRender(t, tmpl, NameContext{
		Title: "Work",
		Index: 3,
		Ext:   ".jpg",
	})
	want := "Work" + string(filepathSep()) + "Work_03.jpg"
	if out != want {
		t.Errorf("want %q, got %q", want, out)
	}
}

func TestRenderPath_RejectTraversal(t *testing.T) {
	tmpl := mustParse(t, "evil", `../secret/{{.Title}}`)
	r := &Renderer{FileName: tmpl}
	_, err := r.RenderRelativePath(tmpl, NameContext{Title: "x"})
	if err == nil {
		t.Fatal("expected error for traversal segment, got nil")
	}
}

func TestRenderRelativePath_LeadingSlashNormalisedToRelative(t *testing.T) {
	// file_template / file_group_template are always relative to
	// output_dir; a user writing "/x/y" is misusing the template and
	// we normalise it to "x/y" rather than preserving the anchor.
	tmpl := mustParse(t, "file", `/leading/{{.Title}}{{.Ext}}`)
	out := mustRender(t, tmpl, NameContext{Title: "pic", Ext: ".jpg"})
	want := "leading" + string(filepathSep()) + "pic.jpg"
	if out != want {
		t.Errorf("leading-slash in file template should be relative: want %q, got %q", want, out)
	}
}

func TestRenderRootPath_PreservesPosixAbsolute(t *testing.T) {
	tmpl := mustParse(t, "root", `/mnt/pixiv/{{.Title}}`)
	out := mustRenderRoot(t, tmpl, NameContext{Title: "Work"})
	want := "/mnt/pixiv/Work"
	if out != want {
		t.Errorf("absolute root lost: want %q, got %q", want, out)
	}
}

func TestRenderRootPath_HomeAnchorSurvives(t *testing.T) {
	tmpl := mustParse(t, "root", `{{.Home}}/Downloads`)
	out := mustRenderRoot(t, tmpl, NameContext{Home: "/Users/someone"})
	want := "/Users/someone/Downloads"
	if out != want {
		t.Errorf(".Home anchor lost: want %q, got %q", want, out)
	}
}

func TestRenderRootPath_RelativeStaysRelative(t *testing.T) {
	tmpl := mustParse(t, "root", `./downloads/{{.Title}}`)
	out := mustRenderRoot(t, tmpl, NameContext{Title: "Work"})
	// "./" -> "." segment is skipped; result is a relative path.
	want := "downloads" + string(filepathSep()) + "Work"
	if out != want {
		t.Errorf("relative root mangled: want %q, got %q", want, out)
	}
}

func TestRenderRootPath_BareRootIsLegal(t *testing.T) {
	// output_dir: "/" is a degenerate but legal input (download directly
	// under filesystem root). It must not error like RenderRelativePath
	// does on empty cleaned-segment lists.
	tmpl := mustParse(t, "root", `/`)
	out := mustRenderRoot(t, tmpl, NameContext{})
	if out != "/" {
		t.Errorf("bare root: want %q, got %q", "/", out)
	}
}

func TestRenderRootPath_WindowsDriveLetter(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("windows drive letter parsing only meaningful on Windows")
	}
	tmpl := mustParse(t, "root", `C:\pixiv\{{.Title}}`)
	out := mustRenderRoot(t, tmpl, NameContext{Title: "Work"})
	want := `C:\pixiv\Work`
	if out != want {
		t.Errorf("drive-letter root lost: want %q, got %q", want, out)
	}
}

func TestRenderPath_TruncatesLongFilenamePreservingExt(t *testing.T) {
	long := strings.Repeat("あ", 400) // 3 bytes per rune under UTF-8
	tmpl := mustParse(t, "file", `{{.Title}}{{.Ext}}`)
	out := mustRender(t, tmpl, NameContext{Title: long, Ext: ".jpg"})
	if !strings.HasSuffix(out, ".jpg") {
		t.Errorf("extension lost in truncation: %q", out)
	}
	if len(out) > 255 {
		t.Errorf("filename exceeds 255 bytes: %d", len(out))
	}
}

func TestSanitize_ControlAndTrailingDots(t *testing.T) {
	got := Sanitize("hi\x01there..")
	if strings.ContainsAny(got, "\x00\x01\x02") {
		t.Errorf("control char leaked: %q", got)
	}
	if strings.HasSuffix(got, ".") {
		t.Errorf("trailing dot not trimmed: %q", got)
	}
}

func TestFuncMap_DateHandlesZero(t *testing.T) {
	tmpl := mustParse(t, "d", `{{.CreatedAt | date "2006-01-02"}}`)
	var buf strings.Builder
	if err := tmpl.Execute(&buf, NameContext{CreatedAt: time.Time{}}); err != nil {
		t.Fatalf("execute: %v", err)
	}
	if buf.String() != "" {
		t.Errorf("zero time should render empty, got %q", buf.String())
	}
}

// filepathSep returns the OS path separator as a string. Used in
// assertions that check joined subdirectories.
func filepathSep() rune {
	// filepath.Separator is a rune in the stdlib; wrap for use.
	return '/' // on POSIX; naming_test runs on the host platform
}
