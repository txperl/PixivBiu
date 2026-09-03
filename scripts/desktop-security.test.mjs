import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  APP_CONTENT_SECURITY_POLICY,
  CORE_BASE_URL,
  escapeHTML,
  extractPixivOAuthCode,
  failurePage,
  isAllowedExternalURL,
  isPixivOAuthCallbackURL,
  isPixivOAuthLoginURL,
  isTrustedCoreURL,
  isTrustedIPCEvent,
} = require("../desktop/dist/security.js");

test("core URLs require the exact privileged scheme and host", () => {
  assert.equal(isTrustedCoreURL(CORE_BASE_URL), true);
  assert.equal(isTrustedCoreURL("pixivbiu://core/api/v1/health?fresh=1#status"), true);

  for (const url of [
    "https://core/",
    "pixivbiu://core.example/",
    "pixivbiu://attacker@core/",
    "pixivbiu://core:444/",
    "pixivbiu:core",
    "not a url",
  ]) {
    assert.equal(isTrustedCoreURL(url), false, url);
  }
});

test("external navigation permits only credential-free HTTP URLs", () => {
  assert.equal(isAllowedExternalURL("https://github.com/txperl/PixivBiu"), true);
  assert.equal(isAllowedExternalURL("http://127.0.0.1:4001/docs"), true);

  for (const url of [
    "javascript:alert(1)",
    "data:text/html,hello",
    "file:///etc/passwd",
    "https://user:password@example.com/",
    "not a url",
  ]) {
    assert.equal(isAllowedExternalURL(url), false, url);
  }
});

test("Pixiv login URL rejects lookalike origins and path variants", () => {
  assert.equal(
    isPixivOAuthLoginURL(
      "https://app-api.pixiv.net/web/v1/login?code_challenge=abc&code_challenge_method=S256&client=pixiv-android",
    ),
    true,
  );

  for (const url of [
    "http://app-api.pixiv.net/web/v1/login",
    "https://app-api.pixiv.net.evil.example/web/v1/login",
    "https://evil.example@app-api.pixiv.net/web/v1/login",
    "https://app-api.pixiv.net:444/web/v1/login",
    "https://app-api.pixiv.net/web/v1/login/extra",
  ]) {
    assert.equal(isPixivOAuthLoginURL(url), false, url);
  }
});

test("OAuth code extraction accepts only the backend's exact redirect URL", () => {
  const callback = "https://app-api.pixiv.net/web/v1/users/auth/pixiv/callback?code=secret";
  assert.equal(isPixivOAuthCallbackURL(callback), true);
  assert.equal(extractPixivOAuthCode(callback), "secret");
  assert.equal(extractPixivOAuthCode(`${callback}&state=ok`), "secret");
  assert.equal(extractPixivOAuthCode(callback.replace("secret", "")), null);

  for (const url of [
    "https://app-api.pixiv.net/web/v1/users/auth/pixiv/callback/extra?code=secret",
    "https://app-api.pixiv.net.evil.example/web/v1/users/auth/pixiv/callback?code=secret",
    "https://evil.example@app-api.pixiv.net/web/v1/users/auth/pixiv/callback?code=secret",
    "https://oauth.secure.pixiv.net/auth/token?code=secret",
    "pixiv://callback?code=secret",
  ]) {
    assert.equal(extractPixivOAuthCode(url), null, url);
  }
});

test("IPC trust requires the current main webContents, main frame, and core URL", () => {
  const mainFrame = { url: CORE_BASE_URL };
  const webContents = { mainFrame };
  const window = { webContents };
  const valid = { sender: webContents, senderFrame: mainFrame };
  assert.equal(isTrustedIPCEvent(valid, window), true);

  assert.equal(isTrustedIPCEvent({ ...valid, sender: {} }, window), false);
  assert.equal(isTrustedIPCEvent({ ...valid, senderFrame: { url: CORE_BASE_URL } }, window), false);
  const foreignFrame = { url: "https://example.com" };
  const foreignContents = { mainFrame: foreignFrame };
  assert.equal(
    isTrustedIPCEvent(
      { sender: foreignContents, senderFrame: foreignFrame },
      { webContents: foreignContents },
    ),
    false,
  );
  assert.equal(isTrustedIPCEvent({ ...valid, senderFrame: null }, window), false);
  assert.equal(isTrustedIPCEvent(valid, null), false);
});

test("failure document escapes diagnostics and carries the application CSP", () => {
  assert.equal(escapeHTML(`<script>"x" & 'y'</script>`), "&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;");

  const raw = failurePage(`<script>alert("x")</script>`);
  assert.match(raw, /^data:text\/html;charset=utf-8,/);
  const html = decodeURIComponent(raw.slice(raw.indexOf(",") + 1));
  assert.match(html, /http-equiv="Content-Security-Policy"/);
  assert.ok(html.includes(APP_CONTENT_SECURITY_POLICY));
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
  for (const directive of ["default-src 'self'", "object-src 'none'", "connect-src 'self'"]) {
    assert.ok(APP_CONTENT_SECURITY_POLICY.includes(directive), directive);
  }
});
