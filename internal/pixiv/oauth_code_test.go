package pixiv

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/txperl/pixivgo"
)

// stubPixivToken installs a fake Pixiv token endpoint for the duration of t.
// The handler receives the parsed form values; whatever (status, body) it
// returns is what ExchangeAuthCode sees.
func stubPixivToken(t *testing.T, handler func(form map[string]string) (status int, body string)) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		form := make(map[string]string, len(r.Form))
		for k := range r.Form {
			form[k] = r.Form.Get(k)
		}
		status, body := handler(form)
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)

	prev := pixivTokenURL
	pixivTokenURL = srv.URL
	t.Cleanup(func() { pixivTokenURL = prev })
}

func TestExchangeAuthCode_Success(t *testing.T) {
	var captured map[string]string
	stubPixivToken(t, func(form map[string]string) (int, string) {
		captured = form
		return http.StatusOK, `{"refresh_token":"rt-xyz","access_token":"at-abc","expires_in":3600}`
	})

	rt, err := ExchangeAuthCode(context.Background(), nil, "code-1", "verifier-1")
	if err != nil {
		t.Fatalf("ExchangeAuthCode: %v", err)
	}
	if rt != "rt-xyz" {
		t.Errorf("refresh_token: want rt-xyz, got %q", rt)
	}
	if captured["grant_type"] != "authorization_code" {
		t.Errorf("grant_type: want authorization_code, got %q", captured["grant_type"])
	}
	if captured["code"] != "code-1" {
		t.Errorf("code: want code-1, got %q", captured["code"])
	}
	if captured["code_verifier"] != "verifier-1" {
		t.Errorf("code_verifier: want verifier-1, got %q", captured["code_verifier"])
	}
	if captured["redirect_uri"] != pixivOAuthRedirectURI {
		t.Errorf("redirect_uri: want %q, got %q", pixivOAuthRedirectURI, captured["redirect_uri"])
	}
	if captured["client_id"] == "" || captured["client_secret"] == "" {
		t.Errorf("client credentials missing in form: %v", captured)
	}
}

func TestExchangeAuthCode_Pixiv400IsPixivError(t *testing.T) {
	stubPixivToken(t, func(map[string]string) (int, string) {
		return http.StatusBadRequest, `{"error":"invalid_grant"}`
	})

	_, err := ExchangeAuthCode(context.Background(), nil, "bad", "v")
	if err == nil {
		t.Fatalf("want error, got nil")
	}
	var pe *pixivgo.PixivError
	if !errors.As(err, &pe) {
		t.Fatalf("want *pixivgo.PixivError, got %T (%v)", err, err)
	}
	if pe.StatusCode != http.StatusBadRequest {
		t.Errorf("status: want 400, got %d", pe.StatusCode)
	}
	if !strings.Contains(pe.Body, "invalid_grant") {
		t.Errorf("body missing upstream detail: %q", pe.Body)
	}
}

func TestExchangeAuthCode_MissingRefreshTokenIsError(t *testing.T) {
	stubPixivToken(t, func(map[string]string) (int, string) {
		return http.StatusOK, `{"access_token":"at-only"}`
	})

	_, err := ExchangeAuthCode(context.Background(), nil, "c", "v")
	if err == nil {
		t.Fatalf("want error when refresh_token absent, got nil")
	}
}

// TestExchangeAuthCode_RespectsContextDeadline is the regression guard for the
// hang behind the "garbage code reports success" bug: when Pixiv never answers,
// the exchange must honour the caller's deadline and fail fast with a context
// error, not block until some outer (server WriteTimeout) deadline tears the
// connection down. The stub never responds until the test tears down.
func TestExchangeAuthCode_RespectsContextDeadline(t *testing.T) {
	block := make(chan struct{})
	stubPixivToken(t, func(map[string]string) (int, string) {
		<-block
		return http.StatusOK, `{"refresh_token":"rt"}`
	})
	// Registered after stubPixivToken so it runs *before* srv.Close (cleanups
	// are LIFO), unblocking the handler so Close doesn't deadlock on it.
	t.Cleanup(func() { close(block) })

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	start := time.Now()
	_, err := ExchangeAuthCode(ctx, nil, "c", "v")
	elapsed := time.Since(start)

	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("want context.DeadlineExceeded, got %T (%v)", err, err)
	}
	if elapsed > time.Second {
		t.Errorf("exchange did not fail fast on the deadline: took %s", elapsed)
	}
}

func TestBuildLoginURL_IncludesPKCEParams(t *testing.T) {
	u := BuildLoginURL("CHAL-1")
	if !strings.HasPrefix(u, pixivLoginPageURL+"?") {
		t.Errorf("login URL: want prefix %q, got %q", pixivLoginPageURL+"?", u)
	}
	for _, want := range []string{
		"code_challenge=CHAL-1",
		"code_challenge_method=S256",
		"client=pixiv-android",
	} {
		if !strings.Contains(u, want) {
			t.Errorf("login URL missing %q: %q", want, u)
		}
	}
}
