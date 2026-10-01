-- Save stores one new immutable Version. UPDATE is refused, except a templates
-- change that leaves every column other than name untouched.
-- PT409 is stale-base. PT422 is foreign-source-row. PT404 is template-not-found.

create or replace function public.reject_content_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $fn$
begin
  if tg_table_schema = 'public'
     and tg_table_name = 'templates'
     and new.id is not distinct from old.id
     and new.created_at is not distinct from old.created_at
     and new.import_run_id is not distinct from old.import_run_id
  then
    return new;
  end if;

  raise exception 'updates are not allowed' using errcode = 'P0001';
end;
$fn$;

create trigger reject_update before update on public.import_runs
  for each row execute function public.reject_content_update();
create trigger reject_update before update on public.source_rows
  for each row execute function public.reject_content_update();
create trigger reject_update before update on public.templates
  for each row execute function public.reject_content_update();
create trigger reject_update before update on public.versions
  for each row execute function public.reject_content_update();
create trigger reject_update before update on public.sections
  for each row execute function public.reject_content_update();
create trigger reject_update before update on public.items
  for each row execute function public.reject_content_update();
create trigger reject_update before update on public.comments
  for each row execute function public.reject_content_update();
create trigger reject_update before update on public.comment_options
  for each row execute function public.reject_content_update();
create trigger reject_update before update on public.import_issues
  for each row execute function public.reject_content_update();
create trigger reject_update before update on public.html_cuts
  for each row execute function public.reject_content_update();

create or replace function public.save_version(template_id uuid, base_number integer, tree jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_run_id uuid;
  v_latest integer;
  v_version_id uuid;
  v_foreign integer[];
begin
  select t.import_run_id
  into v_run_id
  from public.templates as t
  where t.id = save_version.template_id
  for update;

  if not found then
    raise exception 'template-not-found'
      using errcode = 'PT404',
            detail = '{"kind":"template-not-found"}';
  end if;

  select max(v.number)
  into v_latest
  from public.versions as v
  where v.template_id = save_version.template_id;

  if v_latest is distinct from save_version.base_number then
    raise exception 'stale-base'
      using errcode = 'PT409',
            detail = jsonb_build_object('kind', 'stale-base', 'latestNumber', v_latest)::text;
  end if;

  select coalesce(array_agg(src.row_number order by src.row_number), '{}'::integer[])
  into v_foreign
  from (
    select distinct (comment ->> 'sourceRow')::integer as row_number
    from jsonb_array_elements(save_version.tree -> 'sections') as section
    cross join lateral jsonb_array_elements(section -> 'items') as item
    cross join lateral jsonb_array_elements(item -> 'comments') as comment
    where jsonb_typeof(comment -> 'sourceRow') = 'number'
  ) as src
  where v_run_id is null
     or not exists (
       select 1
       from public.source_rows as sr
       where sr.import_run_id = v_run_id
         and sr.row_number = src.row_number
     );

  if coalesce(cardinality(v_foreign), 0) > 0 then
    raise exception 'foreign-source-row'
      using errcode = 'PT422',
            detail = jsonb_build_object(
              'kind', 'foreign-source-row',
              'rowNumbers', to_jsonb(v_foreign)
            )::text;
  end if;

  insert into public.versions (template_id, number, origin)
  values (save_version.template_id, save_version.base_number + 1, 'save')
  returning id into v_version_id;

  insert into public.sections (version_id, position, name)
  select v_version_id, (t.ord - 1)::integer, t.section ->> 'name'
  from jsonb_array_elements(save_version.tree -> 'sections') with ordinality as t(section, ord);

  insert into public.items (section_id, position, name)
  select s.id, (item.ord - 1)::integer, item.item ->> 'name'
  from jsonb_array_elements(save_version.tree -> 'sections') with ordinality as sec(section, sord)
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
  from jsonb_array_elements(save_version.tree -> 'sections') with ordinality as sec(section, sord)
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
  from jsonb_array_elements(save_version.tree -> 'sections') with ordinality as sec(section, sord)
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

  return jsonb_build_object(
    'versionId', v_version_id,
    'number', save_version.base_number + 1
  );
end;
$fn$;

revoke all on function public.reject_content_update() from public, anon, authenticated;
revoke all on function public.save_version(uuid, integer, jsonb) from public, anon, authenticated;

grant execute on function public.reject_content_update() to service_role;
grant execute on function public.save_version(uuid, integer, jsonb) to service_role;
