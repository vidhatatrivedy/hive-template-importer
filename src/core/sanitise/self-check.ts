import { isAllowedAttribute } from "./allowlist";
import { startTagAttributes } from "./source-tags";
import { keptStyleSource } from "./style-attribute";
import {
  eachChild,
  isAllowedElement,
  isHarmlessStrayTag,
  MAX_NESTING_DEPTH,
  nestingDepth,
  parseCommentFragment,
  strayTagTokens,
  type Element,
  type Node,
} from "./tree";
import { isAllowedUrl, isUrlAttribute, isYoutubeEmbed } from "./url";

/**
 * Everything in `html`, parsed as it will be shown, that the allowlist doesn't permit:
 * a disallowed element, attribute, URL scheme, iframe source or style declaration, a repeated
 * attribute, a tag token the parser ignored, or nesting too deep to be shown as parsed.
 * Empty when the HTML is safe to store. Checks the parsed result, independently of how the
 * sanitiser chose its cuts.
 */
export function allowlistViolations(html: string): string[] {
  const fragment = parseCommentFragment(html);
  if (nestingDepth(fragment) > MAX_NESTING_DEPTH) return [`elements nested deeper than ${MAX_NESTING_DEPTH}`];
  const violations: string[] = [];
  collectViolations(html, fragment, violations);
  for (const token of strayTagTokens(html, fragment)) {
    if (!isHarmlessStrayTag(token)) violations.push(`stray tag <${token.isEndTag ? "/" : ""}${token.tag}>`);
  }
  return violations;
}

function collectViolations(html: string, node: Node, violations: string[]) {
  if ("tagName" in node) {
    if (isAllowedElement(node)) violations.push(...attributeViolations(html, node));
    else violations.push(`element <${node.tagName}>`);
  }
  eachChild(node, (child) => collectViolations(html, child, violations));
}

function attributeViolations(html: string, element: Element): string[] {
  const tag = element.tagName;
  const violations: string[] = [];
  const startTag = element.sourceCodeLocation?.startTag;
  if (startTag) {
    const names = startTagAttributes(html, startTag.startOffset, startTag.endOffset).map((attribute) => attribute.name);
    for (const name of new Set(names.filter((name, index) => names.indexOf(name) !== index))) {
      violations.push(`repeated attribute ${tag}[${name}]`);
    }
  }
  for (const { name, value } of element.attrs) {
    if (!isAllowedAttribute(tag, name)) violations.push(`attribute ${tag}[${name}]`);
    else if (name === "style" && !isCleanStyle(value)) violations.push(`style ${tag}[style="${value}"]`);
    else if (isUrlAttribute(tag, name) && !isAllowedUrl(value)) {
      violations.push(`URL ${tag}[${name}="${value}"]`);
    }
  }
  if (tag === "iframe" && !isYoutubeEmbed(element.attrs.find((attribute) => attribute.name === "src")?.value ?? "")) {
    violations.push("iframe that isn't a YouTube embed");
  }
  return violations;
}

/** A style value as parsed that the style filter would keep whole. */
function isCleanStyle(value: string): boolean {
  return keptStyleSource(value) === value.replace(/&/g, "&amp;");
}
