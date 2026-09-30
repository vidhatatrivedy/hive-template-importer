import { defaultTreeAdapter, html as htmlSpec, parseFragment, type DefaultTreeAdapterTypes } from "parse5";
import { allowlist, tagsRemovedWithContent } from "./allowlist";
import { endOfTagName, tagTokenEnd } from "./source-tags";
import { asciiLower } from "./text";

export type Node = DefaultTreeAdapterTypes.Node;
export type Element = DefaultTreeAdapterTypes.Element;

/**
 * Parses Comment HTML as the browser does when it sets a body's innerHTML, which is how it's shown.
 * A lone surrogate is read as U+FFFD, as the browser shows it: parse5 throws on two lone low
 * surrogates in a row. One UTF-16 unit replaces one, so source offsets still point into `html`.
 */
export function parseCommentFragment(html: string): DefaultTreeAdapterTypes.DocumentFragment {
  const body = defaultTreeAdapter.createElement("body", htmlSpec.NS.HTML, []);
  return parseFragment(body, html.toWellFormed(), { sourceCodeLocationInfo: true });
}

/**
 * Chromium's HTML parser stops nesting elements at this depth, so markup nested deeper isn't
 * shown the way parse5 reads it. It's also where the recursive tree walks stop being safe.
 */
export const MAX_NESTING_DEPTH = 512;

/** How deeply elements nest under `root`, found without recursion so any depth can be measured. */
export function nestingDepth(root: Node): number {
  let deepest = 0;
  const pending: [Node, number][] = [[root, 0]];
  for (let next = pending.pop(); next; next = pending.pop()) {
    const [node, parentDepth] = next;
    const depth = "tagName" in node ? parentDepth + 1 : parentDepth;
    deepest = Math.max(deepest, depth);
    eachChild(node, (child) => pending.push([child, depth]));
  }
  return deepest;
}

/** Child nodes, and a `<template>` element's content fragment. */
export function eachChild(node: Node, visit: (child: Node) => void) {
  if ("childNodes" in node) for (const child of node.childNodes) visit(child);
  if ("content" in node) visit(node.content);
}

export function isAllowedElement(element: Element): boolean {
  return element.namespaceURI === htmlSpec.NS.HTML && allowlist.tags.includes(element.tagName);
}

/** Matched by name in any namespace: an SVG `<script>` or `<style>` is just as unwanted. */
export function isRemovedWithContent(element: Element): boolean {
  return tagsRemovedWithContent.includes(element.tagName);
}

/**
 * Where an element's source ends. An element left open at the end of the input can report an
 * `endOffset` before its last descendant's start tag, so the descendants are consulted too.
 */
export function sourceEnd(node: Node): number {
  const location = "sourceCodeLocation" in node ? node.sourceCodeLocation : undefined;
  let end = location?.endOffset ?? 0;
  if ("tagName" in node) end = Math.max(end, node.sourceCodeLocation?.startTag?.endOffset ?? 0);
  eachChild(node, (child) => {
    end = Math.max(end, sourceEnd(child));
  });
  return end;
}

/** The decoded value of an element's first attribute of that name, as the browser sees it. */
export function attributeValueOf(element: Element, name: string): string | undefined {
  return element.attrs.find((attribute) => attribute.name === name)?.value;
}

/**
 * A `div.youtube-embed-wrapper` holding only whitespace: Spectora exported the wrapper but not
 * its video. Its `class` and `style` go, so the box it would have drawn collapses to nothing.
 */
export function isEmptyYoutubeWrapper(element: Element): boolean {
  if (element.tagName !== "div") return false;
  const classes = (attributeValueOf(element, "class") ?? "").split(/[\t\n\f\r ]+/);
  if (!classes.includes("youtube-embed-wrapper")) return false;
  return element.childNodes.every(isBlankText);
}

/** A text node of only whitespace. U+00A0 is included: Spectora leaves it inside empty wrappers. */
function isBlankText(node: Node): boolean {
  return "value" in node && /^[\s\u00a0]*$/.test(node.value);
}

/** A tag-like token in the source that no node's location accounts for. */
export type StrayTagToken = { start: number; end: number; tag: string; isEndTag: boolean };

/**
 * Tag tokens the parser dropped without making an element: a stray `</font>`, `<body onload=…>`,
 * `<tr onclick=…>` outside a table, a tag cut short by the end of the input. They don't render
 * here, but they would come alive if the HTML were ever placed in another context.
 * Found as the tag-like tokens in the source that no node's location accounts for. Any such
 * start tag was ignored. Such an end tag may still have closed an element the parser rebuilt
 * (reconstructed formatting), or made one (`</p>`, `</br>`).
 */
export function strayTagTokens(input: string, fragment: Node): StrayTagToken[] {
  const covered = new Uint8Array(input.length);
  coverLocatedSource(fragment, covered);
  const tokens: StrayTagToken[] = [];
  let start = input.indexOf("<");
  while (start >= 0) {
    const isEndTag = input[start + 1] === "/";
    const nameStart = start + (isEndTag ? 2 : 1);
    if (covered[start] || !/[A-Za-z]/.test(input[nameStart] ?? "")) {
      start = input.indexOf("<", start + 1);
      continue;
    }
    const tag = asciiLower(input.slice(nameStart, endOfTagName(input, nameStart, input.length)));
    const end = tagTokenEnd(input, start);
    tokens.push({ start, end, tag, isEndTag });
    start = input.indexOf("<", end);
  }
  return tokens;
}

/** A stray end tag of an allowed element is kept: the parser can still act on it. */
export function isHarmlessStrayTag(token: StrayTagToken): boolean {
  return token.isEndTag && allowlist.tags.includes(token.tag);
}

/**
 * Elements whose content the tokenizer reads as text, so a `<` inside isn't a tag.
 * `iframe` is allowlisted and kept. Every other name is also in `tagsRemovedWithContent`,
 * because unwrapping it would turn that text back into markup.
 */
const RAW_TEXT_TAGS = ["script", "style", "xmp", "iframe", "noembed", "noframes", "noscript", "textarea", "title", "plaintext"];

/** Only in HTML: an `<iframe>` inside `<svg>` is an SVG element whose content is markup. */
function isRawText(element: Element): boolean {
  return element.namespaceURI === htmlSpec.NS.HTML && RAW_TEXT_TAGS.includes(element.tagName);
}

function coverLocatedSource(node: Node, covered: Uint8Array) {
  const location = "sourceCodeLocation" in node ? node.sourceCodeLocation : undefined;
  if ("tagName" in node) {
    const { startTag, endTag } = node.sourceCodeLocation ?? {};
    // The whole span, so a `<` inside raw text or a removed element is not cut again.
    // `fill` clamps the end to the input length.
    if (startTag && (isRemovedWithContent(node) || isRawText(node))) {
      covered.fill(1, startTag.startOffset, sourceEnd(node));
    }
    if (startTag) covered.fill(1, startTag.startOffset, startTag.endOffset);
    if (endTag) covered.fill(1, endTag.startOffset, endTag.endOffset);
  } else if (node.nodeName === "#comment" && location) {
    covered.fill(1, location.startOffset, location.endOffset);
  }
  eachChild(node, (child) => coverLocatedSource(child, covered));
}
