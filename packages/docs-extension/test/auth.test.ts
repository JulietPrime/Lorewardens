import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AUTH_SCOPES,
  DOCUMENTS_READONLY_SCOPE,
  DRIVE_FILE_SCOPE,
  accessTokenFromRedirect,
  acquireAccessToken,
  buildAuthUrl,
  chromiumAppRedirectUri,
  isTokenUsable,
} from "../src/lib/google/auth.js";

const CONFIG = { clientId: "test-client-id.apps.googleusercontent.com", redirectUri: "https://abc.chromiumapp.org/" };

test("scopes are exactly documents.readonly and drive.file", () => {
  assert.equal(DOCUMENTS_READONLY_SCOPE, "https://www.googleapis.com/auth/documents.readonly");
  assert.equal(DRIVE_FILE_SCOPE, "https://www.googleapis.com/auth/drive.file");
  assert.equal(AUTH_SCOPES, `${DOCUMENTS_READONLY_SCOPE} ${DRIVE_FILE_SCOPE}`);
});

test("the redirect URI is the chromiumapp.org form of the extension id", () => {
  assert.equal(chromiumAppRedirectUri("abcdefghijklmnopabcdefghijklmnop"), "https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/");
});

test("auth URL: implicit token flow, exact scopes, silent uses prompt=none and interactive omits it", () => {
  const silent = new URL(buildAuthUrl(CONFIG, { interactive: false }));
  assert.equal(silent.origin + silent.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(silent.searchParams.get("response_type"), "token");
  assert.equal(silent.searchParams.get("client_id"), CONFIG.clientId);
  assert.equal(silent.searchParams.get("redirect_uri"), CONFIG.redirectUri);
  assert.equal(silent.searchParams.get("scope"), AUTH_SCOPES);
  assert.equal(silent.searchParams.get("prompt"), "none");

  const interactive = new URL(buildAuthUrl(CONFIG, { interactive: true }));
  assert.equal(interactive.searchParams.get("prompt"), null);
  assert.equal(interactive.searchParams.get("response_type"), "token");
});

test("redirect parsing extracts the access token and expiry from the fragment", () => {
  const parsed = accessTokenFromRedirect("https://abc.chromiumapp.org/#access_token=ya29.abc&expires_in=3599&token_type=Bearer");
  assert.deepEqual(parsed, { accessToken: "ya29.abc", expiresIn: 3599 });
  assert.equal(accessTokenFromRedirect("https://abc.chromiumapp.org/#error=access_denied"), null);
  assert.equal(accessTokenFromRedirect("https://abc.chromiumapp.org/#no_token_here"), null);
  assert.equal(accessTokenFromRedirect("https://abc.chromiumapp.org/#access_token=x&expires_in=0"), null);
  assert.equal(accessTokenFromRedirect("not a url"), null);
});

test("acquireAccessToken prefers the silent flow and falls back to interactive only on failure", async () => {
  const calls: { url: URL; interactive: boolean }[] = [];
  const flow = async (url: string, interactive: boolean) => {
    calls.push({ url: new URL(url), interactive });
    if (!interactive) return null;
    return "https://abc.chromiumapp.org/#access_token=interactive-token&expires_in=3600";
  };
  let now = 1_000_000;
  const token = await acquireAccessToken(CONFIG, flow, () => now);
  assert.equal(calls.length, 2, "silent first, then interactive");
  assert.equal(calls[0]!.interactive, false);
  assert.equal(calls[0]!.url.searchParams.get("prompt"), "none");
  assert.equal(calls[1]!.interactive, true);
  assert.equal(token.token, "interactive-token");
  assert.equal(token.expiresAt, 1_000_000 + 3600 * 1000);

  const silentOnly = await acquireAccessToken(
    CONFIG,
    async (url, interactive) => {
      assert.equal(interactive, false);
      return `https://abc.chromiumapp.org/#access_token=silent&expires_in=1200&prompt=${new URL(url).searchParams.get("prompt")}`;
    },
    () => 5_000,
  );
  assert.equal(silentOnly.token, "silent");
  assert.equal(silentOnly.expiresAt, 5_000 + 1200 * 1000);

  await assert.rejects(
    () => acquireAccessToken(CONFIG, async () => null, () => 0),
    /test user|access token/is,
    "both flows failing surfaces the Testing-mode guidance",
  );
});

test("token usability respects the expiry with a 60-second skew", () => {
  assert.equal(isTokenUsable({ token: "t", expiresAt: 100_000 }, 39_999), true);
  assert.equal(isTokenUsable({ token: "t", expiresAt: 100_000 }, 40_000), false, "inside the skew window");
  assert.equal(isTokenUsable(undefined, 0), false);
});
