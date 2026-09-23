-- An open audit can be shared too (owner's call, 2026-09-23). The report of
-- an open audit is live progress - the same document, compiled on each
-- read, with pending targets counted - and a link to it is a progress link.
-- 20260923000100 refused open audits with a trigger on the reading that
-- there was nothing to report yet; there is, so the trigger goes.
drop trigger if exists audit_shares_guard on public.audit_shares;
drop function if exists public.audit_share_guard();
