-- A finding's parts must be allowed in after the finding closed the audit.
--
-- Recording a finding on an audit's LAST pending target closes the audit
-- (audit_finding_after_write). The finding's parts — occupants, services,
-- answers, proposals — and the displaced note on another target arrive in
-- the same client transaction but reach PostgREST as separate requests, so
-- by the time they land the audit is 'closed' and the policies that said
-- "author, while the audit is open" refused them. The connector treats an
-- RLS refusal with identity as final and discards the write. Found on the
-- first single-target audit: the finding saved, the move_placement proposal
-- vanished.
--
-- Parts and proposals are now writable by the finding's author until the
-- audit is FINALIZED. The finding row itself keeps its open-only policy
-- (findings_author_update), and the guard trigger still refuses a finding
-- on a closed audit, so nothing new can be recorded after close — only the
-- parts of a finding that was recorded in time can finish arriving.

do $$
declare t text;
begin
  foreach t in array array['audit_finding_boats','audit_finding_vehicles','audit_finding_services',
                           'audit_finding_amenities','audit_finding_answers']
  loop
    execute format('drop policy finding_parts_author on public.%I', t);
    execute format($f$
      create policy finding_parts_author on public.%I for all
        using (exists (select 1 from audit_findings f join audits a on a.id = f.audit_id
                        where f.id = finding_id and f.recorded_by_id = public.current_marina_user_id()
                          and a.status <> 'finalized'))
        with check (exists (select 1 from audit_findings f join audits a on a.id = f.audit_id
                             where f.id = finding_id and f.recorded_by_id = public.current_marina_user_id()
                               and a.status <> 'finalized'))
    $f$, t);
  end loop;
end $$;

drop policy proposals_author on audit_proposals;
create policy proposals_author on audit_proposals for all
  using (exists (select 1 from audit_findings f join audits a on a.id = f.audit_id
                  where f.id = finding_id and f.recorded_by_id = public.current_marina_user_id()
                    and a.status <> 'finalized'))
  with check (exists (select 1 from audit_findings f join audits a on a.id = f.audit_id
                       where f.id = finding_id and f.recorded_by_id = public.current_marina_user_id()
                         and a.status <> 'finalized'));

drop policy targets_displaced_note on audit_targets;
create policy targets_displaced_note on audit_targets for update
  using (public.is_active_marina_user()
         and exists (select 1 from audits a where a.id = audit_id and a.status <> 'finalized'))
  with check (public.is_active_marina_user());
