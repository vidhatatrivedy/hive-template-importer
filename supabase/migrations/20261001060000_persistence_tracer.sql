-- Persistence tracer: tables, import/read/delete, and grants.
-- Vocabulary arrays match src/core (and versionOrigins in src/db) as of this migration.

create table public.import_runs (
  id uuid primary key default gen_random_uuid(),
  filename text not null,
  sha256 text not null,
  byte_size integer not null check (byte_size >= 0),
  sheet_name text not null,
  headers text[] not null,
  rows_read integer not null check (rows_read >= 0),
  blank_rows integer not null check (blank_rows >= 0),
  values_decoded integer not null check (values_decoded >= 0),
  created_at timestamptz not null default now()
);

create table public.source_rows (
  id uuid primary key default gen_random_uuid(),
  import_run_id uuid not null references public.import_runs (id),
  row_number integer not null check (row_number > 0),
  cells jsonb not null,
  unique (import_run_id, row_number)
);

create table public.templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  import_run_id uuid references public.import_runs (id) on delete restrict,
  constraint templates_name_check check (btrim(name) <> '')
);

create index templates_import_run_id_idx on public.templates (import_run_id);

create table public.versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.templates (id) on delete cascade,
  number integer not null check (number >= 1),
  created_at timestamptz not null default now(),
  origin text not null,
  source_version_id uuid references public.versions (id) on delete set null,
  source_template_name text,
  source_version_number integer,
  restored_from_version_id uuid references public.versions (id),
  unique (template_id, number),
  constraint versions_origin_check check (
    origin = any (array['import', 'blank', 'copy', 'save', 'restore']::text[])
  ),
  constraint versions_origin_columns_check check (
    (
      origin = any (array['import', 'blank', 'save']::text[])
      and source_version_id is null
      and source_template_name is null
      and source_version_number is null
      and restored_from_version_id is null
    )
    or (
      origin = 'copy'
      and source_template_name is not null
      and btrim(source_template_name) <> ''
      and source_version_number is not null
      and restored_from_version_id is null
    )
    or (
      origin = 'restore'
      and restored_from_version_id is not null
      and source_version_id is null
      and source_template_name is null
      and source_version_number is null
    )
  ),
  constraint versions_number_origin_check check (
    (number = 1) = (origin = any (array['import', 'blank', 'copy']::text[]))
  )
);

create index versions_source_version_id_idx on public.versions (source_version_id);
create index versions_restored_from_version_id_idx on public.versions (restored_from_version_id);

create table public.sections (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.versions (id) on delete cascade,
  position integer not null check (position >= 0),
  name text not null,
  unique (version_id, position),
  constraint sections_name_check check (btrim(name) <> '')
);

create table public.items (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  position integer not null check (position >= 0),
  name text not null,
  unique (section_id, position),
  constraint items_name_check check (btrim(name) <> '')
);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items (id) on delete cascade,
  position integer not null check (position >= 0),
  source_row_id uuid references public.source_rows (id) on delete restrict,
  name text not null,
  text_html text not null default '',
  comment_type text not null,
  category smallint,
  recommendation text,
  answer_type text not null,
  default_boolean boolean,
  default_text text,
  unique (item_id, position),
  constraint comments_name_check check (btrim(name) <> ''),
  constraint comments_comment_type_check check (
    comment_type = any (array['info', 'limit', 'defect']::text[])
  ),
  constraint comments_answer_type_check check (
    answer_type = any (array['boolean', 'checkbox', 'number', 'range', 'text', 'date']::text[])
  ),
  constraint comments_category_check check (
    category is null or category = any (array[-1, 0, 1]::smallint[])
  )
);

create index comments_source_row_id_idx on public.comments (source_row_id);

create table public.comment_options (
  comment_id uuid not null references public.comments (id) on delete cascade,
  list text not null,
  position integer not null check (position >= 0),
  value text not null,
  primary key (comment_id, list, position),
  constraint comment_options_list_check check (list = any (array['choice', 'unit']::text[]))
);

create table public.import_issues (
  id uuid primary key default gen_random_uuid(),
  import_run_id uuid not null references public.import_runs (id),
  position integer not null check (position >= 0),
  source_row_id uuid references public.source_rows (id),
  severity text not null,
  class text not null,
  kind text not null,
  detail jsonb not null,
  unique (import_run_id, position),
  constraint import_issues_kind_check check (kind = any (array[
    'expected-column-missing',
    'unknown-column',
    'extra-sheet',
    'whitespace-trimmed',
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
  ]::text[])),
  constraint import_issues_severity_check check (severity = any (array['warning', 'notice']::text[])),
  constraint import_issues_class_check check (
    class = any (array['Changed', 'Unsupported', 'Missing from export', 'Check']::text[])
  )
);

create index import_issues_source_row_id_idx on public.import_issues (source_row_id);

create table public.html_cuts (
  id uuid primary key default gen_random_uuid(),
  import_issue_id uuid not null references public.import_issues (id),
  position integer not null check (position >= 0),
  start integer not null check (start >= 0),
  "end" integer not null check ("end" >= 0),
  kind text not null,
  removed_text text not null,
  replacement text,
  unique (import_issue_id, position),
  constraint html_cuts_kind_check check (kind = any (array[
    'editor-leftover',
    'attribute-removed',
    'css-property-removed',
    'style-unparseable',
    'tag-removed',
    'tag-unwrapped',
    'link-scheme-removed',
    'iframe-to-link',
    'youtube-wrapper-emptied',
    'markup-rebuilt'
  ]::text[]))
);

alter table public.import_runs enable row level security;
alter table public.source_rows enable row level security;
alter table public.templates enable row level security;
alter table public.versions enable row level security;
alter table public.sections enable row level security;
alter table public.items enable row level security;
alter table public.comments enable row level security;
alter table public.comment_options enable row level security;
alter table public.import_issues enable row level security;
alter table public.html_cuts enable row level security;

alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

create or replace function public.import_template(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_run jsonb := payload -> 'evidence' -> 'run';
  v_run_id uuid;
  v_template_id uuid;
  v_version_id uuid;
begin
  insert into public.import_runs (
    filename, sha256, byte_size, sheet_name, headers, rows_read, blank_rows, values_decoded
  )
  values (
    v_run ->> 'filename',
    v_run ->> 'sha256',
    (v_run ->> 'byteSize')::integer,
    v_run ->> 'sheetName',
    coalesce(
      (
        select array_agg(header order by ord)
        from jsonb_array_elements_text(v_run -> 'headers') with ordinality as h(header, ord)
      ),
      '{}'::text[]
    ),
    (v_run ->> 'rowsRead')::integer,
    (v_run ->> 'blankRows')::integer,
    (v_run ->> 'valuesDecoded')::integer
  )
  returning id into v_run_id;

  insert into public.source_rows (import_run_id, row_number, cells)
  select v_run_id, (row ->> 'rowNumber')::integer, row -> 'cells'
  from jsonb_array_elements(payload -> 'evidence' -> 'sourceRows') as row;

  if exists (
    select 1
    from (
      select comment as payload_row
      from jsonb_array_elements(payload -> 'tree' -> 'sections') as section
      cross join lateral jsonb_array_elements(section -> 'items') as item
      cross join lateral jsonb_array_elements(item -> 'comments') as comment
      union all
      select issue
      from jsonb_array_elements(payload -> 'evidence' -> 'issues') as issue
    ) as referenced(payload_row)
    where jsonb_typeof(referenced.payload_row -> 'sourceRow') = 'number'
      and not exists (
        select 1
        from public.source_rows as sr
        where sr.import_run_id = v_run_id
          and sr.row_number = (referenced.payload_row ->> 'sourceRow')::integer
      )
  ) then
    raise exception 'sourceRow is not in this Import run' using errcode = 'P0001';
  end if;

  insert into public.templates (name, import_run_id)
  values (payload ->> 'name', v_run_id)
  returning id into v_template_id;

  insert into public.versions (template_id, number, origin)
  values (v_template_id, 1, 'import')
  returning id into v_version_id;

  insert into public.sections (version_id, position, name)
  select v_version_id, (t.ord - 1)::integer, t.section ->> 'name'
  from jsonb_array_elements(payload -> 'tree' -> 'sections') with ordinality as t(section, ord);

  insert into public.items (section_id, position, name)
  select s.id, (item.ord - 1)::integer, item.item ->> 'name'
  from jsonb_array_elements(payload -> 'tree' -> 'sections') with ordinality as sec(section, sord)
  join public.sections as s
    on s.version_id = v_version_id
   and s.position = (sec.sord - 1)::integer
  cross join lateral jsonb_array_elements(sec.section -> 'items') with ordinality as item(item, ord);

  insert into public.comments (
    item_id, position, source_row_id, name, text_html, comment_type, category,
    recommendation, answer_type, default_boolean, default_text
  )
  select
    i.id,
    (c.ord - 1)::integer,
    sr.id,
    c.comment ->> 'name',
    coalesce(c.comment ->> 'textHtml', ''),
    c.comment ->> 'commentType',
    case
      when jsonb_typeof(c.comment -> 'category') = 'number' then (c.comment ->> 'category')::smallint
      else null
    end,
    c.comment ->> 'recommendation',
    c.comment ->> 'answerType',
    case
      when jsonb_typeof(c.comment -> 'defaultBoolean') = 'boolean' then (c.comment ->> 'defaultBoolean')::boolean
      else null
    end,
    c.comment ->> 'defaultText'
  from jsonb_array_elements(payload -> 'tree' -> 'sections') with ordinality as sec(section, sord)
  join public.sections as s
    on s.version_id = v_version_id
   and s.position = (sec.sord - 1)::integer
  cross join lateral jsonb_array_elements(sec.section -> 'items') with ordinality as it(item, iord)
  join public.items as i
    on i.section_id = s.id
   and i.position = (it.iord - 1)::integer
  cross join lateral jsonb_array_elements(it.item -> 'comments') with ordinality as c(comment, ord)
  left join public.source_rows as sr
    on sr.import_run_id = v_run_id
   and jsonb_typeof(c.comment -> 'sourceRow') = 'number'
   and sr.row_number = (c.comment ->> 'sourceRow')::integer;

  insert into public.comment_options (comment_id, list, position, value)
  select cmt.id, opt.list, (opt.ord - 1)::integer, opt.value
  from jsonb_array_elements(payload -> 'tree' -> 'sections') with ordinality as sec(section, sord)
  join public.sections as s
    on s.version_id = v_version_id
   and s.position = (sec.sord - 1)::integer
  cross join lateral jsonb_array_elements(sec.section -> 'items') with ordinality as it(item, iord)
  join public.items as i
    on i.section_id = s.id
   and i.position = (it.iord - 1)::integer
  cross join lateral jsonb_array_elements(it.item -> 'comments') with ordinality as c(comment, ord)
  join public.comments as cmt
    on cmt.item_id = i.id
   and cmt.position = (c.ord - 1)::integer
  cross join lateral (
    select 'choice'::text as list, o.ord, o.value
    from jsonb_array_elements_text(c.comment -> 'choiceOptions') with ordinality as o(value, ord)
    union all
    select 'unit'::text, o.ord, o.value
    from jsonb_array_elements_text(c.comment -> 'unitOptions') with ordinality as o(value, ord)
  ) as opt;

  insert into public.import_issues (
    import_run_id, position, source_row_id, severity, class, kind, detail
  )
  select
    v_run_id,
    (t.ord - 1)::integer,
    sr.id,
    t.issue ->> 'severity',
    t.issue ->> 'class',
    t.issue ->> 'kind',
    t.issue -> 'detail'
  from jsonb_array_elements(payload -> 'evidence' -> 'issues') with ordinality as t(issue, ord)
  left join public.source_rows as sr
    on sr.import_run_id = v_run_id
   and jsonb_typeof(t.issue -> 'sourceRow') = 'number'
   and sr.row_number = (t.issue ->> 'sourceRow')::integer;

  insert into public.html_cuts (
    import_issue_id, position, start, "end", kind, removed_text, replacement
  )
  select
    iss.id,
    (c.ord - 1)::integer,
    (c.cut ->> 'start')::integer,
    (c.cut ->> 'end')::integer,
    c.cut ->> 'kind',
    c.cut ->> 'removedText',
    case
      when jsonb_typeof(c.cut -> 'replacement') = 'string' then c.cut ->> 'replacement'
      else null
    end
  from jsonb_array_elements(payload -> 'evidence' -> 'issues') with ordinality as t(issue, ord)
  join public.import_issues as iss
    on iss.import_run_id = v_run_id
   and iss.position = (t.ord - 1)::integer
  cross join lateral jsonb_array_elements(t.issue -> 'cuts') with ordinality as c(cut, ord);

  return jsonb_build_object(
    'templateId', v_template_id,
    'versionId', v_version_id,
    'importRunId', v_run_id
  );
end;
$fn$;

create or replace function public.get_version_tree(version_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $fn$
  select case
    when not exists (
      select 1 from public.versions as v where v.id = get_version_tree.version_id
    ) then null::jsonb
    else jsonb_build_object(
      'sections',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', s.id,
            'name', s.name,
            'items', coalesce((
              select jsonb_agg(
                jsonb_build_object(
                  'id', i.id,
                  'name', i.name,
                  'comments', coalesce((
                    select jsonb_agg(
                      jsonb_build_object(
                        'id', c.id,
                        'sourceRow', sr.row_number,
                        'name', c.name,
                        'textHtml', c.text_html,
                        'commentType', c.comment_type,
                        'category', c.category,
                        'recommendation', c.recommendation,
                        'answerType', c.answer_type,
                        'defaultBoolean', c.default_boolean,
                        'defaultText', c.default_text,
                        'choiceOptions', coalesce((
                          select jsonb_agg(o.value order by o.position)
                          from public.comment_options as o
                          where o.comment_id = c.id and o.list = 'choice'
                        ), '[]'::jsonb),
                        'unitOptions', coalesce((
                          select jsonb_agg(o.value order by o.position)
                          from public.comment_options as o
                          where o.comment_id = c.id and o.list = 'unit'
                        ), '[]'::jsonb)
                      )
                      order by c.position
                    )
                    from public.comments as c
                    left join public.source_rows as sr on sr.id = c.source_row_id
                    where c.item_id = i.id
                  ), '[]'::jsonb)
                )
                order by i.position
              )
              from public.items as i
              where i.section_id = s.id
            ), '[]'::jsonb)
          )
          order by s.position
        )
        from public.sections as s
        where s.version_id = get_version_tree.version_id
      ), '[]'::jsonb)
    )
  end;
$fn$;

create or replace function public.get_import_evidence(import_run_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $fn$
  select case
    when not exists (
      select 1 from public.import_runs as r where r.id = get_import_evidence.import_run_id
    ) then null::jsonb
    else (
      select jsonb_build_object(
        'run', jsonb_build_object(
          'filename', r.filename,
          'sha256', r.sha256,
          'byteSize', r.byte_size,
          'sheetName', r.sheet_name,
          'headers', to_jsonb(r.headers),
          'rowsRead', r.rows_read,
          'blankRows', r.blank_rows,
          'valuesDecoded', r.values_decoded
        ),
        'sourceRows', coalesce((
          select jsonb_agg(
            jsonb_build_object('rowNumber', sr.row_number, 'cells', sr.cells)
            order by sr.row_number
          )
          from public.source_rows as sr
          where sr.import_run_id = r.id
        ), '[]'::jsonb),
        'issues', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'kind', iss.kind,
              'sourceRow', srow.row_number,
              'detail', iss.detail,
              'cuts', coalesce((
                select jsonb_agg(
                  jsonb_build_object(
                    'start', cut.start,
                    'end', cut."end",
                    'kind', cut.kind,
                    'removedText', cut.removed_text,
                    'replacement', cut.replacement
                  )
                  order by cut.position
                )
                from public.html_cuts as cut
                where cut.import_issue_id = iss.id
              ), '[]'::jsonb)
            )
            order by iss.position
          )
          from public.import_issues as iss
          left join public.source_rows as srow on srow.id = iss.source_row_id
          where iss.import_run_id = r.id
        ), '[]'::jsonb)
      )
      from public.import_runs as r
      where r.id = get_import_evidence.import_run_id
    )
  end;
$fn$;

create or replace function public.get_template(template_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  result jsonb;
begin
  select jsonb_build_object(
    'id', t.id,
    'name', t.name,
    'createdAt', t.created_at,
    'creation', v1.origin,
    'copiedFrom', case
      when v1.origin = 'copy' then jsonb_build_object(
        'templateId', src.template_id,
        'templateName', v1.source_template_name,
        'versionNumber', v1.source_version_number
      )
      else null
    end,
    'importRun', case
      when r.id is null then null
      else jsonb_build_object(
        'id', r.id,
        'filename', r.filename,
        'sha256', r.sha256,
        'importedAt', r.created_at,
        'byteSize', r.byte_size
      )
    end,
    'latest', jsonb_build_object(
      'id', latest.id,
      'number', latest.number,
      'savedAt', latest.created_at
    ),
    'versions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', v.id,
          'number', v.number,
          'savedAt', v.created_at,
          'origin', v.origin,
          'restoredFromNumber', restored.number,
          'counts', jsonb_build_object(
            'sections', (select count(*)::integer from public.sections as s where s.version_id = v.id),
            'items', (
              select count(*)::integer
              from public.items as i
              join public.sections as s on s.id = i.section_id
              where s.version_id = v.id
            ),
            'comments', (
              select count(*)::integer
              from public.comments as c
              join public.items as i on i.id = c.item_id
              join public.sections as s on s.id = i.section_id
              where s.version_id = v.id
            )
          )
        )
        order by v.number desc
      )
      from public.versions as v
      left join public.versions as restored on restored.id = v.restored_from_version_id
      where v.template_id = t.id
    ), '[]'::jsonb)
  )
  into result
  from public.templates as t
  join public.versions as v1 on v1.template_id = t.id and v1.number = 1
  join lateral (
    select lv.id, lv.number, lv.created_at
    from public.versions as lv
    where lv.template_id = t.id
    order by lv.number desc
    limit 1
  ) as latest on true
  left join public.import_runs as r on r.id = t.import_run_id
  left join public.versions as src on src.id = v1.source_version_id
  where t.id = get_template.template_id;

  return result;
end;
$fn$;

-- PT404 is template-not-found. src/db maps the SQLSTATE, never the message text.
create or replace function public.delete_template(template_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_run_id uuid;
  v_deleted boolean := false;
begin
  select t.import_run_id
  into v_run_id
  from public.templates as t
  where t.id = delete_template.template_id;

  if not found then
    raise exception 'template-not-found'
      using errcode = 'PT404',
            detail = '{"kind":"template-not-found"}';
  end if;

  delete from public.templates as t
  where t.id = delete_template.template_id;

  if v_run_id is not null
     and not exists (select 1 from public.templates as t where t.import_run_id = v_run_id)
     and not exists (
       select 1
       from public.comments as c
       join public.source_rows as sr on sr.id = c.source_row_id
       where sr.import_run_id = v_run_id
     )
  then
    delete from public.html_cuts as cut
    using public.import_issues as iss
    where cut.import_issue_id = iss.id
      and iss.import_run_id = v_run_id;

    delete from public.import_issues as iss
    where iss.import_run_id = v_run_id;

    delete from public.source_rows as sr
    where sr.import_run_id = v_run_id;

    delete from public.import_runs as r
    where r.id = v_run_id;

    v_deleted := true;
  end if;

  return jsonb_build_object('importRunDeleted', v_deleted);
end;
$fn$;

revoke all on table
  public.import_runs,
  public.source_rows,
  public.templates,
  public.versions,
  public.sections,
  public.items,
  public.comments,
  public.comment_options,
  public.import_issues,
  public.html_cuts
from anon, authenticated;

grant all on table
  public.import_runs,
  public.source_rows,
  public.templates,
  public.versions,
  public.sections,
  public.items,
  public.comments,
  public.comment_options,
  public.import_issues,
  public.html_cuts
to service_role;

revoke all on all sequences in schema public from anon, authenticated;

revoke all on function public.import_template(jsonb) from public, anon, authenticated;
revoke all on function public.get_version_tree(uuid) from public, anon, authenticated;
revoke all on function public.get_import_evidence(uuid) from public, anon, authenticated;
revoke all on function public.get_template(uuid) from public, anon, authenticated;
revoke all on function public.delete_template(uuid) from public, anon, authenticated;

grant execute on function public.import_template(jsonb) to service_role;
grant execute on function public.get_version_tree(uuid) to service_role;
grant execute on function public.get_import_evidence(uuid) to service_role;
grant execute on function public.get_template(uuid) to service_role;
grant execute on function public.delete_template(uuid) to service_role;
