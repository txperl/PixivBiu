package main

import (
	"slices"
	"testing"

	"aead.dev/minisign"
)

// TestParseTrustedKeys guards the tokenizer that turns the link-time-stamped
// updateTrustedKeysRaw into the trusted-key set. Empty must yield an empty set
// (the fail-closed contract: no trusted key → no update ever offered), and the
// accepted separators (comma / whitespace / newline) must all split cleanly so a
// rotation-era multi-key stamp is parsed as expected.
func TestParseTrustedKeys(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want []string
	}{
		{"empty", "", nil},
		{"whitespace only", "  \n\t ", nil},
		{"commas only", " , ,, ", nil},
		{"single", "RWQ111", []string{"RWQ111"}},
		{"comma separated", "RWQ111,RWZ222", []string{"RWQ111", "RWZ222"}},
		{"comma with spaces", " RWQ111 , RWZ222 ", []string{"RWQ111", "RWZ222"}},
		{"newline separated", "RWQ111\nRWZ222", []string{"RWQ111", "RWZ222"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := parseTrustedKeys(c.raw); !slices.Equal(got, c.want) {
				t.Errorf("parseTrustedKeys(%q) = %#v, want %#v", c.raw, got, c.want)
			}
		})
	}
}

// TestUpdateTrustedKeysValid guards a stamped build: when updateTrustedKeysRaw is
// non-empty (a release, or a local `-X` build), every parsed key must be a valid
// minisign public key. A typo'd key is silently dropped at runtime
// (update.parsePublicKeys), which would leave the updater fail-closed — no update
// ever offered — with no obvious signal; catch it here. On a plain checkout the
// raw is empty (updates disabled by design), so this is a no-op — the "is a real
// key set actually stamped" check for releases lives in the release workflow.
func TestUpdateTrustedKeysValid(t *testing.T) {
	if updateTrustedKeysRaw == "" {
		t.Skip("no update key stamped (unstamped build); self-update disabled by design")
	}
	for _, k := range updateTrustedKeys {
		var pk minisign.PublicKey
		if err := pk.UnmarshalText([]byte(k)); err != nil {
			t.Errorf("updateTrustedKeys entry %q is not a valid minisign public key: %v", k, err)
		}
	}
}
