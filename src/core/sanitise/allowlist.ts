/**
 * What Comment HTML may contain (Rich content policy, issue #10). Plain data, so the
 * render-time DOMPurify config can be derived from it and never drift.
 */
export const allowlist = {
  tags: [
    "p", "br", "strong", "b", "em", "i", "u", "s", "sub", "sup", "ul", "ol", "li",
    "h1", "h2", "h3", "h4", "h5", "h6", "span", "div", "blockquote", "hr", "pre", "code",
    "table", "thead", "tbody", "tr", "th", "td", "a", "img", "iframe",
  ],
  /** Attributes per tag; `*` applies to every allowed tag. */
  attributes: {
    "*": ["style"],
    a: ["href", "target", "rel"],
    ol: ["start"],
    img: ["src", "alt", "width", "height"],
    iframe: ["src", "width", "height", "allowfullscreen"],
  } as Record<string, string[]>,
  urlSchemes: ["http", "https", "mailto", "tel"],
  /** An iframe is kept only when its `src` starts with one of these. */
  iframeSrcPrefixes: [
    "https://www.youtube.com/embed/",
    "https://www.youtube-nocookie.com/embed/",
  ],
  styleProperties: [
    "width", "max-width", "height", "float", "clear",
    "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
    "display", "vertical-align", "text-align", "color", "background-color",
    "font-size", "font-weight", "font-style",
  ],
};

/**
 * Disallowed tags removed together with their content. Everything else off the allowlist is
 * unwrapped so its words stay. Raw-text elements are here because their content is text only
 * while it sits inside them: unwrapped, `<xmp><img onerror=…></xmp>` would become a live `<img>`.
 * `template` is here because its content is never displayed, and is parsed by rules (table rows
 * anywhere, for one) that no longer apply once it's unwrapped.
 */
export const tagsRemovedWithContent = [
  "script", "style", "object", "embed", "applet", "param", "template",
  "form", "input", "button", "select", "option", "optgroup", "textarea",
  "datalist", "fieldset", "legend", "label", "output",
  "xmp", "noscript", "noembed", "noframes", "plaintext", "title",
  "frame", "frameset", "link", "meta", "base",
];

const editorLeftovers = new Set(["class", "draggable", "contenteditable", "fr-original-style"]);

/** Attributes previous editors (Froala, pasted page builders) leave behind. */
export function isEditorLeftover(attribute: string): boolean {
  return editorLeftovers.has(attribute) || attribute.startsWith("data-");
}

export function isAllowedAttribute(tag: string, attribute: string): boolean {
  return allowlist.attributes["*"].includes(attribute) || (allowlist.attributes[tag] ?? []).includes(attribute);
}
