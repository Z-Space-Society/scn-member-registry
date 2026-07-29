export interface Config {
  happyviewUrl: string;
  clientKey: string;
  redirectUri: string;
  oauthScope: string;
  /** OAuth client ID. Loopback-constructed for dev unless explicitly set. */
  clientId: string;
}

const REQUIRED = [
  "VITE_HAPPYVIEW_URL",
  "VITE_HV_CLIENT_KEY",
  "VITE_OAUTH_REDIRECT_URI",
  "VITE_OAUTH_SCOPE",
] as const;

/**
 * Builds the app config from an env object (import.meta.env in the browser).
 * Throws on any missing variable: a misconfigured client must not limp along.
 */
export function loadConfig(env: Record<string, string | undefined>): Config {
  for (const key of REQUIRED) {
    if (!env[key]) throw new Error(`missing required env var: ${key}`);
  }

  const redirectUri = env.VITE_OAUTH_REDIRECT_URI!;
  const oauthScope = env.VITE_OAUTH_SCOPE!;
  const clientId =
    env.VITE_OAUTH_CLIENT_ID ??
    `http://localhost?redirect_uri=${encodeURIComponent(
      redirectUri
    )}&scope=${encodeURIComponent(oauthScope)}`;

  return {
    happyviewUrl: env.VITE_HAPPYVIEW_URL!,
    clientKey: env.VITE_HV_CLIENT_KEY!,
    redirectUri,
    oauthScope,
    clientId,
  };
}
