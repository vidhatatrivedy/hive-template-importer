import { beforeAll, describe, expect, it } from "vitest";
import { allCommentTexts, type FixtureCell } from "@/core/test/fixture-comment-texts";
import { allowlist, applyCuts, sanitiseCommentHtml, type Cut } from "@/core/sanitise";

let cells: FixtureCell[];
beforeAll(async () => {
  cells = await allCommentTexts();
});

const count = (text: string, needle: string) => text.split(needle).length - 1;

describe("fixture laws, on every non-empty Comment Text cell", () => {
  it("reads cells from all six HTML fixtures", () => {
    expect(new Set(cells.map((c) => c.fixture)).size).toBe(6);
    expect(cells.length).toBeGreaterThan(2000);
  });

  it("replay: applyCuts(input, cuts) === html", () => {
    for (const { text } of cells) {
      const { html, cuts } = sanitiseCommentHtml(text);
      expect(applyCuts(text, cuts)).toBe(html);
    }
  });

  it("honest log: removedText is the input span, cuts sorted and non-overlapping", () => {
    for (const { text } of cells) {
      const { cuts } = sanitiseCommentHtml(text);
      let previousEnd = 0;
      for (const cut of cuts) {
        expect(cut.removedText).toBe(text.slice(cut.start, cut.end));
        expect(cut.start).toBeGreaterThanOrEqual(previousEnd);
        expect(cut.end).toBeGreaterThan(cut.start);
        previousEnd = cut.end;
      }
    }
  });

  it("idempotence: sanitising the output again changes nothing", () => {
    for (const { text } of cells) {
      const once = sanitiseCommentHtml(text).html;
      expect(sanitiseCommentHtml(once)).toEqual({ html: once, cuts: [] });
    }
  });

  it("whitespace untouched: CR, LF, U+00A0 and &nbsp; counts match, less those inside cuts", () => {
    for (const { text } of cells) {
      const { html, cuts } = sanitiseCommentHtml(text);
      for (const needle of ["\r", "\n", " ", "&nbsp;"]) {
        const removed = cuts.reduce((n, c) => n + count(c.removedText, needle) - count(c.replacement ?? "", needle), 0);
        expect(count(html, needle)).toBe(count(text, needle) - removed);
      }
    }
  });

  it("Ben row 12's data-testid and data-mesh-id are removed as editor-leftover", () => {
    const row12 = cells.find((cell) => cell.fixture.startsWith("Ben") && cell.row === 12);
    expect(row12).toBeDefined();
    if (!row12) return;
    const { html, cuts } = sanitiseCommentHtml(row12.text);
    const leftovers = cuts.filter((c) => c.kind === "editor-leftover").map((c) => c.context.attribute);
    expect(leftovers).toContain("data-testid");
    expect(leftovers).toContain("data-mesh-id");
    expect(html).not.toMatch(/data-testid|data-mesh-id/);
  });

  it("fr-original-style, contenteditable and draggable are removed as editor-leftover wherever they appear", () => {
    for (const attribute of ["fr-original-style", "contenteditable", "draggable"]) {
      const withIt = cells.filter((c) => c.text.includes(`${attribute}=`));
      expect(withIt.length).toBeGreaterThan(0);
      for (const { text } of withIt) {
        const { html, cuts } = sanitiseCommentHtml(text);
        expect(html).not.toContain(`${attribute}=`);
        expect(cuts.filter((c) => c.context.attribute === attribute).length).toBe(count(text, ` ${attribute}=`));
        for (const cut of cuts.filter((c) => c.context.attribute === attribute)) expect(cut.kind).toBe("editor-leftover");
      }
    }
  });
});

describe("attributes", () => {
  it("returns the empty string unchanged", () => {
    expect(sanitiseCommentHtml("")).toEqual({ html: "", cuts: [] });
  });

  it("leaves plain text containing &amp; as it is", () => {
    const text = "Knob &amp; Tube wiring";
    expect(sanitiseCommentHtml(text)).toEqual({ html: text, cuts: [] });
  });

  it("removes class, draggable, contenteditable, fr-original-style and data-* as editor-leftover, naming them", () => {
    const input = '<p class="x" draggable="true" contenteditable="false" fr-original-style="" data-foo="1">Hi</p>';
    const { html, cuts } = sanitiseCommentHtml(input);
    expect(html).toBe("<p>Hi</p>");
    expect(cuts.map((c) => [c.kind, c.context.tag, c.context.attribute])).toEqual([
      ["editor-leftover", "p", "class"],
      ["editor-leftover", "p", "draggable"],
      ["editor-leftover", "p", "contenteditable"],
      ["editor-leftover", "p", "fr-original-style"],
      ["editor-leftover", "p", "data-foo"],
    ]);
  });

  it("removes event handlers and other non-allowlisted attributes as attribute-removed", () => {
    const input = '<img src="a.png" onerror="alert(1)"><p onclick="x()" id="p1" title="t">Hi</p>';
    const { html, cuts } = sanitiseCommentHtml(input);
    expect(html).toBe('<img src="a.png"><p>Hi</p>');
    expect(cuts.map((c) => [c.kind, c.context.tag, c.context.attribute])).toEqual([
      ["attribute-removed", "img", "onerror"],
      ["attribute-removed", "p", "onclick"],
      ["attribute-removed", "p", "id"],
      ["attribute-removed", "p", "title"],
    ]);
  });

  it("keeps allowlisted attributes exactly as written", () => {
    const input =
      '<a href="http://x.org"  target="_blank" rel="noopener" style="color: red;">x</a><ol start="3"><li>a</li></ol>' +
      '<img src="a.png" alt=a width="1" height=\'2\'><iframe src="https://www.youtube.com/embed/x" width="560" height="315" allowfullscreen=""></iframe>';
    expect(sanitiseCommentHtml(input)).toEqual({ html: input, cuts: [] });
  });

  it("keeps an attribute allowed on one element but not another", () => {
    expect(sanitiseCommentHtml('<p start="2" href="x">a</p>').cuts.map((c) => c.context.attribute)).toEqual(["start", "href"]);
  });

  it("handles unquoted values, odd spacing, newlines and a value containing >", () => {
    const input = '<p\nclass=x   onclick="a>b"\tstyle="color: red">t</p>';
    const { html, cuts } = sanitiseCommentHtml(input);
    expect(html).toBe('<p\tstyle="color: red">t</p>');
    expect(cuts).toHaveLength(2);
    expect(sanitiseCommentHtml(html).cuts).toEqual([]);
  });

  it("removes duplicate attributes too, so a second handler can't come alive once the first is cut", () => {
    const input = `<p onclick="a" ONCLICK='b' class=c class=d>t</p><a href="x" href=y>l</a><p id="1"id="2"/title>u</p>`;
    const { html, cuts } = sanitiseCommentHtml(input);
    expect(html).toBe('<p>t</p><a href="x">l</a><p/>u</p>');
    expect(cuts.map((c) => [c.kind, c.context.attribute])).toEqual([
      ["attribute-removed", "onclick"],
      ["attribute-removed", "onclick"],
      ["editor-leftover", "class"],
      ["editor-leftover", "class"],
      ["attribute-removed", "href"],
      ["attribute-removed", "id"],
      ["attribute-removed", "id"],
      ["attribute-removed", "title"],
    ]);
    expect(applyCuts(input, cuts)).toBe(html);
    expect(sanitiseCommentHtml(html).cuts).toEqual([]);
  });

  it("cuts a whole attribute written with no space after the one before it", () => {
    expect(sanitiseCommentHtml('<a href="x"onclick="y()">l</a>').html).toBe('<a href="x">l</a>');
  });

  it("keeps the separator when a removed attribute is jammed against a kept one", () => {
    const inputs = [
      '<p onclick="x"style="color: red">t</p>',
      '<p class="x"style="color: red">t</p>',
      '<p onclick="x"id="a b"style="color: red">t</p>',
    ];
    for (const input of inputs) {
      const { html } = sanitiseCommentHtml(input);
      expect(html).toBe('<p style="color: red">t</p>');
      expect(sanitiseCommentHtml(html).cuts).toEqual([]);
    }
  });

  it("finds mixed-case attribute names", () => {
    const { cuts } = sanitiseCommentHtml('<p OnClick="x" DATA-X="y">t</p>');
    expect(cuts.map((cut) => [cut.kind, cut.context.attribute])).toEqual([
      ["attribute-removed", "onclick"],
      ["editor-leftover", "data-x"],
    ]);
  });
});

describe("disallowed tags", () => {
  const disallowedTag = /<\/?(?!(?:p|br|strong|b|em|i|u|s|sub|sup|ul|ol|li|h[1-6]|span|div|blockquote|hr|pre|code|table|thead|tbody|tr|th|td|a|img|iframe)[\s/>])[a-z]/i;

  const expectSoundLog = (input: string) => {
    const { html, cuts } = sanitiseCommentHtml(input);
    let previousEnd = 0;
    for (const cut of cuts) {
      expect(cut.removedText).toBe(input.slice(cut.start, cut.end));
      expect(cut.start).toBeGreaterThanOrEqual(previousEnd);
      previousEnd = cut.end;
    }
    expect(applyCuts(input, cuts)).toBe(html);
    expect(html).not.toMatch(disallowedTag);
    expect(sanitiseCommentHtml(html)).toEqual({ html, cuts: [] });
    return { html, cuts };
  };

  it("removes <script> and <style> with their content, one tag-removed cut each", () => {
    const input = "<p>a</p><script>alert(1)</script><p>b<style>p { color: red }</style></p>";
    const { html, cuts } = expectSoundLog(input);
    expect(html).toBe("<p>a</p><p>b</p>");
    expect(cuts.map((c) => [c.kind, c.context.tag, c.removedText])).toEqual([
      ["tag-removed", "script", "<script>alert(1)</script>"],
      ["tag-removed", "style", "<style>p { color: red }</style>"],
    ]);
  });

  it("removes form elements, objects and embeds with their content", () => {
    const { html, cuts } = expectSoundLog(
      '<p>a</p><form action="x"><input name="n"><button>Go</button><select><option>o</option></select><textarea>t</textarea></form>' +
        '<object data="x.swf"><param name="p" value="v">fallback</object><embed src="x.swf"><p>b</p>',
    );
    expect(html).toBe("<p>a</p><p>b</p>");
    expect(cuts.map((c) => [c.kind, c.context.tag])).toEqual([
      ["tag-removed", "form"],
      ["tag-removed", "object"],
      ["tag-removed", "embed"],
    ]);
  });

  it("removes a lone form control outside a form", () => {
    const { html, cuts } = expectSoundLog('<p>a<input type="text" value="v">b<button onclick="x()">c</button></p>');
    expect(html).toBe("<p>ab</p>");
    expect(cuts.map((c) => [c.kind, c.context.tag])).toEqual([
      ["tag-removed", "input"],
      ["tag-removed", "button"],
    ]);
  });

  it("removes raw-text elements whole, so their text never comes alive as markup", () => {
    for (const tag of ["xmp", "noscript", "noembed", "noframes", "textarea", "title"]) {
      const { html, cuts } = expectSoundLog(`<p>a</p><${tag}><img src=x onerror=alert(1)></${tag}><p>b</p>`);
      expect(html).toBe("<p>a</p><p>b</p>");
      expect(cuts.map((c) => [c.kind, c.context.tag])).toEqual([["tag-removed", tag]]);
    }
  });

  it("unwraps <font>, cutting its opening and closing tags and keeping its text", () => {
    const input = '<p>Keep <font color="red" face="Arial">these words</font> here</p>';
    const { html, cuts } = expectSoundLog(input);
    expect(html).toBe("<p>Keep these words here</p>");
    expect(cuts.map((c) => [c.kind, c.context.tag, c.removedText])).toEqual([
      ["tag-unwrapped", "font", '<font color="red" face="Arial">'],
      ["tag-unwrapped", "font", "</font>"],
    ]);
  });

  it("unwraps other unknown tags, void ones included", () => {
    const { html } = expectSoundLog("<center>a<section>b<o:p>c</o:p></section><wbr>d<custom-tag>e</custom-tag></center>");
    expect(html).toBe("abcde");
  });

  it("still cuts attributes on allowed elements inside an unwrapped one", () => {
    const { html, cuts } = expectSoundLog('<font><p onclick="x()">a</p></font>');
    expect(html).toBe("<p>a</p>");
    expect(cuts.map((c) => c.kind)).toEqual(["tag-unwrapped", "attribute-removed", "tag-unwrapped"]);
  });

  it("removes a template with its content, which is never displayed", () => {
    const { html, cuts } = expectSoundLog('<p>a</p><template><tr onclick="x()"><td>b</td></tr></template>');
    expect(html).toBe("<p>a</p>");
    expect(cuts.map((c) => [c.kind, c.context.tag])).toEqual([["tag-removed", "template"]]);
  });

  it("unwraps SVG and MathML, and unwraps their look-alikes of allowed tags", () => {
    const { html } = expectSoundLog('<svg><a href="x"><text>t</text></a></svg><math><mi>m</mi></math>');
    expect(html).toBe("tm");
  });

  it("gives a replayable, non-overlapping log for unclosed and implicitly closed tags", () => {
    const inputs = [
      "<p><font>a</p>b</font>c",
      "<font>a<p>b</font>c</p>",
      "<p>a<font>b",
      "<form><p>x",
      "<p>a<script>b",
      "<b>1<font>2<p>3</b>4</font>5</p>",
      "<table><font>x</font><tr><td>y</td></tr></table>",
      "<table><form><tr><td>y</td></tr></form></table>",
      "<font><script>x</script></font><font>",
      "<br><form><font>",
    ];
    for (const input of inputs) expectSoundLog(input);
  });

  it("cuts tags the parser ignored, so they can't come alive somewhere else", () => {
    const cases: [string, string, string[]][] = [
      ["<p>a</font>b</p>", "<p>ab</p>", ["font"]],
      ["<p>a<body onload=alert(1)>b</p>", "<p>ab</p>", ["body"]],
      ["<html><head>a", "a", ["html", "head"]],
      ["<tr onclick=alert(1)><td>a</td></tr>", "a</td></tr>", ["tr", "td"]],
      ["<p>a<font", "<p>a", ["font"]],
    ];
    for (const [input, output, tags] of cases) {
      const { html, cuts } = expectSoundLog(input);
      expect(html).toBe(output);
      expect(cuts.map((c) => [c.kind, c.context.tag])).toEqual(tags.map((tag) => ["tag-unwrapped", tag]));
    }
  });

  it("keeps stray end tags of allowed elements, which the parser can still act on", () => {
    for (const input of ["a</p>b</br>c", "<p><b>1</p>2</b>3"]) {
      expect(sanitiseCommentHtml(input)).toEqual({ html: input, cuts: [] });
    }
  });

  it("leaves an iframe's raw text alone", () => {
    const input = '<iframe src="https://www.youtube.com/embed/x"><font>x</font></iframe>';
    expect(sanitiseCommentHtml(input)).toEqual({ html: input, cuts: [] });
  });

  it("never glues a literal < onto the text after a cut to make a new tag", () => {
    const cases: [string, string][] = [
      ["<<script>x</script>img src=x onerror=alert(1)>", "img src=x onerror=alert(1)>"],
      ["a <<<font>b", "a b"],
      ["<<caption>/p>", "/p>"],
      ["a < <font>b", "a < b"],
    ];
    for (const [input, output] of cases) expect(expectSoundLog(input).html).toBe(output);
  });

  it("stays within the input when a comment runs to its end", () => {
    expectSoundLog("<mi><template></font><!--");
  });

  it("treats an iframe inside SVG as markup, not raw text", () => {
    expect(expectSoundLog("<svg><iframe></script>a</iframe></svg>").html).toBe("a");
  });

  it("keeps the log sound on generated tag soup", () => {
    const parts = [
      "<p>", "</p>", "<b>", "</b>", "<font>", "</font>", "<script>", "</script>", "<table>", "<tr>", "<td>", "</td>",
      "</table>", "<form>", "</form>", "x", " ", "<", "</", "<svg>", "</svg>", "<math>", "<mi>", "<a href=x>", "</a>",
      "<body onload=1>", "<xmp>", "</xmp>", "<template>", "</template>", "<li>", "<div class=c>", "</div>", "<br>",
      "</br>", "<i>", "</i>", "<font", '"', '="', "<textarea>", "<!--", "-->", "<select>", "<option>", "<caption>",
      "<col>", "<noscript>", "<style>", "<iframe>", "</iframe>", "<plaintext>", "<object>", "img src=x onerror=1>",
    ];
    let seed = 1;
    const random = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    for (let n = 0; n < 3000; n++) {
      let input = "";
      for (let k = 1 + Math.floor(random() * 12); k > 0; k--) input += parts[Math.floor(random() * parts.length)];
      const { html, cuts } = sanitiseCommentHtml(input);
      expect(applyCuts(input, cuts)).toBe(html);
      expect(sanitiseCommentHtml(html).cuts, JSON.stringify(input)).toEqual([]);
    }
  });

  it("never turns a disallowed tag into visible text", () => {
    const { html } = expectSoundLog("<p>a<font>b</font><script>c</script></p>");
    expect(html).not.toContain("&lt;");
    expect(html).toBe("<p>ab</p>");
  });
});

describe("applyCuts", () => {
  it("applies replacements", () => {
    expect(applyCuts("abcdef", [{ start: 1, end: 3, kind: "tag-unwrapped", removedText: "bc", replacement: "X", context: { tag: "p" } }])).toBe("aXdef");
  });

  it("refuses overlapping or out-of-range cuts", () => {
    const cut = (start: number, end: number): Cut => ({ start, end, kind: "editor-leftover", removedText: "", context: { tag: "p" } });
    expect(() => applyCuts("abcdef", [cut(0, 3), cut(2, 4)])).toThrow(RangeError);
    expect(() => applyCuts("abc", [cut(2, 5)])).toThrow(RangeError);
  });
});

describe("allowlist", () => {
  it("is exported as plain data", () => {
    expect(allowlist.tags).toContain("iframe");
    expect(allowlist.attributes.a).toEqual(["href", "target", "rel"]);
    expect(allowlist.urlSchemes).toEqual(["http", "https", "mailto", "tel"]);
    expect(allowlist.styleProperties).toContain("margin-left");
    expect(JSON.parse(JSON.stringify(allowlist))).toEqual(allowlist);
  });
});
