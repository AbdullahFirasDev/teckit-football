-- ============================================================================
-- All-in-One Events & Ticketing Platform — Supabase schema
-- Run in the Supabase SQL Editor (or `supabase db push`).
-- Safe to re-run: every statement is idempotent.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. Users / Organizers (profile rows synced from auth.users)
-- ----------------------------------------------------------------------------
create table if not exists public.users (
    id         uuid primary key default gen_random_uuid(),
    full_name  varchar(255) not null,
    email      varchar(255) unique not null,
    role       varchar(50)  not null default 'organizer', -- 'admin' | 'organizer' | 'staff'
    created_at timestamptz  not null default now()
);

-- ----------------------------------------------------------------------------
-- 2. Events
-- ----------------------------------------------------------------------------
create table if not exists public.events (
    id           uuid primary key default gen_random_uuid(),
    organizer_id uuid references public.users(id) on delete cascade,
    title        varchar(255) not null,
    description  text,
    location     varchar(255) not null,
    event_date   timestamptz  not null,
    status       varchar(50)  not null default 'active', -- 'active' | 'cancelled' | 'completed'
    created_at   timestamptz  not null default now()
);

create index if not exists events_event_date_idx on public.events (event_date);
create index if not exists events_organizer_idx  on public.events (organizer_id);

-- ----------------------------------------------------------------------------
-- 3. Ticket Types
-- ----------------------------------------------------------------------------
create table if not exists public.ticket_types (
    id            uuid primary key default gen_random_uuid(),
    event_id      uuid not null references public.events(id) on delete cascade,
    name          varchar(100) not null,               -- e.g. 'VIP', 'General Admission'
    price         numeric(10, 2) not null,
    total_quantity int not null check (total_quantity >= 0),
    sold_quantity int not null default 0 check (sold_quantity >= 0),
    created_at    timestamptz not null default now(),
    constraint ticket_types_not_oversold check (sold_quantity <= total_quantity)
);

create index if not exists ticket_types_event_idx on public.ticket_types (event_id);

-- ----------------------------------------------------------------------------
-- 4. Orders (one Wayl payment = one order; may contain several tickets)
--    `orders.id` doubles as the Wayl `referenceId` so webhooks correlate 1:1.
-- ----------------------------------------------------------------------------
create table if not exists public.orders (
    id                  uuid primary key default gen_random_uuid(),
    event_id            uuid not null references public.events(id) on delete cascade,
    ticket_type_id      uuid not null references public.ticket_types(id) on delete restrict,
    buyer_name          varchar(255) not null,
    buyer_phone         varchar(50)  not null,
    quantity            int not null check (quantity > 0),
    unit_price          numeric(10, 2) not null,
    total_amount        numeric(12, 2) not null,
    currency            varchar(10) not null default 'IQD',
    status              varchar(50) not null default 'pending', -- pending | paid | failed | cancelled
    wayl_link_id        text,
    wayl_code           text,
    wayl_payment_method text,
    paid_at             timestamptz,
    created_at          timestamptz not null default now()
);

create index if not exists orders_event_idx on public.orders (event_id);
create index if not exists orders_phone_idx on public.orders (buyer_phone);

-- ----------------------------------------------------------------------------
-- 5. Issued Tickets
-- ----------------------------------------------------------------------------
create table if not exists public.tickets (
    id             uuid primary key default gen_random_uuid(),
    ticket_type_id uuid not null references public.ticket_types(id) on delete cascade,
    event_id       uuid not null references public.events(id) on delete cascade,
    order_id       uuid references public.orders(id) on delete set null,
    buyer_name     varchar(255) not null,
    buyer_phone    varchar(50)  not null,
    qr_code_hash   varchar(255) unique not null,
    is_used        boolean not null default false,
    used_at        timestamptz null,
    created_at     timestamptz not null default now()
);

create index if not exists tickets_event_idx on public.tickets (event_id, is_used);
create index if not exists tickets_phone_idx on public.tickets (buyer_phone);
create index if not exists tickets_order_idx on public.tickets (order_id);

-- ============================================================================
-- Role helpers (SECURITY DEFINER avoids RLS recursion on public.users)
-- ============================================================================
create or replace function public.has_role(p_user_id uuid, p_roles text[])
returns boolean
language sql
security definer
set search_path = public
stable
as $$
    select exists (
        select 1 from public.users u
        where u.id = p_user_id and u.role = any (p_roles)
    );
$$;

revoke execute on function public.has_role(uuid, text[]) from anon;
grant execute on function public.has_role(uuid, text[]) to authenticated;

-- ============================================================================
-- Atomic ticket purchase (single ticket). Prevents race conditions /
-- overbooking with a row-level lock. Called server-side (service role).
-- ============================================================================
create or replace function public.purchase_ticket(
    p_ticket_type_id uuid,
    p_event_id       uuid,
    p_buyer_name     varchar,
    p_buyer_phone    varchar,
    p_qr_hash        varchar
) returns uuid
language plpgsql
as $$
declare
    v_ticket_id uuid;
    v_sold      int;
    v_total     int;
begin
    -- Lock the ticket type row so concurrent checkouts serialize here.
    select sold_quantity, total_quantity
      into v_sold, v_total
      from public.ticket_types
     where id = p_ticket_type_id
       for update;

    if not found then
        raise exception 'Ticket type not found';
    end if;

    if v_sold >= v_total then
        raise exception 'Tickets are sold out';
    end if;

    update public.ticket_types
       set sold_quantity = sold_quantity + 1
     where id = p_ticket_type_id;

    insert into public.tickets (ticket_type_id, event_id, buyer_name, buyer_phone, qr_code_hash)
    values (p_ticket_type_id, p_event_id, p_buyer_name, p_buyer_phone, p_qr_hash)
    returning id into v_ticket_id;

    return v_ticket_id;
end;
$$;

-- ============================================================================
-- Atomic order fulfillment (webhook path). Idempotent: safe against Wayl
-- webhook retries. Issues `orders.quantity` tickets in one transaction.
-- ============================================================================
create or replace function public.issue_tickets_for_order(p_order_id uuid)
returns jsonb
language plpgsql
as $$
declare
    v_order       public.orders%rowtype;
    v_sold        int;
    v_total       int;
    v_ticket_id   uuid;
    v_issued      jsonb := '[]'::jsonb;
    i             int;
begin
    select * into v_order from public.orders where id = p_order_id for update;

    if not found then
        raise exception 'Order % not found', p_order_id;
    end if;

    -- Idempotency: a retried webhook must not double-issue.
    if v_order.status = 'paid' then
        return jsonb_build_object(
            'order_id', v_order.id,
            'already_fulfilled', true,
            'tickets', coalesce(
                (select jsonb_agg(to_jsonb(t)) from public.tickets t where t.order_id = v_order.id),
                '[]'::jsonb
            )
        );
    end if;

    select sold_quantity, total_quantity into v_sold, v_total
      from public.ticket_types
     where id = v_order.ticket_type_id
       for update;

    if not found then
        raise exception 'Ticket type not found for order %', p_order_id;
    end if;

    if v_total - v_sold < v_order.quantity then
        raise exception 'Tickets are sold out';
    end if;

    update public.ticket_types
       set sold_quantity = sold_quantity + v_order.quantity
     where id = v_order.ticket_type_id;

    for i in 1 .. v_order.quantity loop
        insert into public.tickets
            (ticket_type_id, event_id, order_id, buyer_name, buyer_phone, qr_code_hash)
        values
            (v_order.ticket_type_id, v_order.event_id, v_order.id,
             v_order.buyer_name, v_order.buyer_phone, encode(gen_random_bytes(24), 'hex'))
        returning id into v_ticket_id;

        v_issued := v_issued || to_jsonb(v_ticket_id);
    end loop;

    update public.orders
       set status = 'paid', paid_at = now()
     where id = v_order.id;

    return jsonb_build_object(
        'order_id', v_order.id,
        'already_fulfilled', false,
        'ticket_ids', v_issued,
        'tickets', coalesce(
            (select jsonb_agg(to_jsonb(t)) from public.tickets t where t.order_id = v_order.id),
            '[]'::jsonb
        )
    );
end;
$$;

-- ============================================================================
-- Atomic check-in. Returns a state the scanner UI maps to green / amber / red.
-- ============================================================================
create or replace function public.check_in_ticket(p_qr_hash text)
returns jsonb
language plpgsql
as $$
declare
    v_ticket public.tickets%rowtype;
begin
    select * into v_ticket from public.tickets where qr_code_hash = p_qr_hash;

    if not found then
        return jsonb_build_object('status', 'invalid', 'ticket', null);
    end if;

    if v_ticket.is_used then
        return jsonb_build_object(
            'status', 'already_used',
            'ticket', to_jsonb(v_ticket)
        );
    end if;

    -- Guarded update: only one concurrent scan can flip is_used.
    update public.tickets
       set is_used = true, used_at = now()
     where id = v_ticket.id
       and is_used = false
    returning * into v_ticket;

    if v_ticket is null then
        -- Lost a race: re-read to report the exact used_at timestamp.
        select * into v_ticket from public.tickets where id = v_ticket.id;
        return jsonb_build_object('status', 'already_used', 'ticket', to_jsonb(v_ticket));
    end if;

    return jsonb_build_object('status', 'valid', 'ticket', to_jsonb(v_ticket));
end;
$$;

-- Server-only functions: never callable by browser roles.
revoke execute on function public.purchase_ticket(uuid, uuid, varchar, varchar, varchar) from anon, authenticated;
revoke execute on function public.issue_tickets_for_order(uuid) from anon, authenticated;
-- Check-in is a staff action, executed with the signed-in user's privileges.
revoke execute on function public.check_in_ticket(text) from anon;
grant execute on function public.check_in_ticket(text) to authenticated;

-- ============================================================================
-- Auto-provision public.users rows for new auth users
-- ============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.users (id, full_name, email, role)
    values (
        new.id,
        coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
        new.email,
        coalesce(nullif(new.raw_user_meta_data ->> 'role', ''), 'organizer')
    )
    on conflict (id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- ============================================================================
-- Row Level Security
-- ============================================================================
alter table public.users        enable row level security;
alter table public.events       enable row level security;
alter table public.ticket_types enable row level security;
alter table public.orders       enable row level security;
alter table public.tickets      enable row level security;

-- users: own row; admins read everyone.
drop policy if exists users_self_select on public.users;
create policy users_self_select on public.users
    for select using (id = auth.uid() or public.has_role(auth.uid(), '{admin}'));

drop policy if exists users_self_update on public.users;
create policy users_self_update on public.users
    for update using (id = auth.uid()) with check (id = auth.uid());

-- events: public read; organizers manage their own; admins/staff full read.
drop policy if exists events_public_select on public.events;
create policy events_public_select on public.events
    for select using (true);

drop policy if exists events_organizer_insert on public.events;
create policy events_organizer_insert on public.events
    for insert with check (organizer_id = auth.uid());

drop policy if exists events_organizer_update on public.events;
create policy events_organizer_update on public.events
    for update using (organizer_id = auth.uid()) with check (organizer_id = auth.uid());

drop policy if exists events_organizer_delete on public.events;
create policy events_organizer_delete on public.events
    for delete using (organizer_id = auth.uid());

-- ticket_types: public read; writes only via the parent event's organizer.
drop policy if exists ticket_types_public_select on public.ticket_types;
create policy ticket_types_public_select on public.ticket_types
    for select using (true);

drop policy if exists ticket_types_organizer_insert on public.ticket_types;
create policy ticket_types_organizer_insert on public.ticket_types
    for insert with check (
        exists (select 1 from public.events e where e.id = event_id and e.organizer_id = auth.uid())
    );

drop policy if exists ticket_types_organizer_update on public.ticket_types;
create policy ticket_types_organizer_update on public.ticket_types
    for update using (
        exists (select 1 from public.events e where e.id = event_id and e.organizer_id = auth.uid())
    ) with check (
        exists (select 1 from public.events e where e.id = event_id and e.organizer_id = auth.uid())
    );

drop policy if exists ticket_types_organizer_delete on public.ticket_types;
create policy ticket_types_organizer_delete on public.ticket_types
    for delete using (
        exists (select 1 from public.events e where e.id = event_id and e.organizer_id = auth.uid())
    );

-- orders: no anon access (fulfilled server-side with the service role key).
-- Organizers/staff/admins read orders for events they can manage.
drop policy if exists orders_staff_select on public.orders;
create policy orders_staff_select on public.orders
    for select using (
        public.has_role(auth.uid(), '{admin,staff}')
        or exists (select 1 from public.events e where e.id = event_id and e.organizer_id = auth.uid())
    );

-- tickets: same rule as orders.
drop policy if exists tickets_staff_select on public.tickets;
create policy tickets_staff_select on public.tickets
    for select using (
        public.has_role(auth.uid(), '{admin,staff}')
        or exists (select 1 from public.events e where e.id = event_id and e.organizer_id = auth.uid())
    );

-- ============================================================================
-- Demo data (safe to delete)
-- ============================================================================
insert into public.events (id, title, description, location, event_date, status)
values (
    '11111111-1111-1111-1111-111111111111',
    'Baghdad Tech Summit 2026',
    'A full-day conference on startups, software and the digital economy in Iraq.',
    'Baghdad International Fairground, Hall 2',
    now() + interval '30 days',
    'active'
) on conflict (id) do nothing;

insert into public.ticket_types (id, event_id, name, price, total_quantity)
values
    ('21111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'VIP', 150000, 100),
    ('31111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'General Admission', 25000, 500)
on conflict (id) do nothing;
