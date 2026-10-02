-- boolean-default-normalised is an Import issue kind Ben's fixture writes.
alter table public.import_issues drop constraint import_issues_kind_check;

alter table public.import_issues
  add constraint import_issues_kind_check check (kind = any (array[
    'expected-column-missing',
    'unknown-column',
    'extra-sheet',
    'raw-only-content',
    'custom-estimates',
    'stock-estimates',
    'whitespace-trimmed',
    'boolean-default-normalised',
    'blank-name',
    'split-run',
    'duplicate-comment',
    'editor-leftovers',
    'attribute-removed',
    'tag-unwrapped',
    'style-unparseable',
    'tag-removed',
    'link-scheme-removed',
    'iframe-to-link',
    'markup-rebuilt',
    'youtube-wrapper-empty',
    'unsafe-style-removed'
  ]::text[]));
