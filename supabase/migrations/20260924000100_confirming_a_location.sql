-- A location is audited when the auditor says it is, not when the first
-- answer lands.
--
-- Until now, creating a Finding marked its target audited - which was true
-- of the Finding form, where one save records the whole location, and false
-- of the wizard, where a run is expected to be a slice. Sweeping the power
-- pedestals marked forty sites audited while nothing else about them had
-- been looked at; the audit page then read as finished, and the last of
-- those findings closed the audit outright. There was no way to say "I have
-- recorded what I saw, I am not done here yet".
--
-- So confirmation is now its own fact. `confirmed_at` is when someone said
-- the location was done, and the target is audited exactly while it is set.
-- A wizard run accumulates answers against an unconfirmed Finding, pass
-- after pass, and its last page for each location shows everything on file
-- there and asks. The Finding form still confirms on save - it shows the
-- whole location at once, so saving it is the same statement.
--
-- The column has no default. A writer that does not think about
-- confirmation leaves the location pending, which is the safe way round:
-- unaudited work that reads as audited is invisible, and the reverse is a
-- pill on the audit page.

alter table audit_findings add column confirmed_at timestamptz;
comment on column audit_findings.confirmed_at is
  'When the auditor said this location was done. Null while a run is still accumulating answers; audit_targets.state is "audited" exactly while this is set.';

-- Everything recorded before today was recorded by a form, one save per
-- location, and its target is already audited. Triggers off: the backfill
-- is bookkeeping, not an audit event, and the after-write trigger would
-- walk every audit's close condition again on the way past.
alter table audit_findings disable trigger user;
update audit_findings set confirmed_at = updated_at;
alter table audit_findings enable trigger user;

-- Confirming, and un-confirming, are edits to a Finding like any other:
-- refused once the audit is closed.
drop trigger audit_findings_guard on audit_findings;
create trigger audit_findings_guard before insert or update of
    audit_id, target_id, recorded_by_id, occupied, contact_id, unexpected_occupancy,
    clearly_marked, mapped_correctly, confirmed_at
  on audit_findings
  for each row execute function public.audit_finding_guard();

create or replace function public.audit_finding_after_write() returns trigger
  language plpgsql security definer set search_path = public
as $$
declare a uuid;
begin
  if tg_op = 'DELETE' then
    if old.target_id is not null then
      update audit_targets set state = 'pending' where id = old.target_id and state = 'audited';
    end if;
    return old;
  end if;
  if new.target_id is not null then
    if new.confirmed_at is not null then
      update audit_targets set state = 'audited' where id = new.target_id and state <> 'audited';
    else
      -- Work in progress. A target that was confirmed and has been reopened
      -- goes back into the queue; one that was never confirmed stays in it.
      update audit_targets set state = 'pending' where id = new.target_id and state = 'audited';
    end if;
  end if;
  a := new.audit_id;
  if not exists (select 1 from audit_targets where audit_id = a and state = 'pending') then
    update audits set status = 'closed', closed_at = now()
     where id = a and status = 'open';
  end if;
  return new;
end $$;
