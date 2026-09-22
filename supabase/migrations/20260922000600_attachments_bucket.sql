-- The attachments bucket, as a migration rather than a dashboard step.
--
-- src/data/files.ts reads every attachment through the PUBLIC object URL of a
-- bucket named "attachments", and uploads bytes into it as the signed-in
-- user. The bucket was never created on the marina's project: both marina
-- maps rendered as broken images and Storage answered "Bucket not found".
-- CLAUDE.md already records that anything which is a file locally and a
-- dashboard field remotely will be forgotten; a bucket is one more of those,
-- so it lives here where every marina picks it up on `db push` / `db reset`.
--
-- Public READ is deliberate and matches the URL the app builds: map images
-- and photos are shown by URL with no token. WRITES need a signed-in marina
-- user, checked the same way every table policy checks it.

insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', true)
on conflict (id) do update set public = excluded.public;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                  and policyname = 'attachments_public_read') then
    create policy attachments_public_read on storage.objects for select
      using (bucket_id = 'attachments');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                  and policyname = 'attachments_marina_write') then
    create policy attachments_marina_write on storage.objects for insert to authenticated
      with check (bucket_id = 'attachments' and public.is_active_marina_user());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                  and policyname = 'attachments_marina_update') then
    create policy attachments_marina_update on storage.objects for update to authenticated
      using (bucket_id = 'attachments' and public.is_active_marina_user())
      with check (bucket_id = 'attachments' and public.is_active_marina_user());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                  and policyname = 'attachments_marina_delete') then
    create policy attachments_marina_delete on storage.objects for delete to authenticated
      using (bucket_id = 'attachments' and public.is_active_marina_user());
  end if;
end $$;
