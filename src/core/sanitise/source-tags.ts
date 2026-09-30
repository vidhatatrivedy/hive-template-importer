import { asciiLower, isWhitespace } from "./text";

/** An attribute as written in a start tag, located in the source. */
export type AttributeSpan = {
  name: string;
  start: number;
  end: number;
  /** The value between its quotes; empty at `end` when there is no value. */
  valueStart: number;
  valueEnd: number;
};

/** Where a tag token starting at `start` ends: after its `>`, or at the end of the input. */
export function tagTokenEnd(input: string, start: number): number {
  const close = startTagAttributes(input, start, input.length).at(-1)?.end ?? indexAfterTagName(input, start, input.length);
  const index = input.indexOf(">", close);
  return index < 0 ? input.length : index + 1;
}

/**
 * Every attribute in a start tag, repeats included, with its span. Read from the source by the
 * HTML tokenizer's rules, because parse5 drops repeated attributes and, after a parse error such
 * as a missing space between attributes, records only the end of an attribute's name.
 */
export function startTagAttributes(input: string, tagStart: number, tagEnd: number): AttributeSpan[] {
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
export function endOfTagName(input: string, from: number, limit: number): number {
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
