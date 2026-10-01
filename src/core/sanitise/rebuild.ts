import { isAllowedAttribute } from "./allowlist";
import { keptStyleSource } from "./style-attribute";
import {
  attributeValueOf,
  eachChild,
  isAllowedElement,
  isEmptyYoutubeWrapper,
  isRemovedWithContent,
  MAX_NESTING_DEPTH,
  type Element,
  type Node,
} from "./tree";
import { escapeHtml, iframeReplacement, isAllowedUrl, isUrlAttribute, isYoutubeEmbed } from "./url";

const VOID_TAGS = new Set(["br", "hr", "img"]);

type Pending = { kind: "node"; node: Node; depth: number } | { kind: "close"; tag: string };

/**
 * Writes a parsed fragment back out using only allowlisted content, by the same rules the cuts
 * follow: removed elements go with their content, other disallowed elements are unwrapped,
 * disallowed attributes and style declarations are dropped, other iframes become links.
 * Comments are dropped. Elements nested past `MAX_NESTING_DEPTH` are unwrapped (an iframe there
 * leaves its `src` as text), so the result is shown as parsed. Walks without recursion, so any
 * depth is safe.
 */
export function rebuildFragment(fragment: Node): string {
  let html = "";
  const pending: Pending[] = [{ kind: "node", node: fragment, depth: 0 }];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (next.kind === "close") {
      html += `</${next.tag}>`;
      continue;
    }
    html += writeNode(next.node, next.depth, pending);
  }
  return html;
}

function writeNode(node: Node, depth: number, pending: Pending[]): string {
  if (node.nodeName === "#text" && "value" in node) return escapeHtml(node.value);
  if (!("tagName" in node)) {
    enqueueChildren(node, depth, pending);
    return "";
  }
  if (isRemovedWithContent(node)) return "";
  if (isAllowedElement(node) && node.tagName === "iframe") return writeIframe(node, depth);
  if (isAllowedElement(node) && depth < MAX_NESTING_DEPTH) return writeKeptElement(node, depth, pending);
  enqueueChildren(node, depth, pending);
  return "";
}

function writeIframe(element: Element, depth: number): string {
  const src = attributeValueOf(element, "src");
  if (depth >= MAX_NESTING_DEPTH) return escapeHtml(src ?? "");
  if (isYoutubeEmbed(src ?? "")) return `${startTag(element)}</iframe>`;
  return iframeReplacement(src);
}

function writeKeptElement(element: Element, depth: number, pending: Pending[]): string {
  const open = startTag(element);
  if (VOID_TAGS.has(element.tagName)) return open;
  pending.push({ kind: "close", tag: element.tagName });
  enqueueChildren(element, depth + 1, pending);
  return open + leadingPreNewline(element);
}

/**
 * The parser drops a newline straight after `<pre>`, so one that was content is written twice.
 */
function leadingPreNewline(element: Element): string {
  const first = element.childNodes[0];
  if (element.tagName === "pre" && first && "value" in first && first.value.startsWith("\n")) return "\n";
  return "";
}

function enqueueChildren(node: Node, depth: number, pending: Pending[]) {
  const children: Node[] = [];
  eachChild(node, (child) => children.push(child));
  for (const child of children.reverse()) pending.push({ kind: "node", node: child, depth });
}

function startTag(element: Element): string {
  const emptyWrapper = isEmptyYoutubeWrapper(element);
  let tag = `<${element.tagName}`;
  for (const { name, value } of element.attrs) {
    const kept = keptAttributeValue(element, name, value, emptyWrapper);
    if (kept !== null) tag += ` ${name}="${kept}"`;
  }
  return `${tag}>`;
}

function keptAttributeValue(element: Element, name: string, value: string, emptyWrapper: boolean): string | null {
  if (!isAllowedAttribute(element.tagName, name)) return null;
  if (isUrlAttribute(element.tagName, name) && !isAllowedUrl(value)) return null;
  if (name !== "style") return escapeHtml(value);
  if (emptyWrapper) return null;
  const style = keptStyleSource(value);
  // `&` is already `&amp;` in that source. `escapeHtml` would encode it a second time.
  return style === null ? null : style.replace(/"/g, "&quot;");
}
