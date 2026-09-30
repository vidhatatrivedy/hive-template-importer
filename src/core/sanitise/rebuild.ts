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
  const pending: ({ node: Node; depth: number } | string)[] = [{ node: fragment, depth: 0 }];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (typeof next === "string") {
      html += next;
      continue;
    }
    const { node, depth } = next;
    if (node.nodeName === "#text" && "value" in node) {
      html += escapeHtml(node.value);
      continue;
    }
    let childDepth = depth;
    if ("tagName" in node) {
      if (isRemovedWithContent(node)) continue;
      if (isAllowedElement(node) && node.tagName === "iframe") {
        const src = attributeValueOf(node, "src");
        if (depth >= MAX_NESTING_DEPTH) html += escapeHtml(src ?? "");
        else html += isYoutubeEmbed(src ?? "") ? `${startTag(node)}</iframe>` : iframeReplacement(src);
        continue;
      }
      if (isAllowedElement(node) && depth < MAX_NESTING_DEPTH) {
        html += startTag(node);
        if (VOID_TAGS.has(node.tagName)) continue;
        // The parser drops a newline straight after `<pre>`, so one that was content is written twice.
        const first = node.childNodes[0];
        if (node.tagName === "pre" && first && "value" in first && first.value.startsWith("\n")) html += "\n";
        pending.push(`</${node.tagName}>`);
        childDepth = depth + 1;
      }
    }
    const children: Node[] = [];
    eachChild(node, (child) => children.push(child));
    for (const child of children.reverse()) pending.push({ node: child, depth: childDepth });
  }
  return html;
}

function startTag(element: Element): string {
  const emptyWrapper = isEmptyYoutubeWrapper(element);
  let tag = `<${element.tagName}`;
  for (const { name, value } of element.attrs) {
    if (!isAllowedAttribute(element.tagName, name)) continue;
    if (isUrlAttribute(element.tagName, name) && !isAllowedUrl(value)) continue;
    if (name !== "style") {
      tag += ` ${name}="${escapeHtml(value)}"`;
      continue;
    }
    const style = emptyWrapper ? null : keptStyleSource(value);
    if (style !== null) tag += ` style="${style.replace(/"/g, "&quot;")}"`;
  }
  return `${tag}>`;
}
