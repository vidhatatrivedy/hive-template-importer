-- Issue kinds core writes that earlier checks left out, so import_issues_kind_check matches issueKinds.
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
    'vocabulary-normalised',
    'boolean-default-normalised',
    'boolean-default-invalid',
    'comment-type-fallback',
    'answer-type-fallback',
    'category-missing',
    'category-orphan',
    'blank-name',
    'checkbox-default-not-in-options',
    'empty-option-dropped',
    'options-orphan',
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
