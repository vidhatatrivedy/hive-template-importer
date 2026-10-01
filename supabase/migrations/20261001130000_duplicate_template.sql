-- Duplicate copies a Template's latest Version into an independent Copy.
-- Clearing versions.source_version_id is allowed so deleting the source can SET NULL.
-- PT404 is template-not-found.

create or replace function public.reject_content_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $fn$
begin
  -- Field access has to sit inside the table branch. AND does not skip it, and
  -- NEW only has the columns of the table being updated.
  if tg_table_schema = 'public' and tg_table_name = 'templates' then
    if new.id is not distinct from old.id
       and new.created_at is not distinct from old.created_at
       and new.import_run_id is not distinct from old.import_run_id
    then
      return new;
    end if;
  elsif tg_table_schema = 'public' and tg_table_name = 'versions' then
    if old.source_version_id is not null
       and new.source_version_id is null
       and new.id is not distinct from old.id
       and new.template_id is not distinct from old.template_id
       and new.number is not distinct from old.number
       and new.created_at is not distinct from old.created_at
       and new.origin is not distinct from old.origin
       and new.source_template_name is not distinct from old.source_template_name
       and new.source_version_number is not distinct from old.source_version_number
       and new.restored_from_version_id is not distinct from old.restored_from_version_id
    then
      return new;
    end if;
  end if;

  raise exception 'updates are not allowed' using errcode = 'P0001';
end;
$fn$;

create or replace function public.duplicate_template(template_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_name text;
  v_run_id uuid;
  v_source_version_id uuid;
  v_source_number integer;
  v_template_id uuid;
  v_version_id uuid;
begin
  select t.name, t.import_run_id, v.id, v.number
  into v_name, v_run_id, v_source_version_id, v_source_number
  from public.templates as t
  join public.versions as v on v.template_id = t.id
  where t.id = duplicate_template.template_id
  order by v.number desc
  limit 1
  for update of t;

  if not found then
    raise exception 'template-not-found'
      using errcode = 'PT404',
            detail = '{"kind":"template-not-found"}';
  end if;

  insert into public.templates (name, import_run_id)
  values (v_name || ' (copy)', v_run_id)
  returning id into v_template_id;

  insert into public.versions (
    template_id,
    number,
    origin,
    source_version_id,
    source_template_name,
    source_version_number
  )
  values (v_template_id, 1, 'copy', v_source_version_id, v_name, v_source_number)
  returning id into v_version_id;

  insert into public.sections (version_id, position, name)
  select v_version_id, s.position, s.name
  from public.sections as s
  where s.version_id = v_source_version_id;

  insert into public.items (section_id, position, name)
  select new_s.id, i.position, i.name
  from public.sections as old_s
  join public.items as i on i.section_id = old_s.id
  join public.sections as new_s
    on new_s.version_id = v_version_id
   and new_s.position = old_s.position
  where old_s.version_id = v_source_version_id;

  insert into public.comments (
    item_id, position, source_row_id, name, text_html, comment_type, category,
    recommendation, answer_type, default_boolean, default_text
  )
  select
    new_i.id,
    c.position,
    c.source_row_id,
    c.name,
    c.text_html,
    c.comment_type,
    c.category,
    c.recommendation,
    c.answer_type,
    c.default_boolean,
    c.default_text
  from public.sections as old_s
  join public.items as old_i on old_i.section_id = old_s.id
  join public.comments as c on c.item_id = old_i.id
  join public.sections as new_s
    on new_s.version_id = v_version_id
   and new_s.position = old_s.position
  join public.items as new_i
    on new_i.section_id = new_s.id
   and new_i.position = old_i.position
  where old_s.version_id = v_source_version_id;

  insert into public.comment_options (comment_id, list, position, value)
  select new_c.id, o.list, o.position, o.value
  from public.sections as old_s
  join public.items as old_i on old_i.section_id = old_s.id
  join public.comments as old_c on old_c.item_id = old_i.id
  join public.comment_options as o on o.comment_id = old_c.id
  join public.sections as new_s
    on new_s.version_id = v_version_id
   and new_s.position = old_s.position
  join public.items as new_i
    on new_i.section_id = new_s.id
   and new_i.position = old_i.position
  join public.comments as new_c
    on new_c.item_id = new_i.id
   and new_c.position = old_c.position
  where old_s.version_id = v_source_version_id;

  return jsonb_build_object(
    'templateId', v_template_id,
    'versionId', v_version_id
  );
end;
$fn$;

revoke all on function public.duplicate_template(uuid) from public, anon, authenticated;

grant execute on function public.duplicate_template(uuid) to service_role;
