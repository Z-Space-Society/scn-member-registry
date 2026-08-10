/**
 * DID syntax validation.
 *
 * Per the atproto spec: lowercase method, and an identifier of letters,
 * digits, period, dash, underscore, colon, or percent. Notably no slash and
 * no whitespace.
 */
const DID_RE = /^did:[a-z]+:[A-Za-z0-9._:%-]+$/;

/** The spec caps DIDs at 2KB; this is generous for real methods. */
const MAX_DID_LENGTH = 512;

export function isDid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_DID_LENGTH &&
    DID_RE.test(value)
  );
}

export function assertDid(value: unknown): string {
  if (!isDid(value)) throw new Error(`not a DID: ${String(value)}`);
  return value;
}
