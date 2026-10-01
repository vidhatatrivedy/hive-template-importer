-- Restore copies one Version's tree into a new Version. The current Version stays.
-- PT409 is stale-base. PT404 is template-not-found, including an unknown Version.

create or replace function public.restore_version(version_id uuid, base_number integer)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_template_id uuid;
  v_latest integer;
  v_version_id uuid;
begin
  select t.id
  into v_template_id
  from public.versions as v
  join public.templates as t on t.id = v.template_id
  where v.id = restore_version.version_id
  for update of t;

  if not found then
    raise exception 'template-not-found'
      using errcode = 'PT404',
            detail = '{"kind":"template-not-found"}';
  end if;

  select max(v.number)
  into v_latest
  from public.versions as v
  where v.template_id = v_template_id;

  if v_latest is distinct from restore_version.base_number then
    raise exception 'stale-base'
      using errcode = 'PT409',
            detail = jsonb_build_object('kind', 'stale-base', 'latestNumber', v_latest)::text;
  end if;

  insert into public.versions (template_id, number, origin, restored_from_version_id)
  values (v_template_id, restore_version.base_number + 1, 'restore', restore_version.version_id)
  returning id into v_version_id;

  insert into public.sections (version_id, position, name)
  select v_version_id, s.position, s.name
  from public.sections as s
  where s.version_id = restore_version.version_id;

  insert into public.items (section_id, position, name)
  select new_s.id, i.position, i.name
  from public.sections as old_s
  join public.items as i on i.section_id = old_s.id
  join public.sections as new_s
    on new_s.version_id = v_version_id
   and new_s.position = old_s.position
  where old_s.version_id = restore_version.version_id;

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
  where old_s.version_id = restore_version.version_id;

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
  where old_s.version_id = restore_version.version_id;

  return jsonb_build_object(
    'versionId', v_version_id,
    'number', restore_version.base_number + 1
  );
end;
$fn$;

revoke all on function public.restore_version(uuid, integer) from public, anon, authenticated;

grant execute on function public.restore_version(uuid, integer) to service_role;
