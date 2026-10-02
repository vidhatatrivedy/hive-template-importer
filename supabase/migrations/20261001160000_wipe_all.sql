-- Seed's wipe. Deletes every row, children first, in one transaction.
-- No Server Action wraps this. Versions point at each other, so unreferenced
-- Versions go first and the rest follow.

create or replace function public.wipe_all()
returns void
language plpgsql
security invoker
set search_path = ''
as $fn$
begin
  -- `where true` satisfies the database's rule that DELETE names a WHERE clause.
  delete from public.html_cuts where true;
  delete from public.comment_options where true;
  delete from public.comments where true;
  delete from public.items where true;
  delete from public.sections where true;
  delete from public.import_issues where true;

  loop
    delete from public.versions as v
    where not exists (
      select 1
      from public.versions as other
      where other.source_version_id = v.id
         or other.restored_from_version_id = v.id
    );
    exit when not found;
  end loop;

  delete from public.templates where true;
  delete from public.source_rows where true;
  delete from public.import_runs where true;
end;
$fn$;

revoke all on function public.wipe_all() from public, anon, authenticated;
grant execute on function public.wipe_all() to service_role;
