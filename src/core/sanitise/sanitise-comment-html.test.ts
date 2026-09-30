import { beforeAll, describe, expect, it } from "vitest";
import { allCommentTexts, type FixtureCell } from "@/core/test/fixture-comment-texts";
import { allowlist, allowlistViolations, applyCuts, sanitiseCommentHtml, type Cut } from "@/core/sanitise";

let cells: FixtureCell[];
beforeAll(async () => {
  cells = await allCommentTexts();
});

/** Measured when the self-check landed (#27); a change here means sanitising changed on real data. */
const PINNED_IDENTICAL: Record<string, number> = {
  "Ben Gromicko's Template for Home Inspections-2026-09-30.xls": 1188,
  "InterNACHI Commercial Template-2026-09-30.xls": 319,
  "InterNACHI Residential -2026-09-30.xls": 308,
  "Radon Inspection-2026-09-30.xls": 1,
  "Residential Template-2026-09-30.xls": 308,
  "Room-by-Room Residential Template-2026-09-30.xls": 651,
};

const count = (text: string, needle: string) => text.split(needle).length - 1;

/** removedText matches the source span, and cuts are sorted, non-empty and non-overlapping. */
function expectHonestLog(input: string, cuts: readonly Cut[]) {
  let previousEnd = 0;
  for (const cut of cuts) {
    expect(cut.removedText).toBe(input.slice(cut.start, cut.end));
    expect(cut.start).toBeGreaterThanOrEqual(previousEnd);
    expect(cut.end).toBeGreaterThan(cut.start);
    previousEnd = cut.end;
  }
}

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
    for (const { text } of cells) expectHonestLog(text, sanitiseCommentHtml(text).cuts);
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

  it("allowlist: re-parsing the output finds only allowlisted content", () => {
    for (const { fixture, row, text } of cells) {
      expect(allowlistViolations(sanitiseCommentHtml(text).html), `${fixture} row ${row}`).toEqual([]);
    }
  });

  it("no cell needs a tag removed, a link scheme removed or its markup rebuilt", () => {
    const kinds = new Set(cells.flatMap(({ text }) => sanitiseCommentHtml(text).cuts.map((cut) => cut.kind)));
    for (const kind of ["tag-removed", "link-scheme-removed", "markup-rebuilt"] as const) expect(kinds).not.toContain(kind);
  });

  it("pins the number of byte-identical cells per fixture", () => {
    const identical: Record<string, number> = {};
    for (const { fixture, text } of cells) {
      identical[fixture] ??= 0;
      if (sanitiseCommentHtml(text).html === text) identical[fixture]++;
    }
    expect(identical).toEqual(PINNED_IDENTICAL);
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
  const disallowedTag = new RegExp(`</?(?!(?:${allowlist.tags.join("|")})[\\s/>])[a-z]`, "i");

  /** Honest log, replay, no disallowed tag left, and a second pass that changes nothing. */
  const expectCutLaws = (input: string) => {
    const { html, cuts } = sanitiseCommentHtml(input);
    expectHonestLog(input, cuts);
    expect(applyCuts(input, cuts)).toBe(html);
    expect(html).not.toMatch(disallowedTag);
    expect(sanitiseCommentHtml(html)).toEqual({ html, cuts: [] });
    return { html, cuts };
  };

  it("removes <script> and <style> with their content, one tag-removed cut each", () => {
    const input = "<p>a</p><script>alert(1)</script><p>b<style>p { color: red }</style></p>";
    const { html, cuts } = expectCutLaws(input);
    expect(html).toBe("<p>a</p><p>b</p>");
    expect(cuts.map((c) => [c.kind, c.context.tag, c.removedText])).toEqual([
      ["tag-removed", "script", "<script>alert(1)</script>"],
      ["tag-removed", "style", "<style>p { color: red }</style>"],
    ]);
  });

  it("removes form elements, objects and embeds with their content", () => {
    const { html, cuts } = expectCutLaws(
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
    const { html, cuts } = expectCutLaws('<p>a<input type="text" value="v">b<button onclick="x()">c</button></p>');
    expect(html).toBe("<p>ab</p>");
    expect(cuts.map((c) => [c.kind, c.context.tag])).toEqual([
      ["tag-removed", "input"],
      ["tag-removed", "button"],
    ]);
  });

  it("removes raw-text elements whole, so their text never comes alive as markup", () => {
    for (const tag of ["xmp", "noscript", "noembed", "noframes", "textarea", "title"]) {
      const { html, cuts } = expectCutLaws(`<p>a</p><${tag}><img src=x onerror=alert(1)></${tag}><p>b</p>`);
      expect(html).toBe("<p>a</p><p>b</p>");
      expect(cuts.map((c) => [c.kind, c.context.tag])).toEqual([["tag-removed", tag]]);
    }
  });

  it("unwraps <font>, cutting its opening and closing tags and keeping its text", () => {
    const input = '<p>Keep <font color="red" face="Arial">these words</font> here</p>';
    const { html, cuts } = expectCutLaws(input);
    expect(html).toBe("<p>Keep these words here</p>");
    expect(cuts.map((c) => [c.kind, c.context.tag, c.removedText])).toEqual([
      ["tag-unwrapped", "font", '<font color="red" face="Arial">'],
      ["tag-unwrapped", "font", "</font>"],
    ]);
  });

  it("unwraps other unknown tags, void ones included", () => {
    const { html } = expectCutLaws("<center>a<section>b<o:p>c</o:p></section><wbr>d<custom-tag>e</custom-tag></center>");
    expect(html).toBe("abcde");
  });

  it("still cuts attributes on allowed elements inside an unwrapped one", () => {
    const { html, cuts } = expectCutLaws('<font><p onclick="x()">a</p></font>');
    expect(html).toBe("<p>a</p>");
    expect(cuts.map((c) => c.kind)).toEqual(["tag-unwrapped", "attribute-removed", "tag-unwrapped"]);
  });

  it("removes a template with its content, which is never displayed", () => {
    const { html, cuts } = expectCutLaws('<p>a</p><template><tr onclick="x()"><td>b</td></tr></template>');
    expect(html).toBe("<p>a</p>");
    expect(cuts.map((c) => [c.kind, c.context.tag])).toEqual([["tag-removed", "template"]]);
  });

  it("unwraps SVG and MathML, and unwraps their look-alikes of allowed tags", () => {
    const { html } = expectCutLaws('<svg><a href="x"><text>t</text></a></svg><math><mi>m</mi></math>');
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
    for (const input of inputs) expectCutLaws(input);
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
      const { html, cuts } = expectCutLaws(input);
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
    for (const [input, output] of cases) expect(expectCutLaws(input).html).toBe(output);
  });

  it("stays within the input when a comment runs to its end", () => {
    expectCutLaws("<mi><template></font><!--");
  });

  it("treats an iframe inside SVG as markup, not raw text", () => {
    expect(expectCutLaws("<svg><iframe></script>a</iframe></svg>").html).toBe("a");
  });

  it("keeps the log sound on generated tag soup", () => {
    const parts = [
      "<p>", "</p>", "<b>", "</b>", "<font>", "</font>", "<script>", "</script>", "<table>", "<tr>", "<td>", "</td>",
      "</table>", "<form>", "</form>", "x", " ", "<", "</", "<svg>", "</svg>", "<math>", "<mi>", "<a href=x>", "</a>",
      "<body onload=1>", "<xmp>", "</xmp>", "<template>", "</template>", "<li>", "<div class=c>", "</div>", "<br>",
      "</br>", "<i>", "</i>", "<font", '"', '="', "<textarea>", "<!--", "-->", "<select>", "<option>", "<caption>",
      "<col>", "<noscript>", "<style>", "<iframe>", "</iframe>", "<plaintext>", "<object>", "img src=x onerror=1>",
      "<iframe src=https://x.example/>", "<iframe src=javascript:1>", "<a href=javascript:1>", "<img src=data:x>",
      '<div class="youtube-embed-wrapper" style="height:0">',
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
    const { html } = expectCutLaws("<p>a<font>b</font><script>c</script></p>");
    expect(html).not.toContain("&lt;");
    expect(html).toBe("<p>ab</p>");
  });
});

describe("inline styles", () => {
  /** Honest log, replay, and a second pass that changes nothing. */
  const expectStyleLaws = (input: string) => {
    const { html, cuts } = sanitiseCommentHtml(input);
    expectHonestLog(input, cuts);
    expect(applyCuts(input, cuts)).toBe(html);
    expect(sanitiseCommentHtml(html)).toEqual({ html, cuts: [] });
    return { html, cuts };
  };
  const described = (cuts: readonly Cut[]) => cuts.map((c) => [c.kind, c.context.tag, c.context.property, c.removedText]);

  it("keeps every allowlisted property exactly as written", () => {
    const input =
      '<img src="a.png" style="width: 200px;display:block; vertical-align: top;margin: 5px auto 5px 0px;max-width: calc(100% - 5px);' +
      ' text-align: left; float: left; clear: both"><span style="COLOR: inherit; background-color: initial; font-size: 12px !important">t</span>';
    expect(sanitiseCommentHtml(input)).toEqual({ html: input, cuts: [] });
  });

  it("cuts only a disallowed declaration, keeping the rest byte for byte", () => {
    const { html, cuts } = expectStyleLaws('<p style="color: red; position: fixed; font-weight:bold">t</p>');
    expect(html).toBe('<p style="color: red; font-weight:bold">t</p>');
    expect(described(cuts)).toEqual([["css-property-removed", "p", "position", "position: fixed; "]]);
    expect(cuts[0].context.attribute).toBe("style");
  });

  it("cuts a trailing disallowed declaration with the separator before it", () => {
    const { html, cuts } = expectStyleLaws('<p style="color: red; position: fixed; z-index: 9;">t</p>');
    expect(html).toBe('<p style="color: red">t</p>');
    expect(described(cuts)).toEqual([
      ["css-property-removed", "p", "position", "; position: fixed"],
      ["css-property-removed", "p", "z-index", "; z-index: 9;"],
    ]);
  });

  it("removes a declaration whose value loads remote content or runs code, marking it unsafe", () => {
    const values = [
      "url(https://x.org/a.png)",
      "URL('x')",
      "u\\72l(x)",
      "\\75 rl(x)",
      "expression(alert(1))",
      "eXpReSsIoN (alert(1))",
      "ex/**/pression(alert(1))",
      "url\\28x)",
      "url\\28 x)",
      "url\\000028x)",
      "expression\\28 alert(1))",
      "expression\\000028alert(1))",
      "eXpReSsIoN\\28\\61lert(1))",
      "red @IMPORT 'x'",
    ];
    for (const value of values) {
      const input = `<p style="color: blue; background-color: ${value}">t</p>`;
      const { html, cuts } = expectStyleLaws(input);
      expect(html, input).toBe('<p style="color: blue">t</p>');
      const unsafe = cuts.filter((c) => c.context.unsafeValue);
      expect(unsafe.length, input).toBeGreaterThan(0);
      for (const cut of cuts) expect(cut.kind).toBe("css-property-removed");
    }
  });

  it("marks only dangerous values as unsafe, so they can be told from routine removals", () => {
    const { cuts } = expectStyleLaws('<p style="position: fixed; color: url(x)">t</p>');
    expect(cuts.map((c) => [c.context.property, c.context.unsafeValue ?? false])).toEqual([
      ["position", false],
      ["color", true],
    ]);
  });

  it("sees through character references in the attribute value", () => {
    const cases: [string, string, string[]][] = [
      ['<p style="color:red&semi;position:fixed">t</p>', '<p style="color:red">t</p>', ["position"]],
      ['<p style="color:u&#114;l(x);font-weight:bold">t</p>', '<p style="font-weight:bold">t</p>', ["color"]],
      ['<p style="color:url&lpar;x)">t</p>', "<p>t</p>", ["color"]],
      ['<p style="font-size: 12px; font-family: &quot;Arial&quot;; color: red">t</p>', '<p style="font-size: 12px; color: red">t</p>', ["font-family"]],
    ];
    for (const [input, output, properties] of cases) {
      const { html, cuts } = expectStyleLaws(input);
      expect(html, input).toBe(output);
      expect(cuts.map((c) => c.context.property)).toEqual(properties);
    }
  });

  it("keeps an escaped semicolon inside the declaration it belongs to", () => {
    const input = '<p style="color: red\\3b position: fixed">t</p>';
    expect(sanitiseCommentHtml(input)).toEqual({ html: input, cuts: [] });
  });

  it("reads escaped and commented property names as the browser does", () => {
    const { html, cuts } = expectStyleLaws('<p style="/* x */position: fixed; \\63olor: red">t</p>');
    expect(html).toBe('<p style="\\63olor: red">t</p>');
    expect(cuts.map((c) => c.context.property)).toEqual(["position"]);
  });

  it("removes the whole attribute when every declaration goes, one cut per declaration", () => {
    const { html, cuts } = expectStyleLaws(
      '<div class="box" style="position: relative; padding-bottom: 56.25%; overflow: hidden"></div>',
    );
    expect(html).toBe("<div></div>");
    expect(cuts.map((c) => [c.kind, c.context.property])).toEqual([
      ["editor-leftover", undefined],
      ["css-property-removed", "position"],
      ["css-property-removed", "padding-bottom"],
      ["css-property-removed", "overflow"],
    ]);
  });

  it("keeps the separator when a removed style is jammed against a kept attribute", () => {
    expect(expectStyleLaws('<img style="position:fixed"src="a.png">').html).toBe('<img src="a.png">');
    expect(expectStyleLaws("<img src=a.png style=position:fixed>").html).toBe("<img src=a.png>");
  });

  it("removes a style that can't be parsed whole, as style-unparseable", () => {
    const inputs = [
      '<p style="color: red; } body { color: blue">t</p>',
      '<p style="color: red; font-weight">t</p>',
      "<p style=\"color: red; content: 'unclosed\">t</p>",
      '<p style="color: red /* unclosed">t</p>',
      '<p style="color: rgb(1, 2, 3">t</p>',
      '<p style="color: red)">t</p>',
      "<p style=\"color: red; @import 'x'\">t</p>",
    ];
    for (const input of inputs) {
      const { html, cuts } = expectStyleLaws(input);
      expect(html, input).toBe("<p>t</p>");
      expect(cuts.map((c) => [c.kind, c.context.tag, c.context.attribute])).toEqual([["style-unparseable", "p", "style"]]);
    }
  });

  it("leaves empty styles and stray separators alone", () => {
    for (const input of ['<p style="">t</p>', "<p style>t</p>", '<p style="color: red;;">t</p>', '<p style=" ; ">t</p>']) {
      expect(sanitiseCommentHtml(input)).toEqual({ html: input, cuts: [] });
    }
  });

  it("keeps the log sound on generated style values", () => {
    const parts = [
      "color", "position", ":", ";", " ", "red", "url(x)", "(", ")", "/*", "*/", "'", '"', "&quot;", "&semi;", "&amp;",
      "&#59;", "&lpar;", "\\", "\\3b ", "{", "margin-left", "expression(", "@import", "\n", "&", "=", "&amp=",
    ];
    let seed = 7;
    const random = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    for (let n = 0; n < 3000; n++) {
      let value = "";
      for (let k = 1 + Math.floor(random() * 10); k > 0; k--) value += parts[Math.floor(random() * parts.length)];
      const input = `<p style="${value.replaceAll('"', "&quot;")}" title=x>t</p>`;
      const { html, cuts } = sanitiseCommentHtml(input);
      expectHonestLog(input, cuts);
      expect(applyCuts(input, cuts)).toBe(html);
      expect(sanitiseCommentHtml(html).cuts, JSON.stringify(input)).toEqual([]);
    }
  });

  it("filters styles in single-quoted and unquoted values", () => {
    expect(expectStyleLaws("<p style='color: red; position: fixed'>t</p>").html).toBe("<p style='color: red'>t</p>");
    expect(expectStyleLaws("<p style=position:fixed;color:red>t</p>").html).toBe("<p style=color:red>t</p>");
  });
});

describe("URLs, images and iframes", () => {
  /** Honest log, replay, and a second pass that changes nothing. */
  const expectUrlLaws = (input: string) => {
    const { html, cuts } = sanitiseCommentHtml(input);
    expectHonestLog(input, cuts);
    expect(applyCuts(input, cuts)).toBe(html);
    expect(sanitiseCommentHtml(html)).toEqual({ html, cuts: [] });
    return { html, cuts };
  };

  it("removes only the href of a link with an unsafe scheme, keeping its text", () => {
    const hrefs = [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "vbscript:msgbox(1)",
      "&#106;avascript:alert(1)",
      "&#x6A;&#x61;vascript:alert(1)",
      "javascript&colon;alert(1)",
      "java&Tab;script:alert(1)",
      "java\nscript:alert(1)",
      " \u0001javascript:alert(1)",
      "file:///etc/passwd",
    ];
    for (const href of hrefs) {
      const input = `<p>See <a href="${href}" target="_blank">this</a></p>`;
      const { html, cuts } = expectUrlLaws(input);
      expect(html, input).toBe('<p>See <a target="_blank">this</a></p>');
      expect(cuts.map((c) => [c.kind, c.context.tag, c.context.attribute])).toEqual([["link-scheme-removed", "a", "href"]]);
    }
  });

  it("keeps http, https, mailto and tel links exactly as written, with no upgrade", () => {
    const input =
      '<a href="http://example.org/a?b=1&amp;c=2">x</a><a href=\'HTTPS://example.org\'>y</a>' +
      '<a href="mailto:me@example.org">m</a><a href="tel:+15555550100">t</a>';
    expect(sanitiseCommentHtml(input)).toEqual({ html: input, cuts: [] });
  });

  it("keeps relative and fragment hrefs, which resolve to the page's own scheme", () => {
    const input = '<a href="#top">a</a><a href="/path">b</a><a href="//example.org/x">c</a><a href="page?q=a:b">d</a><a href="">e</a>';
    expect(sanitiseCommentHtml(input)).toEqual({ html: input, cuts: [] });
  });

  it("applies the same scheme rule to an image's src", () => {
    const { html, cuts } = expectUrlLaws('<img src="javascript:alert(1)" alt="a"><img src="https://cdn.example.org/a.png">');
    expect(html).toBe('<img alt="a"><img src="https://cdn.example.org/a.png">');
    expect(cuts.map((c) => [c.kind, c.context.tag, c.context.attribute])).toEqual([["link-scheme-removed", "img", "src"]]);
  });

  it("keeps ol[start]", () => {
    const input = '<ol start="3"><li>c</li></ol>';
    expect(sanitiseCommentHtml(input)).toEqual({ html: input, cuts: [] });
  });

  it("keeps Ben's cdn.spectora.com images at their src", () => {
    const imageSources = (html: string) => [...html.matchAll(/<img[^>]*?\ssrc="([^"]*)"/g)].map((match) => match[1]);
    const withImages = cells.filter((cell) => cell.fixture.startsWith("Ben") && cell.text.includes("cdn.spectora.com"));
    expect(withImages.length).toBeGreaterThan(0);
    for (const { text } of withImages) {
      const { html, cuts } = sanitiseCommentHtml(text);
      expect(imageSources(html)).toEqual(imageSources(text));
      expect(cuts.filter((cut) => cut.context.attribute === "src")).toEqual([]);
    }
  });

  it("keeps Ben row 10's two YouTube iframes, allowfullscreen=\"\" included", () => {
    const row10 = cells.find((cell) => cell.fixture.startsWith("Ben") && cell.row === 10);
    expect(row10).toBeDefined();
    if (!row10) return;
    const { html, cuts } = sanitiseCommentHtml(row10.text);
    for (const id of ["_ErxoNiGyzI", "5pQpMt8_zx8"]) {
      expect(html).toContain(`<iframe width="560" height="315" src="https://www.youtube.com/embed/${id}" allowfullscreen="">`);
    }
    expect(cuts.filter((c) => c.kind === "iframe-to-link")).toEqual([]);
  });

  it("keeps YouTube and youtube-nocookie embeds byte for byte", () => {
    const input =
      '<iframe src="https://www.youtube.com/embed/abc?rel=0&amp;t=1" width=560 height="315" allowfullscreen></iframe>' +
      '<iframe src="https://www.youtube-nocookie.com/embed/abc"></iframe>';
    expect(sanitiseCommentHtml(input)).toEqual({ html: input, cuts: [] });
  });

  it("turns any other iframe into a link to its src", () => {
    const cases: [string, string][] = [
      ['<iframe src="https://example.org/page?a=1&amp;b=2" width="5"></iframe>', '<a href="https://example.org/page?a=1&amp;b=2">https://example.org/page?a=1&amp;b=2</a>'],
      ['<iframe src="https://www.youtube.com.evil.example/embed/x"></iframe>', '<a href="https://www.youtube.com.evil.example/embed/x">https://www.youtube.com.evil.example/embed/x</a>'],
      ['<iframe src="https://evil.example/?https://www.youtube.com/embed/x"></iframe>', '<a href="https://evil.example/?https://www.youtube.com/embed/x">https://evil.example/?https://www.youtube.com/embed/x</a>'],
      ['<iframe src="http://www.youtube.com/embed/x">fallback</iframe>', '<a href="http://www.youtube.com/embed/x">http://www.youtube.com/embed/x</a>'],
      ['<iframe src="https://www.youtube.com/watch?v=x"></iframe>', '<a href="https://www.youtube.com/watch?v=x">https://www.youtube.com/watch?v=x</a>'],
    ];
    for (const [input, replacement] of cases) {
      const { html, cuts } = expectUrlLaws(`<p>a</p>${input}<p>b</p>`);
      expect(html, input).toBe(`<p>a</p>${replacement}<p>b</p>`);
      expect(cuts.map((c) => [c.kind, c.context.tag, c.removedText, c.replacement])).toEqual([["iframe-to-link", "iframe", input, replacement]]);
    }
  });

  it("never makes a link with an unsafe scheme or live markup from an iframe's src", () => {
    const cases: [string, string][] = [
      ['<iframe src="javascript:alert(1)"></iframe>', "javascript:alert(1)"],
      ['<iframe src="https://x.example/&quot;&gt;&lt;script&gt;"></iframe>', '<a href="https://x.example/&quot;&gt;&lt;script&gt;">https://x.example/&quot;&gt;&lt;script&gt;</a>'],
      ["<iframe></iframe>", ""],
      ['<iframe src="https://x.example/a">', '<a href="https://x.example/a">https://x.example/a</a>'],
    ];
    for (const [input, output] of cases) {
      const { html, cuts } = expectUrlLaws(input);
      expect(html, input).toBe(output);
      expect(cuts.map((c) => c.kind)).toEqual(["iframe-to-link"]);
    }
  });

  it("collapses an empty YouTube wrapper, as youtube-wrapper-emptied rather than an editor leftover", () => {
    const input = '<p>a</p><div class="youtube-embed-wrapper" style="position:relative;padding-bottom:56.25%;height:0;"> </div>\n';
    const { html, cuts } = expectUrlLaws(input);
    expect(html).toBe("<p>a</p><div>\u00a0</div>\n");
    expect(cuts.map((c) => [c.kind, c.context.tag, c.removedText])).toEqual([
      ["youtube-wrapper-emptied", "div", ' class="youtube-embed-wrapper" style="position:relative;padding-bottom:56.25%;height:0;"'],
    ]);
  });

  it("filters a wrapper that still holds its video as any other div", () => {
    const input = '<div class="youtube-embed-wrapper" style="position:relative;width:100%"><iframe src="https://www.youtube.com/embed/x"></iframe></div>';
    const { html, cuts } = expectUrlLaws(input);
    expect(html).toBe('<div style="width:100%"><iframe src="https://www.youtube.com/embed/x"></iframe></div>');
    expect(cuts.map((c) => c.kind)).toEqual(["editor-leftover", "css-property-removed"]);
  });

  it("gives each of the 10 empty fixture wrappers one youtube-wrapper-emptied cut", () => {
    const rows = cells.flatMap((cell) =>
      sanitiseCommentHtml(cell.text)
        .cuts.filter((cut) => cut.kind === "youtube-wrapper-emptied")
        .map(() => cell.row),
    );
    expect(rows).toHaveLength(10);
    expect([...rows].sort((a, b) => a - b)).toEqual([209, 264, 311, 314, 318, 319, 374, 429, 484, 623]);
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

describe("self-check and rebuild", () => {
  it("survives lone surrogates, which the parser can't read as they are", () => {
    const input = "a\udc00\udc00<script>x</script>b\ud800";
    const { html, cuts } = sanitiseCommentHtml(input);
    expect(html).toBe("a\udc00\udc00b\ud800");
    expect(cuts.map((c) => c.kind)).toEqual(["tag-removed"]);
  });

  /** Unclosed tags nested deeper than a browser nests them (Chromium stops at 512). */
  const deep = (open: string, depth: number) => `${open.repeat(depth)}words<script>x</script>`;

  it("rebuilds markup nested too deep to trust, as one markup-rebuilt cut over the whole input", () => {
    for (const input of [deep("<font>", 600), deep("<div>", 600), deep("<b>", 20000)]) {
      const { html, cuts } = sanitiseCommentHtml(input);
      expect(cuts).toHaveLength(1);
      expect(cuts[0]).toMatchObject({ start: 0, end: input.length, kind: "markup-rebuilt", removedText: input, replacement: html });
      expect(allowlistViolations(html)).toEqual([]);
      expect(html).toContain("words");
      expect(html).not.toContain("script");
    }
  });

  it("rebuilt output replays and is left alone when sanitised again", () => {
    const input =
      '<p class="c" style="color:red;position:fixed" onclick="x">a &amp; b<a href="javascript:1">l</a>' +
      '<iframe src="https://x.example/?a&amp;b"></iframe><img src="https://cdn.spectora.com/i.png" alt="&quot;">\u00a0<pre>\n\nx</pre>' +
      `</p>${"<div>".repeat(700)}`;
    const { html, cuts } = sanitiseCommentHtml(input);
    expect(cuts.map((cut) => cut.kind)).toEqual(["markup-rebuilt"]);
    expect(applyCuts(input, cuts)).toBe(html);
    expect(sanitiseCommentHtml(html)).toEqual({ html, cuts: [] });
    expect(html).toContain('<p style="color:red">a &amp; b<a>l</a>');
    expect(html).toContain('<a href="https://x.example/?a&amp;b">https://x.example/?a&amp;b</a>');
    expect(html).toContain('<img src="https://cdn.spectora.com/i.png" alt="&quot;">\u00a0</p><pre>\n\nx</pre>');
  });

  it("keeps rebuilt markup within the depth a browser nests", () => {
    const iframes = '<iframe src="https://www.youtube.com/embed/x"></iframe><iframe src="https://x.example/"></iframe>';
    const { html } = sanitiseCommentHtml(deep("<div>", 5000) + iframes);
    expect(allowlistViolations(html)).toEqual([]);
    expect(html).toContain("https://x.example/");
    expect(html.split("<div>").length - 1).toBeLessThanOrEqual(512);
  });

  it("keeps the rebuild sound on generated tag soup", () => {
    const parts = [
      "<p>", "</p>", "<b onclick=1>", "</b>", "<font>", "</font>", "<script>", "</script>", "<table>", "<tr>", "<td>",
      "</table>", "x", " ", "&amp;", "&lt;", "<", "</", " ", "\n", "<pre>", "</pre>", "<svg>", "<math>", "<mi>",
      "<a href=x>", "</a>", "<a href=javascript:1>", "<li>", "<ol start=2>", "<div class=c>", "</div>", "<br>", "<!--",
      "-->", "<select>", "<style>", "<iframe src=https://www.youtube.com/embed/x>", "<iframe src=https://x.example/>",
      "</iframe>", '<p style="color:red;position:fixed">', "<p style='a:b;c'>", '<img src="x" alt="&quot;">',
      '<div class="youtube-embed-wrapper" style="height:0">',
    ];
    let seed = 7;
    const random = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    let rebuilds = 0;
    for (let n = 0; n < 300; n++) {
      let input = "";
      for (let k = 1 + Math.floor(random() * 12); k > 0; k--) input += parts[Math.floor(random() * parts.length)];
      input += "<div>".repeat(520);
      const { html, cuts } = sanitiseCommentHtml(input);
      if (cuts.some((cut) => cut.kind === "markup-rebuilt")) rebuilds++;
      expect(applyCuts(input, cuts)).toBe(html);
      expect(allowlistViolations(html), JSON.stringify(input)).toEqual([]);
      expect(sanitiseCommentHtml(html).cuts, JSON.stringify(input)).toEqual([]);
    }
    // The rest end inside a comment or an element whose content is text, so the nesting never happens.
    expect(rebuilds).toBeGreaterThan(100);
  });

  it("reports what isn't allowlisted, as the browser would parse it", () => {
    const cases: [string, number][] = [
      ['<p onclick="x">a</p>', 1],
      ["<font>a</font>", 1],
      ['<a href="jav&#x09;ascript:alert(1)">x</a>', 1],
      ['<p style="color:red;position:fixed">a</p>', 1],
      ['<iframe src="https://x.example/"></iframe>', 1],
      ['<p style="color:red" style="color:blue">a</p>', 1],
      ["<p>a<body onload=alert(1)>b</p>", 1],
      [deep("<div>", 600), 1],
      ['<p style="color:red">a</p></b><a href="https://x">b</a>', 0],
    ];
    for (const [html, expected] of cases) expect(allowlistViolations(html), html).toHaveLength(expected);
  });
});

describe("known attack strings", () => {
  const attacks = [
    // Mutation XSS and namespace confusion.
    "<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>",
    "<math><mi><mglyph><svg><mtext><textarea><path id=\"</textarea><img onerror=alert(1) src=1>\">",
    "<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>",
    "<svg><p><style><img src=x onerror=alert(1)>",
    "<svg></p><style><a id=\"</style><img src=1 onerror=alert(1)>\">",
    "<svg><foreignobject><img src=x onerror=alert(1)></foreignobject></svg>",
    "<math><annotation-xml encoding=\"text/html\"><img src=x onerror=alert(1)></annotation-xml></math>",
    "<svg><script>alert(1)</script></svg>",
    "<svg><a xlink:href=\"javascript:alert(1)\"><text>x</text></a></svg>",
    "<svg><animate onbegin=alert(1) attributeName=x dur=1s>",
    // <noscript> and <template> tricks.
    "<noscript><p title=\"</noscript><img src=x onerror=alert(1)>\">",
    "<template><img src=x onerror=alert(1)></template>",
    "<template><template><script>alert(1)</script></template></template>",
    // Nested and unclosed tags.
    "<scr<script>ipt>alert(1)</script>",
    "<<script>script>alert(1)<</script>/script>",
    "<img src=x onerror=alert(1)",
    "<a href=\"javascript:alert(1)\"",
    "<select><iframe></select><img src=x onerror=alert(1)>",
    "<table><td><iframe src=javascript:alert(1)></iframe>",
    "<b onclick=alert(1)><p>1</b>2",
    "<!--<img src=x onerror=alert(1)>-->",
    "<!-- --!><img src=x onerror=alert(1)> -->",
    "<xmp><img src=x onerror=alert(1)></xmp>",
    "<plaintext><img src=x onerror=alert(1)>",
    // Attribute breakouts.
    "<p title=\"a\"onclick=alert(1)>x</p>",
    "<p title='a'onmouseover=alert(1)>x</p>",
    "<img/src=\"x\"/onerror=alert(1)>",
    "<a/href=\"javascript:alert(1)\">x</a>",
    "<p =onclick=alert(1)>x</p>",
    "<p \"onclick=alert(1)>x</p>",
    "<img src=\"x\" alt=\"\"\" onerror=alert(1)>",
    "<a href=\"&#106;avascript:alert(1)\">x</a>",
    "<a href=\"java&Tab;script:alert(1)\">x</a>",
    "<a href=\" &#14; javascript:alert(1)\">x</a>",
    "<a href=\"JaVaScRiPt:alert(1)\">x</a>",
    "<a href=\"data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==\">x</a>",
    "<p style=\"background:url(javascript:alert(1))\">x</p>",
    "<p style=\"color:red;width:expression(alert(1))\">x</p>",
    "<p style=\"color:red\\3b background:u\\72l(x)\">x</p>",
    "<p style=\"@import 'x'\">x</p>",
    "<iframe src=\"https://www.youtube.com.evil.example/embed/x\"></iframe>",
    "<iframe srcdoc=\"<script>alert(1)</script>\" src=\"https://www.youtube.com/embed/x\"></iframe>",
    "<iframe src=\"https://www.youtube.com/embed/x\" onload=alert(1)></iframe>",
    "<body onload=alert(1)>",
    "<meta http-equiv=\"refresh\" content=\"0;url=javascript:alert(1)\">",
    "<base href=\"javascript:alert(1)//\">",
    "<object data=\"javascript:alert(1)\"></object><embed src=\"javascript:alert(1)\">",
    "<form action=\"javascript:alert(1)\"><button>x</button></form>",
    "<isindex action=javascript:alert(1) type=image>",
    "<image src=x onerror=alert(1)>",
  ];

  it("leaves nothing the allowlist doesn't permit, with an honest, replayable log", () => {
    for (const input of attacks) {
      const { html, cuts } = sanitiseCommentHtml(input);
      expectHonestLog(input, cuts);
      expect(applyCuts(input, cuts), input).toBe(html);
      expect(allowlistViolations(html), input).toEqual([]);
      expect(sanitiseCommentHtml(html), input).toEqual({ html, cuts: [] });
    }
  });

  it("are handled by cutting, without rebuilding the markup", () => {
    for (const input of attacks) {
      expect(sanitiseCommentHtml(input).cuts.map((cut) => cut.kind), input).not.toContain("markup-rebuilt");
    }
  });

  it("never leave an event handler, a script or a javascript: URL in a tag", () => {
    for (const input of attacks) {
      const withoutComments = sanitiseCommentHtml(input).html.replace(/<!--[\s\S]*?(?:--!?>|$)/g, "");
      const tags = withoutComments.match(/<[a-z][^>]*>?/gi) ?? [];
      for (const tag of tags) expect(tag, input).not.toMatch(/\son\w+=|javascript:|<script|srcdoc/i);
    }
  });
});
