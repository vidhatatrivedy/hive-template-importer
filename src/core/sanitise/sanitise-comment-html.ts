import { defaultTreeAdapter, html as htmlSpec, parseFragment, type DefaultTreeAdapterTypes } from "parse5";
import { allowlist, isAllowedAttribute, isEditorLeftover } from "./allowlist";
import type { Cut } from "./cuts";
import { applyCuts } from "./cuts";

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;

/**
 * Sanitises one Comment's HTML by cutting spans out of the original string, never
 * re-serialising (ADR 0001). The input is the raw Comment Text cell: no trimming, no
 * entity decoding. Everything outside the returned cuts is left byte for byte.
 */
export function sanitiseCommentHtml(input: string): { html: string; cuts: Cut[] } {
  if (input === "") return { html: "", cuts: [] };
  // Parse as the browser does when it sets a body's innerHTML, which is how it's shown.
  const body = defaultTreeAdapter.createElement("body", htmlSpec.NS.HTML, []);
  const fragment = parseFragment(body, input, { sourceCodeLocationInfo: true });
  const cuts: Cut[] = [];
  walk(fragment, (element) => cuts.push(...attributeCuts(input, element)));
  cuts.sort((a, b) => a.start - b.start);
  return { html: applyCuts(input, cuts), cuts };
}

function walk(node: Node, visit: (element: Element) => void) {
  if ("tagName" in node) visit(node);
  if ("childNodes" in node) for (const child of node.childNodes) walk(child, visit);
  if ("content" in node) walk(node.content, visit);
}

function isAllowedElement(element: Element): boolean {
  return element.namespaceURI === htmlSpec.NS.HTML && allowlist.tags.includes(element.tagName);
}

/**
 * Cuts every attribute not allowed on an allowlisted element, with the whitespace before it.
 * A repeated attribute is always cut: the browser ignores it, but it would come alive if the
 * first one were cut, and keeping it would make a second pass cut it.
 */
function attributeCuts(input: string, element: Element): Cut[] {
  const startTag = element.sourceCodeLocation?.startTag;
  if (!isAllowedElement(element) || !startTag) return [];
  const seen = new Set<string>();
  return startTagAttributes(input, startTag.startOffset, startTag.endOffset).flatMap((attribute) => {
    const repeated = seen.has(attribute.name);
    seen.add(attribute.name);
    if (!repeated && isAllowedAttribute(element.tagName, attribute.name)) return [];
    const start = startOfPrecedingWhitespace(input, attribute.start);
    return [{
      start,
      end: attribute.end,
      kind: isEditorLeftover(attribute.name) ? "editor-leftover" : "attribute-removed",
      removedText: input.slice(start, attribute.end),
      context: { tag: element.tagName, attribute: attribute.name },
    }];
  });
}

const HTML_WHITESPACE = new Set(["\t", "\n", "\f", "\r", " "]);
const isWhitespace = (c: string | undefined) => c !== undefined && HTML_WHITESPACE.has(c);

/**
 * Every attribute in a start tag, repeats included, with its span. Read from the source by the
 * HTML tokenizer's rules, because parse5 drops repeated attributes and, after a parse error such
 * as a missing space between attributes, records only the end of an attribute's name.
 */
function startTagAttributes(input: string, tagStart: number, tagEnd: number) {
  const attributes: { name: string; start: number; end: number }[] = [];
  let i = tagStart + 1;
  while (i < tagEnd && !isWhitespace(input[i]) && input[i] !== "/" && input[i] !== ">") i++;
  while (i < tagEnd) {
    if (isWhitespace(input[i]) || input[i] === "/") { i++; continue; }
    if (input[i] === ">") break;
    const start = i;
    i++; // The first character belongs to the name even if it's `=`.
    while (i < tagEnd && !isWhitespace(input[i]) && !"/>=".includes(input[i])) i++;
    const name = input.slice(start, i).replace(/[A-Z]/g, (c) => c.toLowerCase());
    let end = i;
    let j = i;
    while (isWhitespace(input[j])) j++;
    if (input[j] === "=") {
      j++;
      while (isWhitespace(input[j])) j++;
      const quote = input[j];
      if (quote === '"' || quote === "'") {
        const close = input.indexOf(quote, j + 1);
        j = close < 0 ? tagEnd : close + 1;
      } else {
        while (j < tagEnd && !isWhitespace(input[j]) && input[j] !== ">") j++;
      }
      end = j;
    }
    attributes.push({ name, start, end: Math.min(end, tagEnd) });
    i = Math.max(end, i);
  }
  return attributes;
}

function startOfPrecedingWhitespace(input: string, offset: number): number {
  let start = offset;
  while (start > 0 && isWhitespace(input[start - 1])) start--;
  return start;
}
