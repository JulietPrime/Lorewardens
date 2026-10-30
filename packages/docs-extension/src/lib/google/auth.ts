export const DOCUMENTS_READONLY_SCOPE = "https://www.googleapis.com/auth/documents.readonly";
export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const AUTH_SCOPES = `${DOCUMENTS_READONLY_SCOPE} ${DRIVE_FILE_SCOPE}`;

export const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";

export interface OAuthClientConfig {
  clientId: string;
  redirectUri: string;
}

// OAuth in Testing mode only: a web-application client id entered on the
// options page, implicit token flow through chrome.identity.launchWebAuthFlow
// with the https://<extension-id>.chromiumapp.org/ redirect. No Marketplace
// listing, no verification flow anywhere in this codebase.
export function chromiumAppRedirectUri(extensionId: string): string {
  return `https://${extensionId}.chromiumapp.org/`;
}

export function buildAuthUrl(config: OAuthClientConfig, options: { interactive: boolean }): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: "token",
    redirect_uri: config.redirectUri,
    scope: AUTH_SCOPES,
    ...(options.interactive ? {} : { prompt: "none" }),
  });
  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
}

export interface ParsedTokenRedirect {
  accessToken: string;
  expiresIn: number;
}

export function accessTokenFromRedirect(redirectUrl: string): ParsedTokenRedirect | null {
  let fragment: string;
  try {
    fragment = new URL(redirectUrl).hash.replace(/^#/, "");
  } catch {
    return null;
  }
  const params = new URLSearchParams(fragment);
  if (params.get("error") !== null) return null;
  const accessToken = params.get("access_token");
  if (accessToken === null || accessToken === "") return null;
  const expiresIn = Number(params.get("expires_in") ?? "0");
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) return null;
  return { accessToken, expiresIn };
}

export interface AccessToken {
  token: string;
  expiresAt: number;
}

export type LaunchFlow = (authUrl: string, interactive: boolean) => Promise<string | null>;

export function isTokenUsable(token: AccessToken | undefined, now: number, skewSeconds = 60): boolean {
  return token !== undefined && token.expiresAt - skewSeconds * 1000 > now;
}

// Silent-first: prompt=none against the cached account; falls back to the
// interactive chooser only when the silent flow yields no token. A user not
// on the consent screen's test list fails both attempts (Testing-mode access
// control) and the error surfaces verbatim.
export async function acquireAccessToken(
  config: OAuthClientConfig,
  flow: LaunchFlow,
  now: () => number = Date.now,
): Promise<AccessToken> {
  const silentRedirect = await flow(buildAuthUrl(config, { interactive: false }), false);
  const silent = silentRedirect === null ? null : accessTokenFromRedirect(silentRedirect);
  if (silent !== null) {
    return { token: silent.accessToken, expiresAt: now() + silent.expiresIn * 1000 };
  }
  const interactiveRedirect = await flow(buildAuthUrl(config, { interactive: true }), true);
  const interactive = interactiveRedirect === null ? null : accessTokenFromRedirect(interactiveRedirect);
  if (interactive === null) {
    throw new Error(
      "Google sign-in did not return an access token. Check the OAuth client id in the options page and " +
        "that this account is added as a test user on the consent screen (Testing mode).",
    );
  }
  return { token: interactive.accessToken, expiresAt: now() + interactive.expiresIn * 1000 };
}

export function launchWebAuthFlow(url: string, interactive: boolean): Promise<string | null> {
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url, interactive }, (responseUrl) => {
      const error = chrome.runtime.lastError;
      if (error !== undefined) {
        reject(new Error(error.message ?? "launchWebAuthFlow failed"));
        return;
      }
      resolve(responseUrl ?? null);
    });
  });
}
