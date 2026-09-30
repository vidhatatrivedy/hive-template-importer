import { parseFragment } from "parse5";
import { allowlist } from "./allowlist";

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

  const at = (index: number) => (index < decoded.from.length ? decoded.from[index] : valueEnd);
  const cut = (declaration: Declaration, start: number, end: number): DeclarationCut => ({
    start: at(start),
    end: at(end),
    property: declaration.property,
    unsafeValue: declaration.unsafeValue,
  });

  const lastKept = declarations.findLastIndex((declaration) => declaration.kept);
  const cuts: DeclarationCut[] = [];
  declarations.forEach((declaration, index) => {
    if (declaration.kept) return;
    if (lastKept < 0) {
      cuts.push(cut(declaration, declaration.start, declaration.after));
    } else if (index < lastKept) {
      // Up to the next declaration, so the one after it takes its place.
      cuts.push(cut(declaration, declaration.start, declarations[index + 1].start));
    } else {
      // After the last kept one: take the separator before it instead, so none is left dangling.
      cuts.push(cut(declaration, declarations[index - 1].end, index === declarations.length - 1 ? declaration.after : declaration.end));
    }
  });
  return { parseable: true, cuts, removesAll: declarations.length > 0 && lastKept < 0 };
}

/**
 * The value with character references decoded, and for each decoded UTF-16 unit the source
 * offset it came from. The decoding is parse5's own, one reference at a time.
 */
function decodeWithOffsets(input: string, start: number, end: number): { text: string; from: number[] } {
  let text = "";
  const from: number[] = [];
  let index = start;
  while (index < end) {
    if (input[index] !== "&") {
      text += input[index];
      from.push(index);
      index++;
      continue;
    }
    const run = /^&[A-Za-z0-9#;]*/.exec(input.slice(index, end))![0];
    const { value, consumed } = decodeReference(run, input[index + run.length] === "=" && index + run.length < end);
    text += value;
    for (let unit = 0; unit < value.length; unit++) from.push(index);
    index += consumed;
  }
  return { text, from };
}

/**
 * Decodes the reference at the start of `run` (an `&` and the characters a reference can use)
 * as an attribute value would, returning its value and how many source characters it used.
 * `beforeEquals`: the character after the run is `=`, which stops a legacy reference decoding.
 */
function decodeReference(run: string, beforeEquals: boolean): { value: string; consumed: number } {
  const probe = run + (beforeEquals ? "=" : "");
  const fragment = parseFragment(`<p title="${probe}">`);
  const element = fragment.childNodes[0];
  let decoded = "attrs" in element ? element.attrs[0].value : run;
  if (beforeEquals) decoded = decoded.slice(0, -1);
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
 */
function splitDeclarations(text: string): Declaration[] | null {
  const declarations: Declaration[] = [];
  const closers: string[] = [];
  let segmentStart = 0;
  let colon = -1;

  const endSegment = (end: number, after: number): boolean => {
    let start = segmentStart;
    let last = end;
    while (start < last && isCssWhitespace(text[start])) start++;
    while (last > start && isCssWhitespace(text[last - 1])) last--;
    segmentStart = after;
    const found = colon;
    colon = -1;
    if (withoutComments(text.slice(start, last)).trim() === "") return true;
    if (found < 0) return false;
    const property = asciiLower(unescapeCss(withoutComments(text.slice(start, found))).trim());
    const value = asciiLower(unescapeCss(withoutComments(text.slice(found + 1, last)))).replace(/\s/g, "");
    const unsafeValue = UNSAFE_VALUES.some((marker) => value.includes(marker));
    const kept = allowlist.styleProperties.includes(property) && !unsafeValue;
    declarations.push({ start, end: last, after, property, kept, unsafeValue });
    return true;
  };

  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === "\\") {
      index++;
    } else if (character === "/" && text[index + 1] === "*") {
      const close = text.indexOf("*/", index + 2);
      if (close < 0) return null;
      index = close + 1;
    } else if (character === '"' || character === "'") {
      const close = endOfString(text, index);
      if (close < 0) return null;
      index = close;
    } else if (character === "(" || character === "[") {
      closers.push(character === "(" ? ")" : "]");
    } else if (character === ")" || character === "]") {
      if (closers.pop() !== character) return null;
    } else if (character === "{" || character === "}") {
      return null;
    } else if (closers.length === 0 && character === ":" && colon < 0) {
      colon = index;
    } else if (closers.length === 0 && character === ";") {
      if (!endSegment(index, index + 1)) return null;
    }
  }
  if (closers.length > 0) return null;
  if (!endSegment(text.length, text.length)) return null;
  return declarations;
}

const UNSAFE_VALUES = ["url(", "expression(", "@import"];

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

/** CSS escapes: `\` and 1–6 hex digits with one optional whitespace, or `\` and any character. */
function unescapeCss(text: string): string {
  return text.replace(/\\(?:([0-9A-Fa-f]{1,6})(?:\r\n|[ \t\r\n\f])?|([\s\S]))/g, (_, hex: string | undefined, character: string | undefined) => {
    if (hex === undefined) return character === "\n" ? "" : character!;
    const codePoint = parseInt(hex, 16);
    const valid = codePoint > 0 && codePoint <= 0x10ffff && (codePoint < 0xd800 || codePoint > 0xdfff);
    return String.fromCodePoint(valid ? codePoint : 0xfffd);
  });
}

const isCssWhitespace = (character: string | undefined) => character !== undefined && " \t\n\r\f".includes(character);

function asciiLower(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}
