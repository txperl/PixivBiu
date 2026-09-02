package runtimepath

import (
	"path/filepath"
	"testing"
)

func TestResolveRoot_GoBuildTempFallsBackToCWD(t *testing.T) {
	root := t.TempDir()
	cwd := filepath.Join(root, "cwd")
	installedDir := filepath.Join(root, "usr", "local", "bin")
	repoBinDir := filepath.Join(root, "home", "me", "proj", "bin")
	goBuildsDir := filepath.Join(root, "opt", "go-builds", "pixivbiu", "bin")
	cacheBinDir := filepath.Join(root, "home", "me", ".cache", "go-build", "binaries")
	cases := []struct {
		name string
		exe  string
		cwd  string
		want string
	}{
		{
			name: "go-run temp dir falls back to cwd",
			exe:  filepath.Join(root, "tmp", "go-build123456789", "b001", "exe", "server"),
			cwd:  cwd,
			want: cwd,
		},
		{
			name: "installed binary keeps exec dir",
			exe:  filepath.Join(installedDir, "pixivbiu"),
			cwd:  cwd,
			want: installedDir,
		},
		{
			name: "repo-built binary keeps exec dir",
			exe:  filepath.Join(repoBinDir, "pixivbiu"),
			cwd:  cwd,
			want: repoBinDir,
		},
		{
			name: "go-build-prefixed install path keeps exec dir",
			exe:  filepath.Join(goBuildsDir, "pixivbiu"),
			cwd:  cwd,
			want: goBuildsDir,
		},
		{
			name: "bare go-build path component keeps exec dir",
			exe:  filepath.Join(cacheBinDir, "pixivbiu"),
			cwd:  cwd,
			want: cacheBinDir,
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
	root := t.TempDir()
	absFlag := filepath.Join(root, "var", "lib", "pixivbiu")
	absEnv := filepath.Join(root, "opt", "pixivbiu-data")
	flagPrecedence := filepath.Join(root, "opt", "from-flag")
	envPrecedence := filepath.Join(root, "opt", "from-env")
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
		{"absolute override returned unchanged", absFlag, "", absFlag},
		{"env used when flag arg empty", "", absEnv, absEnv},
		{"flag arg takes precedence over env", flagPrecedence, envPrecedence, flagPrecedence},
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

func TestCacheRoot(t *testing.T) {
	root := t.TempDir()
	dataRoot := filepath.Join(root, "opt", "app")
	absFlag := filepath.Join(root, "var", "cache", "pixivbiu")
	absEnv := filepath.Join(root, "opt", "pixiv-cache")
	flagPrecedence := filepath.Join(root, "opt", "from-flag")
	envPrecedence := filepath.Join(root, "opt", "from-env")
	// A relative override resolves against the test's CWD.
	relAbs, err := filepath.Abs(filepath.FromSlash("scratch/cache"))
	if err != nil {
		t.Fatalf("filepath.Abs: %v", err)
	}
	cases := []struct {
		name string
		flag string // -cache-dir flag value (CacheRoot's first argument)
		env  string // PIXIVBIU_CACHE_DIR ("" = unset)
		want string
	}{
		{"no override falls back to usr/cache under data root", "", "", filepath.Join(dataRoot, "usr/cache")},
		{"relative override is absolutized", filepath.FromSlash("scratch/cache"), "", relAbs},
		{"absolute override returned unchanged", absFlag, "", absFlag},
		{"env used when flag arg empty", "", absEnv, absEnv},
		{"flag arg takes precedence over env", flagPrecedence, envPrecedence, flagPrecedence},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Setenv("PIXIVBIU_CACHE_DIR", c.env)
			if got := CacheRoot(c.flag, dataRoot); got != c.want {
				t.Errorf("CacheRoot(%q, %q) with PIXIVBIU_CACHE_DIR=%q = %q, want %q", c.flag, dataRoot, c.env, got, c.want)
			}
		})
	}
}

func TestAnchor(t *testing.T) {
	root := t.TempDir()

	t.Run("absolute path untouched", func(t *testing.T) {
		abs := filepath.Join(t.TempDir(), "etc", "pixivbiu", "settings.json")
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
