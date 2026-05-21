package pixiv

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/txperl/pixivgo"
)

// Pixiv mobile-app OAuth credentials. Same values pixivgo bakes in for the
// refresh_token grant (see github.com/txperl/pixivgo/client.go) — duplicated
// here only because pixivgo doesn't expose them and we need them for the
// authorization_code grant pixivgo doesn't implement.
const (
	pixivOAuthClientID     = "MOBrBDS8blbauoSck0ZfDbtuzpyT"
	pixivOAuthClientSecret = "lsACyCD94FhDUtGTXi3QzcFE2uU1hqtDaKeqrdwj"
	// pixivOAuthRedirectURI is the only redirect Pixiv's OAuth backend will
	// accept; the hosted callback page just shows blank/error, but the URL
	// carries `?code=…`.
	pixivOAuthRedirectURI = "https://app-api.pixiv.net/web/v1/users/auth/pixiv/callback"
)

// pixivTokenURL is var (not const) so tests can swap it for an httptest server.
var pixivTokenURL = "https://oauth.secure.pixiv.net/auth/token"

// pixivLoginPageURL is the hosted login page that accepts the PKCE challenge
// and runs Pixiv's first-party login (captcha, 2FA, etc.). Exported via
// BuildLoginURL so the handler can construct it.
const pixivLoginPageURL = "https://app-api.pixiv.net/web/v1/login"

// BuildLoginURL composes the hosted Pixiv login URL for a given PKCE
// challenge. The client opens this URL in a popup; Pixiv redirects to
// pixivOAuthRedirectURI with `?code=…` once the user authenticates.
func BuildLoginURL(challenge string) string {
	q := url.Values{
		"code_challenge":        {challenge},
		"code_challenge_method": {"S256"},
		"client":                {"pixiv-android"},
	}
	return pixivLoginPageURL + "?" + q.Encode()
}

// authCodeResponse is the subset of Pixiv's /auth/token response we care about
// for the authorization_code grant. We only need refresh_token here — the
// remaining fields come back through pixivgo.Client.Auth when we re-enter the
// existing refresh_token path.
type authCodeResponse struct {
	RefreshToken string `json:"refresh_token"`
}

// ExchangeAuthCode trades an OAuth authorization code (+ the PKCE verifier
// that produced its challenge) for a Pixiv refresh_token. The caller should
// hand the resulting refresh_token to Service.Login so the existing access-
// token bookkeeping (state file, background refresh) kicks in unchanged.
func ExchangeAuthCode(ctx context.Context, hc *http.Client, code, verifier string) (string, error) {
	if hc == nil {
		hc = http.DefaultClient
	}

	form := url.Values{
		"client_id":      {pixivOAuthClientID},
		"client_secret":  {pixivOAuthClientSecret},
		"code":           {code},
		"code_verifier":  {verifier},
		"grant_type":     {"authorization_code"},
		"include_policy": {"true"},
		"redirect_uri":   {pixivOAuthRedirectURI},
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, pixivTokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("User-Agent", "PixivAndroidApp/5.0.234 (Android 11; Pixel 5)")

	resp, err := hc.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		// Pixiv returns 400 for bad/expired codes and invalid verifiers.
		// Surface it as a pixivgo.PixivError so handler classify() routes it
		// to the right HTTP status (400 → bad_request, etc.).
		return "", &pixivgo.PixivError{StatusCode: resp.StatusCode, Body: string(body)}
	}

	var parsed authCodeResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return "", fmt.Errorf("pixiv oauth: decode token response: %w", err)
	}
	if parsed.RefreshToken == "" {
		return "", fmt.Errorf("pixiv oauth: token response missing refresh_token")
	}
	return parsed.RefreshToken, nil
}
