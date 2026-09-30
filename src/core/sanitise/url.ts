import { allowlist } from "./allowlist";
import { asciiLower } from "./text";

/**
 * The scheme of a decoded URL attribute value as the browser's URL parser reads it: leading
 * and trailing C0 controls and spaces stripped, tabs and newlines removed anywhere.
 * `null` for a relative or fragment URL, which resolves against the page's own scheme.
 */
function urlScheme(value: string): string | null {
  const cleaned = value.replace(/^[\u0000- ]+|[\u0000- ]+$/g, "").replace(/[\t\n\r]/g, "");
  const match = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(cleaned);
  return match ? asciiLower(match[1]) : null;
}

/** Whether a link or image may point here: an allowlisted scheme, or a relative URL. */
export function isAllowedUrl(value: string): boolean {
  const scheme = urlScheme(value);
  return scheme === null || allowlist.urlSchemes.includes(scheme);
}

export function isYoutubeEmbed(src: string): boolean {
  return allowlist.iframeSrcPrefixes.some((prefix) => src.startsWith(prefix));
}

/**
 * What a disallowed iframe becomes: a link to its `src`, or its `src` as plain text when that
 * isn't an allowed link target, so the next pass has nothing left to cut.
 */
export function iframeReplacement(src: string | undefined): string {
  if (!src) return "";
  const escaped = escapeHtml(src);
  return isAllowedUrl(src) ? `<a href="${escaped}">${escaped}</a>` : escaped;
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => ESCAPES[character]);
}
