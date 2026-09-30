const ASCII_WHITESPACE = new Set(["\t", "\n", "\f", "\r", " "]);

/** Space, tab, LF, FF and CR: the whitespace ASCII shares between HTML and CSS. */
export function isWhitespace(character: string | undefined): boolean {
  return character !== undefined && ASCII_WHITESPACE.has(character);
}

/** ASCII letters only; every other character stays as written. */
export function asciiLower(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}
