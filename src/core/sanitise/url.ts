import { allowlist } from "./allowlist";
import { asciiLower } from "./text";

/**
 * The scheme of a decoded URL attribute value as the browser's URL parser reads it.
 * `null` for a relative or fragment URL, which resolves against the page's own scheme.
 */
function urlScheme(value: string): string | null {
  const match = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(stripUrlParserWhitespace(value));
  return match ? asciiLower(match[1]) : null;
}

/** Leading and trailing C0 controls and spaces, plus tabs and newlines anywhere. */
function stripUrlParserWhitespace(value: string): string {
  const trimmed = value.replace(/^[\u0000- ]+|[\u0000- ]+$/g, "");
  return trimmed.replace(/[\t\n\r]/g, "");
}

/** Attributes holding a URL a link or image points to, checked against the scheme allowlist. */
const URL_ATTRIBUTES: Record<string, string> = { a: "href", img: "src" };

export function isUrlAttribute(tag: string, attribute: string): boolean {
  return URL_ATTRIBUTES[tag] === attribute;
}

/** Whether a link or image may point here: an allowlisted scheme, or a relative URL. */
export function isAllowedUrl(value: string): boolean {
  const scheme = urlScheme(value);
  return scheme === null || allowlist.urlSchemes.includes(scheme);
}

/** True when `src` starts with an allowlisted YouTube embed prefix, exactly as written. */
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
  if (!isAllowedUrl(src)) return escaped;
  return `<a href="${escaped}">${escaped}</a>`;
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

/** Escapes text or a double-quoted attribute value. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => ESCAPES[character]);
}
