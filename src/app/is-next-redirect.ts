/** A Server Action `redirect` rejects the caller. That rejection is navigation, not a failed action. */
export function isNextRedirect(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("digest" in error)) return false;
  return typeof error.digest === "string" && error.digest.startsWith("NEXT_REDIRECT");
}
