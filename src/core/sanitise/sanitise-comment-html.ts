import { isAllowedAttribute, isEditorLeftover } from "./allowlist";
import { applyCuts, type Cut } from "./cuts";
import { rebuildFragment } from "./rebuild";
import { allowlistViolations } from "./self-check";
import { startTagAttributes, type AttributeSpan } from "./source-tags";
import { checkStyle, type StyleVerdict } from "./style-attribute";
import { isWhitespace } from "./text";
import {
  attributeValueOf,
  eachChild,
  isAllowedElement,
  isEmptyYoutubeWrapper,
  isHarmlessStrayTag,
  isRemovedWithContent,
  MAX_NESTING_DEPTH,
  nestingDepth,
  parseCommentFragment,
  sourceEnd,
  strayTagTokens,
  type Element,
  type Node,
} from "./tree";
import { iframeReplacement, isAllowedUrl, isUrlAttribute, isYoutubeEmbed } from "./url";

type ClassifiedAttribute = AttributeSpan & {
  removed: boolean;
  /** Why it's removed, when that isn't simply being off the allowlist. */
  kind?: "link-scheme-removed" | "youtube-wrapper-emptied";
};

/**
 * Sanitises one Comment's HTML by cutting spans out of the original string, never
 * re-serialising (ADR 0001). The input is the raw Comment Text cell: no trimming, no
 * entity decoding. Everything outside the returned cuts is left byte for byte.
 * The output is parsed again and checked against the allowlist before it's returned.
 */
export function sanitiseCommentHtml(input: string): { html: string; cuts: Cut[] } {
  if (input === "") return { html: "", cuts: [] };
  const fragment = parseCommentFragment(input);
  if (nestingDepth(fragment) <= MAX_NESTING_DEPTH) {
    const cuts = spanCuts(input, fragment);
    const html = applyCuts(input, cuts);
    if (allowlistViolations(html).length === 0) return { html, cuts };
  }
  return rebuildMarkup(input, fragment);
}

function spanCuts(input: string, fragment: Node): Cut[] {
  const cuts: Cut[] = [];
  collectCuts(input, fragment, cuts);
  cuts.push(...ignoredTagCuts(input, fragment));
  return withoutGluedTags(input, withoutOverlaps(input, cuts));
}

/**
 * The fallback when the cut output fails the allowlist check, or the markup is nested too deep
 * for its positions to be trusted: the whole fragment rebuilt from the parse tree, logged as one cut.
 */
function rebuildMarkup(input: string, fragment: Node): { html: string; cuts: Cut[] } {
  const html = rebuildFragment(fragment);
  const cut: Cut = {
    start: 0,
    end: input.length,
    kind: "markup-rebuilt",
    removedText: input,
    replacement: html,
    // A fragment has no element name; `#document-fragment` still records where the rebuild started.
    context: { tag: fragment.nodeName },
  };
  return { html, cuts: [cut] };
}

/** Walks the tree in document order. A removed element's subtree is covered by its own cut. */
function collectCuts(input: string, node: Node, cuts: Cut[]) {
  if ("tagName" in node) {
    if (isRemovedWithContent(node)) {
      const cut = removalCut(input, node);
      if (cut) cuts.push(cut);
      return;
    }
    if (isIframeReplacedByLink(node)) {
      const cut = iframeToLinkCut(input, node);
      if (cut) cuts.push(cut);
      return;
    }
    if (isAllowedElement(node)) cuts.push(...attributeCuts(input, node));
    else cuts.push(...unwrapCuts(input, node));
  }
  eachChild(node, (child) => collectCuts(input, child, cuts));
}

/**
 * Stray tag tokens (see `strayTagTokens`) are cut, except end tags of allowlisted elements,
 * which unwrapping would keep anyway.
 */
function ignoredTagCuts(input: string, fragment: Node): Cut[] {
  return strayTagTokens(input, fragment)
    .filter((token) => !isHarmlessStrayTag(token))
    .map(({ start, end, tag }) => ({ start, end, kind: "tag-unwrapped", removedText: input.slice(start, end), context: { tag } }));
}

/**
 * The element from its start tag to its end, content included. The parser may have placed its
 * content elsewhere in the tree (foster parenting, implied closes); the source span is what's cut.
 * Elements the parser made up (reconstructed formatting, implied tbody) have no start tag to cut.
 */
function elementSourceSpan(input: string, element: Element): { start: number; end: number } | null {
  const startTag = element.sourceCodeLocation?.startTag;
  if (!startTag) return null;
  return { start: startTag.startOffset, end: Math.min(sourceEnd(element), input.length) };
}

function removalCut(input: string, element: Element): Cut | null {
  const span = elementSourceSpan(input, element);
  if (!span) return null;
  return { ...span, kind: "tag-removed", removedText: input.slice(span.start, span.end), context: { tag: element.tagName } };
}

/** A kept iframe whose `src` is not a YouTube embed. Its content is raw text, so the whole element goes. */
function isIframeReplacedByLink(element: Element): boolean {
  if (!isAllowedElement(element) || element.tagName !== "iframe") return false;
  return !isYoutubeEmbed(attributeValueOf(element, "src") ?? "");
}

/** Replaces that iframe with a link to its `src`, or with the `src` as plain text when the link would be unsafe. */
function iframeToLinkCut(input: string, element: Element): Cut | null {
  const span = elementSourceSpan(input, element);
  if (!span) return null;
  return {
    ...span,
    kind: "iframe-to-link",
    removedText: input.slice(span.start, span.end),
    replacement: iframeReplacement(attributeValueOf(element, "src")),
    context: { tag: "iframe", attribute: "src" },
  };
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

  const spans = startTagAttributes(input, startTag.startOffset, startTag.endOffset);
  const attributes = classifyAttributes(element, spans);
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
    const previous = cuts.at(-1);
    if (attribute.kind === "youtube-wrapper-emptied" && previous?.kind === attribute.kind && previous.end === start) {
      previous.end = attribute.end;
      previous.removedText = input.slice(previous.start, previous.end);
      continue;
    }
    cuts.push({
      start,
      end: attribute.end,
      kind: attributeCutKind(attribute),
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

function attributeCutKind(attribute: ClassifiedAttribute): Cut["kind"] {
  if (attribute.kind) return attribute.kind;
  if (isEditorLeftover(attribute.name)) return "editor-leftover";
  return "attribute-removed";
}

/**
 * Marks each attribute kept or removed. Only the first of a repeated name is read by the
 * browser, so only that one is checked for its URL scheme or a YouTube wrapper.
 */
function classifyAttributes(element: Element, attributes: readonly AttributeSpan[]): ClassifiedAttribute[] {
  const emptyWrapper = isEmptyYoutubeWrapper(element);
  const seen = new Set<string>();
  return attributes.map((attribute) => {
    const first = !seen.has(attribute.name);
    seen.add(attribute.name);
    return classifyAttribute(element, attribute, first, emptyWrapper);
  });
}

function classifyAttribute(element: Element, attribute: AttributeSpan, first: boolean, emptyWrapper: boolean): ClassifiedAttribute {
  const offAllowlist = !isAllowedAttribute(element.tagName, attribute.name);
  if (!first || offAllowlist) {
    if (first && emptyWrapper && attribute.name === "class") {
      return { ...attribute, removed: true, kind: "youtube-wrapper-emptied" };
    }
    return { ...attribute, removed: true };
  }
  if (emptyWrapper && attribute.name === "style") {
    return { ...attribute, removed: true, kind: "youtube-wrapper-emptied" };
  }
  if (isDisallowedUrl(element, attribute.name)) {
    return { ...attribute, removed: true, kind: "link-scheme-removed" };
  }
  return { ...attribute, removed: false };
}

function isDisallowedUrl(element: Element, name: string): boolean {
  return isUrlAttribute(element.tagName, name) && !isAllowedUrl(attributeValueOf(element, name) ?? "");
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

function startOfPrecedingWhitespace(input: string, offset: number): number {
  let start = offset;
  while (start > 0 && isWhitespace(input[start - 1])) start--;
  return start;
}
