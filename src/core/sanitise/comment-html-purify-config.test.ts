import { JSDOM } from "jsdom";
import createDOMPurify from "dompurify";
import { beforeAll, describe, expect, it } from "vitest";
import { allCommentTexts } from "@/core/test/fixture-comment-texts";
import {
  allowlist,
  applyCommentHtmlDisplayAttributes,
  commentHtmlPurifyConfig,
  sanitiseCommentHtml,
} from "@/core/sanitise";

/**
 * jsdom 22, not 30: jsdom 30 require()s an ESM-only CSS package and fails to
 * load on Node 22.9. happy-dom reports itself supported and then leaves
 * script and handlers in the output, so the agreement check would pass vacuously.
 */
const purify = createDOMPurify(new JSDOM("").window);

describe("comment HTML render config", () => {
  beforeAll(() => {
    expect(purify.isSupported).toBe(true);
  });

  it("follows the allowlist's tags and attributes, and allows the display-only ones", () => {
    expect(new Set(commentHtmlPurifyConfig.ALLOWED_TAGS)).toEqual(new Set([...allowlist.tags, "body"]));
    expect(new Set(commentHtmlPurifyConfig.ALLOWED_ATTR)).toEqual(
      new Set([...Object.values(allowlist.attributes).flat(), "sandbox", "loading"]),
    );
    expect(commentHtmlPurifyConfig.ALLOW_DATA_ATTR).toBe(false);
    expect(commentHtmlPurifyConfig.ALLOW_ARIA_ATTR).toBe(false);
  });

  it("keeps allowlisted and relative URLs, and drops every other scheme", () => {
    const kept = purify.sanitize(
      [
        '<a href="https://example.com/a">h</a>',
        '<a href="http://example.com/a">h</a>',
        '<a href="mailto:a@b.c">m</a>',
        '<a href="tel:+15551212">t</a>',
        '<a href="/docs">r</a>',
        '<a href="#top">f</a>',
        '<img src="https://cdn.example/a.png" alt="photo">',
      ].join(""),
      commentHtmlPurifyConfig,
    );
    const body = new JSDOM(kept).window.document.body;
    expect([...body.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual([
      "https://example.com/a",
      "http://example.com/a",
      "mailto:a@b.c",
      "tel:+15551212",
      "/docs",
      "#top",
    ]);
    expect(body.querySelector("img")?.getAttribute("src")).toBe("https://cdn.example/a.png");

    const dropped = purify.sanitize(
      '<a href="javascript:alert(1)">x</a><a href="ftp://example.com/a">y</a><a href="data:text/html,x">z</a>',
      commentHtmlPurifyConfig,
    );
    expect(dropped).not.toContain("javascript:");
    expect(dropped).not.toContain("ftp:");
    expect(dropped).not.toContain("data:");
    expect(new JSDOM(dropped).window.document.body.textContent).toBe("xyz");
  });

  it("adds rel, sandbox and loading when the comment is shown, and the sanitiser does not store them", () => {
    const source = '<a href="https://example.com">link</a><img src="https://cdn.example/a.png" alt="photo"><iframe src="https://www.youtube.com/embed/abc"></iframe>';
    expect(sanitiseCommentHtml(source).html).toBe(source);

    purify.addHook("afterSanitizeAttributes", applyCommentHtmlDisplayAttributes);
    try {
      const shown = purify.sanitize(source, commentHtmlPurifyConfig);
      const body = new JSDOM(shown).window.document.body;
      expect(body.querySelector("a")?.getAttribute("rel")).toBe("noopener noreferrer");
      expect(body.querySelector("img")?.getAttribute("loading")).toBe("lazy");
      const frame = body.querySelector("iframe");
      // YouTube's player is JavaScript: an empty sandbox shows "An error occurred" instead of the video.
      // Scripts and same-origin apply to youtube.com's own origin, never ours; forms and top navigation stay blocked.
      expect(frame?.getAttribute("sandbox")?.split(" ").sort()).toEqual([
        "allow-popups",
        "allow-presentation",
        "allow-same-origin",
        "allow-scripts",
      ]);
      expect(frame?.getAttribute("loading")).toBe("lazy");
      expect(purify.removed).toEqual([]);
    } finally {
      purify.removeHook("afterSanitizeAttributes", applyCommentHtmlDisplayAttributes);
    }
  });

  it("removes nothing DOMPurify would remove from a sanitised fixture Comment", async () => {
    const cells = await allCommentTexts();
    expect(cells.length).toBeGreaterThan(2000);
    purify.addHook("afterSanitizeAttributes", applyCommentHtmlDisplayAttributes);
    try {
      for (const { fixture, row, text } of cells) {
        purify.sanitize(sanitiseCommentHtml(text).html, commentHtmlPurifyConfig);
        expect(purify.removed, `${fixture} row ${row}`).toEqual([]);
      }
    } finally {
      purify.removeHook("afterSanitizeAttributes", applyCommentHtmlDisplayAttributes);
    }
  });

  it("drops a script and its handler in this DOM, so an empty removed list means agreement", () => {
    const html = purify.sanitize('<script>alert(1)</script><p onclick="alert(1)">hi</p>', commentHtmlPurifyConfig);
    expect(html).toContain("hi");
    expect(html).not.toContain("alert");
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("script");
  });
});
