import { defaultTreeAdapter, html as htmlSpec, parseFragment, type DefaultTreeAdapterTypes } from "parse5";
import { allowlist, isAllowedAttribute, isEditorLeftover, tagsRemovedWithContent } from "./allowlist";
import { applyCuts, type Cut } from "./cuts";
import { checkStyle, type StyleVerdict } from "./style-attribute";
import { asciiLower, isWhitespace } from "./text";

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;

type AttributeSpan = {
  name: string;
  start: number;
  end: number;
  /** The value between its quotes; empty at `end` when there is no value. */
  valueStart: number;
  valueEnd: number;
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
  collectCuts(input, fragment, cuts);
  cuts.push(...ignoredTagCuts(input, fragment));
  const log = withoutGluedTags(input, withoutOverlaps(input, cuts));
  return { html: applyCuts(input, log), cuts: log };
}

/** Child nodes, and a `<template>` element's content fragment. */
function eachChild(node: Node, visit: (child: Node) => void) {
  if ("childNodes" in node) for (const child of node.childNodes) visit(child);
  if ("content" in node) visit(node.content);
}

/** Walks the tree in document order. A removed element's subtree is covered by its own cut. */
function collectCuts(input: string, node: Node, cuts: Cut[]) {
  if ("tagName" in node) {
    if (isRemovedWithContent(node)) {
      const cut = removalCut(input, node);
      if (cut) cuts.push(cut);
      return;
    }
    if (isAllowedElement(node)) cuts.push(...attributeCuts(input, node));
    else cuts.push(...unwrapCuts(input, node));
  }
  eachChild(node, (child) => collectCuts(input, child, cuts));
}

function isAllowedElement(element: Element): boolean {
  return element.namespaceURI === htmlSpec.NS.HTML && allowlist.tags.includes(element.tagName);
}

/** Matched by name in any namespace: an SVG `<script>` or `<style>` is just as unwanted. */
function isRemovedWithContent(element: Element): boolean {
  return tagsRemovedWithContent.includes(element.tagName);
}

/**
 * The element from its start tag to its end, content included. The parser may have placed its
 * content elsewhere in the tree (foster parenting, implied closes); the source span is what's cut.
 * Elements the parser made up (reconstructed formatting, implied tbody) have no start tag to cut.
 */
function removalCut(input: string, element: Element): Cut | null {
  const location = element.sourceCodeLocation;
  if (!location?.startTag) return null;
  const start = location.startTag.startOffset;
  const end = Math.min(sourceEnd(element), input.length);
  return { start, end, kind: "tag-removed", removedText: input.slice(start, end), context: { tag: element.tagName } };
}

/**
 * Where an element's source ends. An element left open at the end of the input can report an
 * `endOffset` before its last descendant's start tag, so the descendants are consulted too.
 */
function sourceEnd(node: Node): number {
  const location = "sourceCodeLocation" in node ? node.sourceCodeLocation : undefined;
  let end = location?.endOffset ?? 0;
  if ("tagName" in node) end = Math.max(end, node.sourceCodeLocation?.startTag?.endOffset ?? 0);
  eachChild(node, (child) => {
    end = Math.max(end, sourceEnd(child));
  });
  return end;
}

/** Cuts the opening and closing tags, keeping the content. */
function unwrapCuts(input: string, element: Element): Cut[] {
  const location = element.sourceCodeLocation;
  return [location?.startTag, location?.endTag]
    .filter((tag) => tag !== undefined)
    .map(({ startOffset, endOffset }) => ({
      start: startOffset,
      end: endOffset,
      kind: "tag-unwrapped" as const,
      removedText: input.slice(startOffset, endOffset),
      context: { tag: element.tagName },
    }));
}

/**
 * Tag tokens the parser dropped without making an element: a stray `</font>`, `<body onload=…>`,
 * `<tr onclick=…>` outside a table, a tag cut short by the end of the input. They don't render
 * here, but they would come alive if the stored HTML were ever placed in another context.
 * Found as the tag-like tokens in the source that no node's location accounts for. Any such
 * start tag was ignored. Such an end tag may still have closed an element the parser rebuilt
 * (reconstructed formatting), or made one (`</p>`, `</br>`), so it's cut only when its name is
 * off the allowlist, which is what unwrapping would do anyway.
 */
function ignoredTagCuts(input: string, fragment: Node): Cut[] {
  const covered = new Uint8Array(input.length);
  coverLocatedSource(fragment, covered);
  const cuts: Cut[] = [];
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
    const keepsAllowedEndTag = isEndTag && allowlist.tags.includes(tag);
    if (!keepsAllowedEndTag) {
      cuts.push({ start, end, kind: "tag-unwrapped", removedText: input.slice(start, end), context: { tag } });
    }
    start = input.indexOf("<", end);
  }
  return cuts;
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

/** Where a tag token starting at `start` ends: after its `>`, or at the end of the input. */
function tagTokenEnd(input: string, start: number): number {
  const close = startTagAttributes(input, start, input.length).at(-1)?.end ?? indexAfterTagName(input, start, input.length);
  const index = input.indexOf(">", close);
  return index < 0 ? input.length : index + 1;
}

/**
 * Sorts the cuts and makes them disjoint. A reconstructed formatting element repeats its
 * original's start tag, and a removed element's source span can contain elements the parser
 * moved out of it; either way a cut inside another is dropped. Partial overlaps only arise from
 * misnested markup; the earlier cut is widened to cover both, and a removal outranks the rest.
 */
function withoutOverlaps(input: string, cuts: readonly Cut[]): Cut[] {
  const byStartThenLongerFirst = (a: Cut, b: Cut) => a.start - b.start || b.end - a.end;
  const sorted = [...cuts].sort(byStartThenLongerFirst);
  const log: Cut[] = [];
  for (const cut of sorted) {
    const previous = log.at(-1);
    if (!previous || cut.start >= previous.end) {
      log.push(cut);
      continue;
    }
    if (cut.end <= previous.end) continue;

    let merged: Cut;
    if (cut.kind === "tag-removed" && previous.kind !== "tag-removed") {
      merged = { ...cut, start: previous.start };
    } else {
      merged = { ...previous };
    }
    merged.end = cut.end;
    merged.removedText = input.slice(merged.start, merged.end);
    log[log.length - 1] = merged;
  }
  return log;
}

/**
 * Widens a run of touching cuts to take the literal `<` before it when the text after it would
 * otherwise start a new tag: cutting `<script>` out of `<<script>x</script>img onerror=…>` must
 * not leave a live `<img>`. Repeats until no run is left with a `<` glued to a tag start.
 */
function withoutGluedTags(input: string, cuts: readonly Cut[]): Cut[] {
  const log = [...cuts];
  for (let first = 0; first < log.length; ) {
    let last = first;
    while (last + 1 < log.length && log[last + 1].start === log[last].end) last++;

    const start = log[first].start;
    const replacements = log.slice(first, last + 1).map((cut) => cut.replacement ?? "").join("");
    const characterAfter = input.slice(log[last].end, log[last].end + 1);
    const textAfter = replacements + characterAfter;
    const gluesTag = start > 0 && input[start - 1] === "<" && /^[A-Za-z/!?]/.test(textAfter);
    if (!gluesTag) {
      first = last + 1;
      continue;
    }
    log[first] = { ...log[first], start: start - 1, removedText: input.slice(start - 1, log[first].end) };
    // The widened cut may now touch the run before it, so look at that run again.
    while (first > 0 && log[first - 1].end === log[first].start) first--;
  }
  return log;
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
  const styles = new Map<number, StyleVerdict>();
  for (let index = 0; index < attributes.length; index++) {
    const attribute = attributes[index];
    if (attribute.removed || attribute.name !== "style") continue;
    const verdict = checkStyle(input, attribute.valueStart, attribute.valueEnd);
    styles.set(index, verdict);
    if (!verdict.parseable || verdict.removesAll) attribute.removed = true;
  }

  const cuts: Cut[] = [];
  for (let index = 0; index < attributes.length; index++) {
    const attribute = attributes[index];
    const style = styles.get(index);
    if (style) {
      const wholeStart = attribute.removed ? startOfAttributeCut(input, attributes, index) : attribute.start;
      cuts.push(...styleCuts(input, element.tagName, style, wholeStart, attribute.end));
      continue;
    }
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

/**
 * An unparseable style is cut whole. Otherwise one cut per removed declaration; when none is
 * kept, those cuts are stretched to tile the attribute's whole cut, from `wholeStart` to `attributeEnd`.
 */
function styleCuts(input: string, tag: string, style: StyleVerdict, wholeStart: number, attributeEnd: number): Cut[] {
  if (!style.parseable) {
    return [
      {
        start: wholeStart,
        end: attributeEnd,
        kind: "style-unparseable",
        removedText: input.slice(wholeStart, attributeEnd),
        context: { tag, attribute: "style" },
      },
    ];
  }

  return style.cuts.map((declaration, index, cuts) => {
    let start = declaration.start;
    let end = declaration.end;
    if (style.removesAll) {
      start = index === 0 ? wholeStart : cuts[index - 1].end;
      if (index === cuts.length - 1) end = attributeEnd;
    }
    const context: Cut["context"] = { tag, attribute: "style", property: declaration.property };
    if (declaration.unsafeValue) context.unsafeValue = true;
    return {
      start,
      end,
      kind: "css-property-removed",
      removedText: input.slice(start, end),
      context,
    };
  });
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
  return endOfTagName(input, tagStart + 1, tagEnd);
}

/** First index after the name that begins at `from`. Stops at whitespace, `/` or `>`. */
function endOfTagName(input: string, from: number, limit: number): number {
  let index = from;
  while (index < limit && !isWhitespace(input[index]) && input[index] !== "/" && input[index] !== ">") index++;
  return index;
}

function readAttribute(input: string, start: number, tagEnd: number): AttributeSpan {
  let nameEnd = start + 1; // The first character belongs to the name even if it's `=`.
  while (nameEnd < tagEnd && !isWhitespace(input[nameEnd]) && !"/>=".includes(input[nameEnd])) nameEnd++;
  const value = attributeValue(input, nameEnd, tagEnd);
  const end = Math.min(value.end, tagEnd);
  const valueEnd = Math.min(value.valueEnd, end);
  return { name: asciiLower(input.slice(start, nameEnd)), start, end, valueStart: Math.min(value.valueStart, valueEnd), valueEnd };
}

/** Where the attribute ends, and its value's span inside any quotes. */
function attributeValue(input: string, nameEnd: number, tagEnd: number): { end: number; valueStart: number; valueEnd: number } {
  let index = nameEnd;
  while (isWhitespace(input[index])) index++;
  if (input[index] !== "=") return { end: nameEnd, valueStart: nameEnd, valueEnd: nameEnd };

  index++;
  while (isWhitespace(input[index])) index++;
  const quote = input[index];
  if (quote === '"' || quote === "'") {
    const close = input.indexOf(quote, index + 1);
    return close < 0 ? { end: tagEnd, valueStart: index + 1, valueEnd: tagEnd } : { end: close + 1, valueStart: index + 1, valueEnd: close };
  }
  const valueStart = index;
  while (index < tagEnd && !isWhitespace(input[index]) && input[index] !== ">") index++;
  return { end: index, valueStart, valueEnd: index };
}

function startOfPrecedingWhitespace(input: string, offset: number): number {
  let start = offset;
  while (start > 0 && isWhitespace(input[start - 1])) start--;
  return start;
}
