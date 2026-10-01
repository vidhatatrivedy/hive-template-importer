-- List, Blank and Rename. Names are stored as given; templates_name_check
-- refuses a blank or space-only name and nothing here trims.
-- PT404 is template-not-found.

create or replace function public.list_templates()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $fn$
  select coalesce(
    (
      select jsonb_agg(
        listed.summary
        order by listed.saved_at desc, listed.created_at desc, listed.id asc
      )
      from (
        select
          t.id,
          t.created_at,
          latest.created_at as saved_at,
          jsonb_build_object(
            'id', t.id,
            'name', t.name,
            'creation', v1.origin,
            'copiedFromName', case
              when v1.origin = 'copy' then v1.source_template_name
              else null
            end,
            'importRun', case
              when r.id is null then null
              else jsonb_build_object(
                'id', r.id,
                'filename', r.filename,
                'sha256', r.sha256,
                'importedAt', r.created_at
              )
            end,
            'latest', jsonb_build_object(
              'id', latest.id,
              'number', latest.number,
              'savedAt', latest.created_at
            )
          ) as summary
        from public.templates as t
        join public.versions as v1
          on v1.template_id = t.id
         and v1.number = 1
        join lateral (
          select lv.id, lv.number, lv.created_at
          from public.versions as lv
          where lv.template_id = t.id
          order by lv.number desc
          limit 1
        ) as latest on true
        left join public.import_runs as r on r.id = t.import_run_id
      ) as listed
    ),
    '[]'::jsonb
  );
$fn$;

create or replace function public.create_blank_template(name text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_template_id uuid;
  v_version_id uuid;
begin
  insert into public.templates (name)
  values (create_blank_template.name)
  returning id into v_template_id;

  insert into public.versions (template_id, number, origin)
  values (v_template_id, 1, 'blank')
  returning id into v_version_id;

  return jsonb_build_object(
    'templateId', v_template_id,
    'versionId', v_version_id
  );
end;
$fn$;

create or replace function public.rename_template(template_id uuid, name text)
returns void
language plpgsql
security invoker
set search_path = ''
as $fn$
begin
  perform 1
  from public.templates as t
  where t.id = rename_template.template_id
  for update;

  if not found then
    raise exception 'template-not-found'
      using errcode = 'PT404',
            detail = '{"kind":"template-not-found"}';
  end if;

  update public.templates as t
  set name = rename_template.name
  where t.id = rename_template.template_id;
end;
$fn$;

revoke all on function public.list_templates() from public, anon, authenticated;
revoke all on function public.create_blank_template(text) from public, anon, authenticated;
revoke all on function public.rename_template(uuid, text) from public, anon, authenticated;

grant execute on function public.list_templates() to service_role;
grant execute on function public.create_blank_template(text) to service_role;
grant execute on function public.rename_template(uuid, text) to service_role;
