-- The End Shift Item (src/pages/checklists/ActiveChecklistPage.spec.md
-- § End Shift Item): the last item of an ordinary checklist, which submits it
-- and carries the guard on to the end of their shift.
--
-- Additive: a new enum value, and nothing existing changes. Postgres can add
-- an enum value but never drop one, which is the right shape for a type list
-- that only grows. No row needs it until the template editor writes one.

alter type checklist_item_type add value if not exists 'end_shift';
