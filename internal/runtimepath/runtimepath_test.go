package runtimepath

import (
	"path/filepath"
	"testing"
)

func TestResolveRoot_GoBuildTempFallsBackToCWD(t *testing.T) {
	cases := []struct {
		name string
		exe  string
		cwd  string
		want string
	}{
		{
			name: "go-run temp dir falls back to cwd",
			exe:  "/var/folders/xx/T/go-build123456789/b001/exe/server",
			cwd:  "/home/me/proj",
			want: "/home/me/proj",
		},
		{
			name: "installed binary keeps exec dir",
			exe:  "/usr/local/bin/pixivbiu",
			cwd:  "/elsewhere",
			want: "/usr/local/bin",
		},
		{
			name: "repo-built binary keeps exec dir",
			exe:  "/home/me/proj/bin/pixivbiu",
			cwd:  "/anywhere",
			want: "/home/me/proj/bin",
		},
		{
			name: "go-build-prefixed install path keeps exec dir",
			exe:  "/opt/go-builds/pixivbiu/bin/pixivbiu",
			cwd:  "/anywhere",
			want: "/opt/go-builds/pixivbiu/bin",
		},
		{
			name: "bare go-build path component keeps exec dir",
			exe:  "/home/me/.cache/go-build/binaries/pixivbiu",
			cwd:  "/anywhere",
			want: "/home/me/.cache/go-build/binaries",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := resolveRoot(c.exe, c.cwd)
			if got != c.want {
				t.Errorf("resolveRoot(%q, %q) = %q, want %q", c.exe, c.cwd, got, c.want)
			}
		})
	}
}

func TestDataRoot(t *testing.T) {
	// A relative override resolves against the test's CWD; capture the
	// expected absolute form here so the table stays declarative.
	relAbs, err := filepath.Abs(filepath.FromSlash("scratch/data"))
	if err != nil {
		t.Fatalf("filepath.Abs: %v", err)
	}
	cases := []struct {
		name string
		flag string // -data-dir flag value (DataRoot's argument)
		env  string // PIXIVBIU_DATA_DIR ("" = unset)
		want string
	}{
		{"no override falls back to Root", "", "", Root()},
		{"relative override is absolutized", filepath.FromSlash("scratch/data"), "", relAbs},
		{"absolute override returned unchanged", filepath.FromSlash("/var/lib/pixivbiu"), "", filepath.FromSlash("/var/lib/pixivbiu")},
		{"env used when flag arg empty", "", filepath.FromSlash("/opt/pixivbiu-data"), filepath.FromSlash("/opt/pixivbiu-data")},
		{"flag arg takes precedence over env", filepath.FromSlash("/opt/from-flag"), filepath.FromSlash("/opt/from-env"), filepath.FromSlash("/opt/from-flag")},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Setenv("PIXIVBIU_DATA_DIR", c.env)
			if got := DataRoot(c.flag); got != c.want {
				t.Errorf("DataRoot(%q) with PIXIVBIU_DATA_DIR=%q = %q, want %q", c.flag, c.env, got, c.want)
			}
		})
	}
}

func TestAnchor(t *testing.T) {
	root := filepath.FromSlash("/opt/app/bin")

	t.Run("absolute path untouched", func(t *testing.T) {
		abs := filepath.FromSlash("/etc/pixivbiu/settings.json")
		if got := Anchor(root, abs); got != abs {
			t.Errorf("Anchor(root, abs) = %q, want unchanged %q", got, abs)
		}
	})

	t.Run("empty path untouched", func(t *testing.T) {
		if got := Anchor(root, ""); got != "" {
			t.Errorf(`Anchor(root, "") = %q, want ""`, got)
		}
	})

	t.Run("relative path joined onto root", func(t *testing.T) {
		rel := filepath.FromSlash("usr/settings.json")
		want := filepath.Join(root, rel)
		if got := Anchor(root, rel); got != want {
			t.Errorf("Anchor(root, rel) = %q, want %q", got, want)
		}
	})
}
