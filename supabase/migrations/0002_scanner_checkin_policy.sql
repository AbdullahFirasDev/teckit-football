-- ============================================================================
-- 0002 — Scanner check-in support
--
-- `check_in_ticket` is SECURITY INVOKER: it runs with the signed-in staff
-- member's privileges, so RLS scopes check-ins to events they may manage.
-- 0001 only granted SELECT on tickets — without an UPDATE policy the guarded
-- `update tickets set is_used = true` silently matched 0 rows. This adds the
-- missing policy (same rule as reads: own events, or admin/staff).
-- ============================================================================

drop policy if exists tickets_staff_update on public.tickets;
create policy tickets_staff_update on public.tickets
    for update using (
        public.has_role(auth.uid(), '{admin,staff}')
        or exists (select 1 from public.events e where e.id = event_id and e.organizer_id = auth.uid())
    ) with check (
        public.has_role(auth.uid(), '{admin,staff}')
        or exists (select 1 from public.events e where e.id = event_id and e.organizer_id = auth.uid())
    );
