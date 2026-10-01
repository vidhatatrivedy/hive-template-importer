import { allowlist } from "./allowlist";

/**
 * DOMPurify wraps a string fragment in `<body>` before it walks the tree. That
 * wrapper is not Comment content. Leaving it off ALLOWED_TAGS makes every call
 * record the body as removed, so the render check can never come back empty.
 */
const DOCUMENT_WRAPPER_TAGS = ["body"];

/** Written onto the live DOM when a Comment is shown. Never stored. */
const DISPLAY_ATTRIBUTES: Record<string, Record<string, string>> = {
  a: { rel: "noopener noreferrer" },
  img: { loading: "lazy" },
  iframe: { sandbox: "", loading: "lazy" },
};

function allowedAttributes(): string[] {
  const names = new Set<string>(Object.values(allowlist.attributes).flat());
  for (const attributes of Object.values(DISPLAY_ATTRIBUTES)) {
    for (const name of Object.keys(attributes)) names.add(name);
  }
  return [...names];
}

/**
 * Allowlisted schemes, plus a relative or fragment URL. The relative clauses
 * are DOMPurify's own, so a URL the sanitiser kept is not reported as removed.
 */
function allowedUriRegexp(): RegExp {
  const schemes = allowlist.urlSchemes.map((scheme) => scheme.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return new RegExp(`^(?:(?:${schemes}):|[^a-z]|[a-z+.\\-]+(?:[^a-z+.\\-:]|$))`, "i");
}

/** Passed to `DOMPurify.sanitize`. Built from the allowlist, so the two layers can't drift. */
export const commentHtmlPurifyConfig = {
  ALLOWED_TAGS: [...allowlist.tags, ...DOCUMENT_WRAPPER_TAGS],
  ALLOWED_ATTR: allowedAttributes(),
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
  ALLOWED_URI_REGEXP: allowedUriRegexp(),
};

/**
 * DOMPurify `afterSanitizeAttributes` hook. Sets the display-only attributes.
 * Runs after validation, which is what lets it add `sandbox` and `loading`
 * without DOMPurify then stripping them.
 */
export function applyCommentHtmlDisplayAttributes(node: Element): void {
  const extras = DISPLAY_ATTRIBUTES[node.tagName.toLowerCase()];
  if (!extras) return;
  for (const [name, value] of Object.entries(extras)) node.setAttribute(name, value);
}
