import { defaultTreeAdapter, html as htmlSpec, parseFragment, type DefaultTreeAdapterTypes } from "parse5";
import { allowlist, isAllowedAttribute, isEditorLeftover } from "./allowlist";
import { applyCuts, type Cut } from "./cuts";

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;

type AttributeSpan = {
  name: string;
  start: number;
  end: number;
};

type ClassifiedAttribute = AttributeSpan & {
  removed: boolean;
};

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
 * Cuts every attribute not allowed on an allowlisted element.
 * A repeated attribute is always cut: the browser ignores it, but it would come alive if the
 * first one were cut, and keeping it would make a second pass cut it.
 */
function attributeCuts(input: string, element: Element): Cut[] {
  const startTag = element.sourceCodeLocation?.startTag;
  if (!isAllowedElement(element) || !startTag) return [];

  const attributes = classifyAttributes(
    element.tagName,
    startTagAttributes(input, startTag.startOffset, startTag.endOffset),
  );
  const cuts: Cut[] = [];
  for (let index = 0; index < attributes.length; index++) {
    const attribute = attributes[index];
    if (!attribute.removed) continue;
    const start = startOfAttributeCut(input, attributes, index);
    cuts.push({
      start,
      end: attribute.end,
      kind: isEditorLeftover(attribute.name) ? "editor-leftover" : "attribute-removed",
      removedText: input.slice(start, attribute.end),
      context: { tag: element.tagName, attribute: attribute.name },
    });
  }
  return cuts;
}

function classifyAttributes(tag: string, attributes: readonly AttributeSpan[]): ClassifiedAttribute[] {
  const seen = new Set<string>();
  return attributes.map((attribute) => {
    const repeated = seen.has(attribute.name);
    seen.add(attribute.name);
    return { ...attribute, removed: repeated || !isAllowedAttribute(tag, attribute.name) };
  });
}

/**
 * Include the whitespace before a removed attribute, unless a later kept attribute is
 * jammed against it. That whitespace is the only separator left; eating it would glue the
 * kept attribute onto the tag name (`<p onclick="x"style="…">` must not become `<pstyle=…>`).
 */
function startOfAttributeCut(input: string, attributes: readonly ClassifiedAttribute[], index: number): number {
  const attribute = attributes[index];
  if (laterKeptAttributeIsJammed(input, attributes, index)) return attribute.start;
  return startOfPrecedingWhitespace(input, attribute.start);
}

function laterKeptAttributeIsJammed(input: string, attributes: readonly ClassifiedAttribute[], index: number): boolean {
  let cursor = attributes[index].end;
  for (let later = index + 1; later < attributes.length; later++) {
    if (hasWhitespace(input, cursor, attributes[later].start)) return false;
    if (!attributes[later].removed) return true;
    cursor = attributes[later].end;
  }
  return false;
}

function hasWhitespace(input: string, from: number, to: number): boolean {
  for (let index = from; index < to; index++) {
    if (isWhitespace(input[index])) return true;
  }
  return false;
}

const HTML_WHITESPACE = new Set(["\t", "\n", "\f", "\r", " "]);
const isWhitespace = (character: string | undefined) => character !== undefined && HTML_WHITESPACE.has(character);

/**
 * Every attribute in a start tag, repeats included, with its span. Read from the source by the
 * HTML tokenizer's rules, because parse5 drops repeated attributes and, after a parse error such
 * as a missing space between attributes, records only the end of an attribute's name.
 */
function startTagAttributes(input: string, tagStart: number, tagEnd: number): AttributeSpan[] {
  const attributes: AttributeSpan[] = [];
  let index = indexAfterTagName(input, tagStart, tagEnd);
  while (index < tagEnd && input[index] !== ">") {
    if (isWhitespace(input[index]) || input[index] === "/") {
      index++;
      continue;
    }
    const attribute = readAttribute(input, index, tagEnd);
    attributes.push(attribute);
    index = attribute.end;
  }
  return attributes;
}

function indexAfterTagName(input: string, tagStart: number, tagEnd: number): number {
  let index = tagStart + 1;
  while (index < tagEnd && !isWhitespace(input[index]) && input[index] !== "/" && input[index] !== ">") index++;
  return index;
}

function readAttribute(input: string, start: number, tagEnd: number): AttributeSpan {
  let nameEnd = start + 1; // The first character belongs to the name even if it's `=`.
  while (nameEnd < tagEnd && !isWhitespace(input[nameEnd]) && !"/>=".includes(input[nameEnd])) nameEnd++;
  const end = Math.min(attributeValueEnd(input, nameEnd, tagEnd), tagEnd);
  return { name: asciiLower(input.slice(start, nameEnd)), start, end };
}

function attributeValueEnd(input: string, nameEnd: number, tagEnd: number): number {
  let index = nameEnd;
  while (isWhitespace(input[index])) index++;
  if (input[index] !== "=") return nameEnd;

  index++;
  while (isWhitespace(input[index])) index++;
  const quote = input[index];
  if (quote === '"' || quote === "'") {
    const close = input.indexOf(quote, index + 1);
    return close < 0 ? tagEnd : close + 1;
  }
  while (index < tagEnd && !isWhitespace(input[index]) && input[index] !== ">") index++;
  return index;
}

/** HTML compares attribute names case-insensitively for ASCII letters only. */
function asciiLower(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

function startOfPrecedingWhitespace(input: string, offset: number): number {
  let start = offset;
  while (start > 0 && isWhitespace(input[start - 1])) start--;
  return start;
}
