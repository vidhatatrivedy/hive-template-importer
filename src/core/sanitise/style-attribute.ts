import { parseFragment } from "parse5";
import { allowlist } from "./allowlist";
import { asciiLower, isWhitespace } from "./text";

/** A declaration to cut, as a span of the input. */
export type DeclarationCut = { start: number; end: number; property: string; unsafeValue: boolean };

/**
 * What to do with one `style` attribute value.
 * `removesAll`: no declaration is kept, so the caller cuts the attribute itself; the cuts
 * then tile the attribute, the first starting where the attribute's cut starts, the last
 * ending where it ends.
 */
export type StyleVerdict =
  | { parseable: false }
  | { parseable: true; cuts: DeclarationCut[]; removesAll: boolean };

type Declaration = {
  /** Offsets into the decoded value: first and past-last non-whitespace character. */
  start: number;
  end: number;
  /** Past the `;` that ends it, or `end` when there is none. */
  after: number;
  property: string;
  kept: boolean;
  unsafeValue: boolean;
};

type Opener = { closer: ")" | "]"; escaped: boolean };

/**
 * Checks a `style` value (the source span between its quotes) against the style-property
 * allowlist. A declaration is removed if its property isn't allowed or its value contains
 * `url(`, `expression(` or `@import` once comments, escapes and case are undone.
 * Declarations are found in the value as the browser decodes it (so `&semi;` separates
 * them), and mapped back to source spans.
 */
export function checkStyle(input: string, valueStart: number, valueEnd: number): StyleVerdict {
  const decoded = decodeWithOffsets(input, valueStart, valueEnd);
  const declarations = splitDeclarations(decoded.text);
  if (!declarations) return { parseable: false };

  const sourceOffset = (index: number) =>
    index < decoded.sourceOffsets.length ? decoded.sourceOffsets[index] : valueEnd;
  const lastKept = declarations.findLastIndex((declaration) => declaration.kept);
  const cuts: DeclarationCut[] = [];
  for (let index = 0; index < declarations.length; index++) {
    const declaration = declarations[index];
    if (declaration.kept) continue;
    const span = removedSpan(declarations, index, lastKept);
    cuts.push({
      start: sourceOffset(span.start),
      end: sourceOffset(span.end),
      property: declaration.property,
      unsafeValue: declaration.unsafeValue,
    });
  }
  return { parseable: true, cuts, removesAll: declarations.length > 0 && lastKept < 0 };
}

/**
 * A style value as parsed (character references already decoded), with every removed
 * declaration cut, written back as source: `&` becomes `&amp;`, so decoding it again gives
 * the kept value. Null when the value can't be parsed or no declaration is kept.
 */
export function keptStyleSource(value: string): string | null {
  const source = ampersandEncoded(value);
  const verdict = checkStyle(source, 0, source.length);
  if (!verdict.parseable || verdict.removesAll) return null;
  let kept = "";
  let position = 0;
  for (const cut of verdict.cuts) {
    kept += source.slice(position, cut.start);
    position = cut.end;
  }
  return kept + source.slice(position);
}

/** Whether the style filter would keep this parsed value with nothing removed. */
export function isStyleKeptWhole(value: string): boolean {
  return keptStyleSource(value) === ampersandEncoded(value);
}

/** `&` written as `&amp;`, so a parsed style value can be read as source again. */
function ampersandEncoded(value: string): string {
  return value.replace(/&/g, "&amp;");
}

/**
 * Where a removed declaration sits in the decoded value.
 * Before the last kept declaration, the cut runs up to the next one so that declaration
 * takes its place. After it, the cut takes the separator in front, so none is left dangling.
 * When nothing is kept, each cut runs through its own terminator and the caller tiles them.
 */
function removedSpan(declarations: readonly Declaration[], index: number, lastKept: number): { start: number; end: number } {
  const declaration = declarations[index];
  if (lastKept < 0) return { start: declaration.start, end: declaration.after };
  if (index < lastKept) return { start: declaration.start, end: declarations[index + 1].start };
  const end = index === declarations.length - 1 ? declaration.after : declaration.end;
  return { start: declarations[index - 1].end, end };
}

/**
 * The value with character references decoded, and for each decoded UTF-16 unit the source
 * offset it came from. The decoding is parse5's own, one reference at a time.
 */
function decodeWithOffsets(input: string, start: number, end: number): { text: string; sourceOffsets: number[] } {
  let text = "";
  const sourceOffsets: number[] = [];
  let index = start;
  while (index < end) {
    if (input[index] !== "&") {
      text += input[index];
      sourceOffsets.push(index);
      index++;
      continue;
    }
    const run = referenceRun(input, index, end);
    const nextIsEquals = input[index + run.length] === "=" && index + run.length < end;
    const { value, consumed } = decodeReference(run, nextIsEquals);
    text += value;
    for (let unit = 0; unit < value.length; unit++) sourceOffsets.push(index);
    index += consumed;
  }
  return { text, sourceOffsets };
}

/** The `&` and the characters a character reference can use, starting at `index`. */
function referenceRun(input: string, index: number, end: number): string {
  const match = /^&[A-Za-z0-9#;]*/.exec(input.slice(index, end));
  return match?.[0] ?? "&";
}

/**
 * Decodes the reference at the start of `run` (an `&` and the characters a reference can use)
 * as an attribute value would, returning its value and how many source characters it used.
 * `nextIsEquals`: the character after the run is `=`, which stops a legacy reference decoding.
 */
function decodeReference(run: string, nextIsEquals: boolean): { value: string; consumed: number } {
  const probe = run + (nextIsEquals ? "=" : "");
  const fragment = parseFragment(`<p title="${probe}">`);
  const element = fragment.childNodes[0];
  let decoded = "attrs" in element ? element.attrs[0].value : run;
  if (nextIsEquals) decoded = decoded.slice(0, -1);
  // Whatever follows the reference is copied through, so it's the longest source tail that
  // the decoded value ends with, leaving at least one decoded unit for the reference.
  for (let consumed = 1; consumed <= run.length; consumed++) {
    const tail = run.slice(consumed);
    if (decoded.length > tail.length && decoded.endsWith(tail)) {
      return { value: decoded.slice(0, decoded.length - tail.length), consumed };
    }
  }
  return { value: "&", consumed: 1 };
}

/**
 * Splits a decoded style value into its non-empty declarations, or returns null when it can't
 * be read with certainty: an unclosed string, comment or bracket, a stray closing bracket, a
 * brace, a newline in a string, or a declaration without a `:`.
 * A hex escape is the bracket it encodes, so `url\28x)` is a `url(` value and not a stray `)`.
 */
function splitDeclarations(text: string): Declaration[] | null {
  const declarations: Declaration[] = [];
  const openers: Opener[] = [];
  let segmentStart = 0;
  let colon = -1;

  const finishSegment = (end: number, after: number): boolean => {
    const classified = classifySegment(text, segmentStart, end, after, colon);
    segmentStart = after;
    colon = -1;
    if (classified === "empty") return true;
    if (classified === "invalid") return false;
    declarations.push(classified);
    return true;
  };

  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === "\\") {
      const escape = readCssEscape(text, index);
      if (!escape) continue;
      index = escape.next - 1;
      if (escape.hex) noteHexBracket(openers, escape.character);
      continue;
    }
    if (character === "/" && text[index + 1] === "*") {
      const close = text.indexOf("*/", index + 2);
      if (close < 0) return null;
      index = close + 1;
      continue;
    }
    if (character === '"' || character === "'") {
      const close = endOfString(text, index);
      if (close < 0) return null;
      index = close;
      continue;
    }
    if (character === "(" || character === "[") {
      openers.push({ closer: character === "(" ? ")" : "]", escaped: false });
      continue;
    }
    if (character === ")" || character === "]") {
      if (!closeLiteral(openers, character)) return null;
      continue;
    }
    if (character === "{" || character === "}") return null;
    if (!insideLiteralBrackets(openers) && character === ":" && colon < 0) {
      colon = index;
      continue;
    }
    if (!insideLiteralBrackets(openers) && character === ";") {
      if (!finishSegment(index, index + 1)) return null;
    }
  }
  if (insideLiteralBrackets(openers)) return null;
  if (!finishSegment(text.length, text.length)) return null;
  return declarations;
}

function classifySegment(
  text: string,
  segmentStart: number,
  end: number,
  after: number,
  colon: number,
): Declaration | "empty" | "invalid" {
  let start = segmentStart;
  let last = end;
  while (start < last && isWhitespace(text[start])) start++;
  while (last > start && isWhitespace(text[last - 1])) last--;
  if (withoutComments(text.slice(start, last)).trim() === "") return "empty";
  if (colon < 0) return "invalid";

  const property = asciiLower(unescapeCss(withoutComments(text.slice(start, colon))).trim());
  const value = asciiLower(unescapeCss(withoutComments(text.slice(colon + 1, last)))).replace(/\s/g, "");
  const unsafeValue = UNSAFE_VALUES.some((marker) => value.includes(marker));
  return {
    start,
    end: last,
    after,
    property,
    kept: allowlist.styleProperties.includes(property) && !unsafeValue,
    unsafeValue,
  };
}

const UNSAFE_VALUES = ["url(", "expression(", "@import"];

/** A hex escape of a bracket counts toward matching; any other decoded character does not. */
function noteHexBracket(openers: Opener[], character: string) {
  if (character === "(" || character === "[") {
    openers.push({ closer: character === "(" ? ")" : "]", escaped: true });
    return;
  }
  if (character !== ")" && character !== "]") return;
  const top = openers.at(-1);
  if (top?.escaped && top.closer === character) openers.pop();
}

/**
 * A literal closer matches a literal opener first, so an escaped opener can't steal it.
 * Failing that, a hex-escaped opener accounts for it (`url\28x)`). Otherwise it is stray.
 */
function closeLiteral(openers: Opener[], closer: ")" | "]"): boolean {
  const literal = lastOpener(openers, closer, false);
  if (literal >= 0) {
    openers.splice(literal, 1);
    return true;
  }
  const escaped = lastOpener(openers, closer, true);
  if (escaped >= 0) {
    openers.splice(escaped, 1);
    return true;
  }
  return false;
}

function lastOpener(openers: readonly Opener[], closer: ")" | "]", escaped: boolean): number {
  for (let index = openers.length - 1; index >= 0; index--) {
    if (openers[index].closer === closer && openers[index].escaped === escaped) return index;
  }
  return -1;
}

function insideLiteralBrackets(openers: readonly Opener[]): boolean {
  return openers.some((opener) => !opener.escaped);
}

/** Index of the quote closing the string opened at `open`, or -1. */
function endOfString(text: string, open: number): number {
  for (let index = open + 1; index < text.length; index++) {
    if (text[index] === "\\") index++;
    else if (text[index] === text[open]) return index;
    else if ("\n\r\f".includes(text[index])) return -1;
  }
  return -1;
}

function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "");
}

const HEX_ESCAPE = /^([0-9A-Fa-f]{1,6})(\r\n|[ \t\r\n\f])?/;

/** The CSS escape at `backslash`, or null when `\` is the last character. */
function readCssEscape(text: string, backslash: number): { character: string; next: number; hex: boolean } | null {
  const nextIndex = backslash + 1;
  if (nextIndex >= text.length) return null;
  const hex = HEX_ESCAPE.exec(text.slice(nextIndex));
  if (hex) return { character: characterFromHex(hex[1]), next: nextIndex + hex[0].length, hex: true };
  const character = text[nextIndex];
  return { character: character === "\n" ? "" : character, next: nextIndex + 1, hex: false };
}

function characterFromHex(hex: string): string {
  const codePoint = parseInt(hex, 16);
  const valid = codePoint > 0 && codePoint <= 0x10ffff && (codePoint < 0xd800 || codePoint > 0xdfff);
  return String.fromCodePoint(valid ? codePoint : 0xfffd);
}

/** CSS escapes: `\` and 1–6 hex digits with one optional whitespace, or `\` and any character. */
function unescapeCss(text: string): string {
  let decoded = "";
  for (let index = 0; index < text.length; index++) {
    if (text[index] !== "\\") {
      decoded += text[index];
      continue;
    }
    const escape = readCssEscape(text, index);
    if (!escape) return decoded + "\\";
    decoded += escape.character;
    index = escape.next - 1;
  }
  return decoded;
}
