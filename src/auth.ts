import { HappyViewBrowserClient } from "@happyview/oauth-client-browser";
import type { HappyViewSession } from "@happyview/oauth-client-browser";
import type { Config } from "./config";

/**
 * The subset of HappyViewBrowserClient this module uses, extracted so tests
 * can substitute a fake at the boundary.
 */
export interface OauthClientLike {
  init(): Promise<{ session: HappyViewSession } | undefined>;
  signIn(handle: string, options?: { scope?: string }): Promise<unknown>;
  logout(did: string): Promise<void>;
}

export function createOauthClient(cfg: Config): HappyViewBrowserClient {
  return new HappyViewBrowserClient({
    instanceUrl: cfg.happyviewUrl,
    clientId: cfg.clientId,
    clientKey: cfg.clientKey,
  });
}

export interface InitResult {
  session: HappyViewSession | null;
  /**
   * Set when an OAuth callback failed. The SDK strips the callback params
   * from the URL before the token exchange, so an unhandled failure would
   * silently restore the previous stored session on the next load; surfacing
   * the error here is the only chance to tell the user their sign-in failed.
   */
  callbackError?: string;
}

/** Completes the OAuth callback or restores a stored session. */
export async function initSession(
  client: OauthClientLike
): Promise<InitResult> {
  try {
    const result = await client.init();
    return { session: result?.session ?? null };
  } catch (e) {
    if ((e as Error)?.name === "OAuthCallbackError") {
      console.warn("OAuth callback failed:", e);
      return { session: null, callbackError: (e as Error).message };
    }
    throw e;
  }
}
