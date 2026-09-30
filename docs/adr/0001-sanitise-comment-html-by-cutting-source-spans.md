# Sanitise comment HTML by cutting spans from the source, never re-serialising

A Comment stores its sanitised HTML, and the original `Comment Text` cell is kept unchanged beside it, tied to its Source row. Stored text must equal the source apart from the changes that are logged, because the Trust Report and the round-trip preservation test both depend on it. So the sanitiser is a small custom pass over parse5. parse5 records where every tag and attribute sits in the original string. The pass cuts, unwraps or replaces those spans *of the original string* and logs each edit as it makes it, so every change is logged by construction. The output is then parsed again and checked against the allowlist. If malformed input makes the cuts unreliable, the pass rebuilds the whole fragment instead and logs that it did. The same function runs in the editor's live preview and on the server, and the server's result is the one that counts. When a Comment is shown, the browser runs it through DOMPurify with the same allowlist as a second layer of protection. That output is never stored.

## Considered Options

Measured on 2,823 non-empty Comment Text cells across the five HTML fixtures (Rich content policy for comment HTML, issue #10):

- **DOMPurify + jsdom** re-serialises the whole fragment. Only 982 cells came back identical. It writes every U+00A0 as `&nbsp;` (1,550 cells), turns CRLF into LF, and doesn't list a dropped `<script>` among its removals. Undoing those rewrites afterwards can't tell a `&nbsp;` in the source from one DOMPurify created. On the server it also depends on jsdom, which failed to load on Node 22.9.
- **xss (js-xss)** came back identical for 2,770 cells. It still reformats every kept `style` value and `allowfullscreen=""` without logging either. By default it turns disallowed tags, `<script>` included, into visible text, and it empties `javascript:` links without logging it. Stripping disallowed tags instead turns off its logging callback. Its tokenizer is not the browser's.
- **Store raw and sanitise only when showing it.** Rejected: imported and edited text would follow different rules, and every place that shows a Comment would have to sanitise.

## Consequences

- The sanitiser is security-critical code we own. It's tested against all six fixtures and a set of known attack strings, and a test checks that DOMPurify at render removes nothing from any fixture Comment.
- Whitespace, CRLF, U+00A0 and spacer paragraphs are never touched, so they never show up as changes.
