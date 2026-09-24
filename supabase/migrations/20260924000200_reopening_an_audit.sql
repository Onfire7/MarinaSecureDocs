-- An audit that closed itself can be opened again.
--
-- Closing is a convenience: when no target is left pending there is nothing
-- more to record, so the audit shuts. Two ways that catches an auditor out.
-- On the build before `confirmed_at`, every answer marked its location
-- audited, so the last answer of a partial sweep closed the whole audit
-- with most of it unlooked-at. And a Close early, made in good faith at the
-- end of a shift, is sometimes regretted the next morning.
--
-- Until now the only way back was SQL against the marina's database, which
-- means a laptop, which is not what an auditor is holding.
--
-- `reopen_audit()` puts the audit back to Open and returns the targets that
-- the early close pushed out of the queue - "closed early" and nothing
-- else, so a location genuinely marked Not Audited for its own reason stays
-- that way. Confirmations are left alone: an audit being reopened says
-- nothing about the locations that were properly signed off, and clearing
-- them would throw away the record of who finished what.
--
-- Which leaves the obvious trap: reopening an audit whose targets are all
-- confirmed gives an audit with nothing pending, and the next Finding
-- written to it would trip the auto-close and shut it again. So an audit
-- that a person reopened is one a person closes. `reopened_at` records
-- that, and the auto-close stands down for good on that audit; Close early
-- is still there, and is now the only way it closes.

alter table audits add column reopened_at timestamptz;
comment on column audits.reopened_at is
  'When someone last reopened this audit after it closed. While it is set the audit never closes itself again - see reopen_audit().';

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
    -- Never to an audit somebody deliberately reopened.
    update audits set status = 'closed', closed_at = now()
     where id = a and status = 'open' and reopened_at is null;
  end if;
  return new;
end $$;

-- The way back. SECURITY DEFINER for the same reason close_audit() is:
-- it edits targets, which the target policy reserves to manage_audits, and
-- the check is made here rather than by RLS so the refusal has words.
create function public.reopen_audit(p_audit uuid) returns void
  language plpgsql security definer set search_path = public
as $$
declare a audits%rowtype;
begin
  if not public.has_permission('manage_audits') then
    raise exception 'manage_audits required' using errcode = 'insufficient_privilege';
  end if;
  select * into a from audits where id = p_audit for update;
  if a.id is null then raise exception 'no such audit'; end if;
  if a.status = 'open' then return; end if;
  if a.status = 'finalized' then
    -- Finalizing is the one path from an audit into marina structure:
    -- locations created, attributes applied, proposals spent. Reopening
    -- would invite a second pass over decisions already acted on.
    raise exception 'audit % is finalized; its proposals have already been applied', p_audit
      using errcode = 'check_violation';
  end if;
  update audit_targets
     set state = 'pending', not_audited_reason = null
   where audit_id = p_audit and state = 'not_audited' and not_audited_reason = 'closed early';
  update audits
     set status = 'open', closed_at = null, closed_by_id = null, reopened_at = now()
   where id = p_audit;
end $$;
