import { defaultTreeAdapter, html as htmlSpec, parseFragment, type DefaultTreeAdapterTypes } from "parse5";
import { allowlist, isAllowedAttribute, isEditorLeftover, tagsRemovedWithContent } from "./allowlist";
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
  collectCuts(input, fragment, cuts);
  cuts.push(...ignoredTagCuts(input, fragment));
  const log = withoutGluedTags(input, withoutOverlaps(input, cuts));
  return { html: applyCuts(input, log), cuts: log };
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
  if ("childNodes" in node) for (const child of node.childNodes) collectCuts(input, child, cuts);
  if ("content" in node) collectCuts(input, node.content, cuts);
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
  if ("childNodes" in node) for (const child of node.childNodes) end = Math.max(end, sourceEnd(child));
  if ("content" in node) end = Math.max(end, sourceEnd(node.content));
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

/** Elements whose content the tokenizer reads as text, so a `<` inside isn't a tag. */
const RAW_TEXT_TAGS = ["script", "style", "xmp", "iframe", "noembed", "noframes", "noscript", "textarea", "title", "plaintext"];

/** Only in HTML: an `<iframe>` inside `<svg>` is an SVG element whose content is markup. */
function isRawText(element: Element): boolean {
  return element.namespaceURI === htmlSpec.NS.HTML && RAW_TEXT_TAGS.includes(element.tagName);
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
  for (let start = input.indexOf("<"); start >= 0; start = input.indexOf("<", start + 1)) {
    if (covered[start]) continue;
    const isEndTag = input[start + 1] === "/";
    const nameStart = start + (isEndTag ? 2 : 1);
    if (!/[A-Za-z]/.test(input[nameStart] ?? "")) continue;
    const tag = asciiLower(input.slice(nameStart, indexAfterTagName(input, nameStart - 1, input.length)));
    const end = tagTokenEnd(input, start);
    if (!isEndTag || !allowlist.tags.includes(tag)) {
      cuts.push({ start, end, kind: "tag-unwrapped", removedText: input.slice(start, end), context: { tag } });
    }
    start = end - 1;
  }
  return cuts;
}

function coverLocatedSource(node: Node, covered: Uint8Array) {
  const location = "sourceCodeLocation" in node ? node.sourceCodeLocation : undefined;
  if ("tagName" in node) {
    const { startTag, endTag } = node.sourceCodeLocation ?? {};
    if (startTag && (isRemovedWithContent(node) || isRawText(node))) {
      covered.fill(1, startTag.startOffset, sourceEnd(node)); // Clamped to the input by `fill`.
    }
    if (startTag) covered.fill(1, startTag.startOffset, startTag.endOffset);
    if (endTag) covered.fill(1, endTag.startOffset, endTag.endOffset);
  } else if (node.nodeName === "#comment" && location) {
    covered.fill(1, location.startOffset, location.endOffset);
  }
  if ("childNodes" in node) for (const child of node.childNodes) coverLocatedSource(child, covered);
  if ("content" in node) coverLocatedSource(node.content, covered);
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
    const run = log.slice(first, last + 1);
    const after = run.map((cut) => cut.replacement ?? "").join("") + input.slice(log[last].end, log[last].end + 1);
    const start = log[first].start;
    const gluesTag = start > 0 && input[start - 1] === "<" && /^[A-Za-z/!?]/.test(after);
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

function withoutOverlaps(input: string, cuts: readonly Cut[]): Cut[] {
  const sorted = [...cuts].sort((a, b) => a.start - b.start || b.end - a.end);
  const log: Cut[] = [];
  for (const cut of sorted) {
    const previous = log.at(-1);
    if (!previous || cut.start >= previous.end) {
      log.push(cut);
    } else if (cut.end > previous.end) {
      const merged = cut.kind === "tag-removed" && previous.kind !== "tag-removed" ? { ...cut, start: previous.start } : { ...previous };
      merged.end = cut.end;
      merged.removedText = input.slice(merged.start, merged.end);
      log[log.length - 1] = merged;
    }
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
