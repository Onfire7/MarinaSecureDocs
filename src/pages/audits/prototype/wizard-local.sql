-- PROTOTYPE — throwaway, LOCAL ONLY. The wizard needs an open audit with
-- pending targets; the report seed leaves its audit closed. Run after
-- scripts/e2e/seed-audit-report.sql. Never against a marina's database.
update audits set status = 'open', closed_at = null
 where name = 'Campground & B Dock status - Sept 2026';
update audit_targets set state = 'pending', not_audited_reason = null
 where audit_id = (select id from audits where name = 'Campground & B Dock status - Sept 2026')
   and state = 'not_audited';
select a.id, a.status,
       count(*) filter (where t.state = 'pending') as pending,
       count(*) filter (where t.state = 'audited') as audited
  from audits a join audit_targets t on t.audit_id = a.id
 where a.name = 'Campground & B Dock status - Sept 2026'
 group by a.id, a.status;
