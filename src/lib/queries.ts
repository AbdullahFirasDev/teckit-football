"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { EventRow, EventWithTickets, GuestRow, TicketTypeRow, UserRole } from "@/lib/types";

/**
 * Data hooks for the organizer dashboard.
 * All reads go through the browser client, so RLS is the single source of
 * truth for what an account may see: organizers see their own events' data,
 * admin/staff see everything.
 */

export interface Profile {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
}

async function fetchProfile(): Promise<Profile | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("users")
    .select("id, email, full_name, role")
    .eq("id", user.id)
    .single();

  if (error || !data) {
    // Auth user without a profile row (e.g. created before the trigger existed).
    return { id: user.id, email: user.email ?? "", fullName: user.email ?? "", role: "organizer" };
  }
  return {
    id: data.id,
    email: data.email,
    fullName: data.full_name,
    role: (data.role as UserRole) ?? "organizer",
  };
}

export function useProfile() {
  return useQuery<Profile | null>({ queryKey: ["profile"], queryFn: fetchProfile, staleTime: 60_000 });
}

/** Events the signed-in account manages: own events, or all for admin/staff. */
export function useManagedEvents(enabled = true) {
  return useQuery<EventRow[]>({
    queryKey: ["managed-events"],
    enabled,
    queryFn: async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("events")
        .select("*")
        .order("event_date", { ascending: true });
      const events = (data ?? []) as EventRow[];
      const profile = await fetchProfile();
      if (!profile) return [];
      if (profile.role === "organizer") {
        return events.filter((e) => e.organizer_id === profile.id);
      }
      return events;
    },
    staleTime: 15_000,
  });
}

export interface EventStats {
  eventId: string;
  title: string;
  revenue: number;
  sold: number;
  capacity: number;
  checkedIn: number;
}

export interface Overview {
  revenue: number;
  sold: number;
  capacity: number;
  checkedIn: number;
  perEvent: EventStats[];
}

/**
 * Aggregated KPIs across all managed events. Polled every 5s by the dashboard
 * for the "live" attendance counter.
 */
async function fetchOverview(profile: Profile): Promise<Overview> {
  const supabase = createClient();

  const { data: eventsData } = await supabase.from("events").select("id, organizer_id").order("event_date", { ascending: true });
  let eventIds = ((eventsData ?? []) as Pick<EventRow, "id" | "organizer_id">[]).map((e) => e.id);
  if (profile.role === "organizer") {
    const { data: own } = await supabase.from("events").select("id").eq("organizer_id", profile.id);
    eventIds = ((own ?? []) as { id: string }[]).map((e) => e.id);
  }
  if (eventIds.length === 0) return { revenue: 0, sold: 0, capacity: 0, checkedIn: 0, perEvent: [] };

  const [ordersRes, typesRes, ticketsRes] = await Promise.all([
    supabase.from("orders").select("event_id, total_amount").in("event_id", eventIds).eq("status", "paid"),
    supabase.from("ticket_types").select("event_id, price, sold_quantity, total_quantity").in("event_id", eventIds),
    supabase.from("tickets").select("event_id, is_used").in("event_id", eventIds),
  ]);
  if (ordersRes.error) throw ordersRes.error;
  if (typesRes.error) throw typesRes.error;
  if (ticketsRes.error) throw ticketsRes.error;

  const revenueByEvent = new Map<string, number>();
  for (const row of (ordersRes.data ?? []) as { event_id: string; total_amount: number | string }[]) {
    revenueByEvent.set(row.event_id, (revenueByEvent.get(row.event_id) ?? 0) + Number(row.total_amount));
  }

  const soldByEvent = new Map<string, { sold: number; capacity: number }>();
  for (const row of (typesRes.data ?? []) as { event_id: string; sold_quantity: number; total_quantity: number }[]) {
    const agg = soldByEvent.get(row.event_id) ?? { sold: 0, capacity: 0 };
    agg.sold += row.sold_quantity;
    agg.capacity += row.total_quantity;
    soldByEvent.set(row.event_id, agg);
  }

  const checkedInByEvent = new Map<string, number>();
  for (const row of (ticketsRes.data ?? []) as { event_id: string; is_used: boolean }[]) {
    if (row.is_used) checkedInByEvent.set(row.event_id, (checkedInByEvent.get(row.event_id) ?? 0) + 1);
  }

  // Titles alongside ids for the per-event breakdown rows.
  const { data: titled } = await supabase.from("events").select("id, title").in("id", eventIds);
  const titleById = new Map(((titled ?? []) as { id: string; title: string }[]).map((e) => [e.id, e.title]));

  const perEvent: EventStats[] = eventIds.map((eventId) => {
    const sold = soldByEvent.get(eventId) ?? { sold: 0, capacity: 0 };
    return {
      eventId,
      title: titleById.get(eventId) ?? eventId,
      revenue: revenueByEvent.get(eventId) ?? 0,
      sold: sold.sold,
      capacity: sold.capacity,
      checkedIn: checkedInByEvent.get(eventId) ?? 0,
    };
  });

  return {
    revenue: perEvent.reduce((sum, e) => sum + e.revenue, 0),
    sold: perEvent.reduce((sum, e) => sum + e.sold, 0),
    capacity: perEvent.reduce((sum, e) => sum + e.capacity, 0),
    checkedIn: perEvent.reduce((sum, e) => sum + e.checkedIn, 0),
    perEvent,
  };
}

export function useOverview(enabled: boolean) {
  const profile = useProfile();
  return useQuery<Overview>({
    queryKey: ["overview", profile.data?.id ?? "anon"],
    enabled: enabled && Boolean(profile.data),
    queryFn: () => fetchOverview(profile.data!),
    refetchInterval: 5_000, // live attendance
  });
}

/** Single event with its ticket tiers. */
export function useEventDetail(eventId: string | undefined, enabled = true) {
  return useQuery<EventWithTickets | null>({
    queryKey: ["event-detail", eventId],
    enabled: enabled && Boolean(eventId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("events")
        .select("*, ticket_types(*)")
        .eq("id", eventId!)
        .single();
      if (error) throw error;
      const event = data as unknown as EventWithTickets;
      event.ticket_types = (event.ticket_types ?? []) as TicketTypeRow[];
      return event;
    },
    refetchInterval: 5_000,
  });
}

/** Guest list: issued tickets joined to tier + originating order. */
export function useGuestList(eventId: string | undefined, enabled = true) {
  return useQuery<GuestRow[]>({
    queryKey: ["guest-list", eventId],
    enabled: enabled && Boolean(eventId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("tickets")
        .select(
          `id, buyer_name, buyer_phone, qr_code_hash, is_used, used_at, created_at,
           ticket_types (name),
           orders (total_amount, currency)
          `,
        )
        .eq("event_id", eventId!)
        .order("created_at", { ascending: false })
        .limit(2000);

      if (error) throw error;

      return ((data ?? []) as unknown as {
        id: string;
        buyer_name: string;
        buyer_phone: string;
        qr_code_hash: string;
        is_used: boolean;
        used_at: string | null;
        created_at: string;
        ticket_types: { name: string } | null;
        orders: { total_amount: number | string; currency: string } | null;
      }[]).map<GuestRow>((row) => ({
        id: row.id,
        buyer_name: row.buyer_name,
        buyer_phone: row.buyer_phone,
        ticket_type: row.ticket_types?.name ?? "—",
        qr_code_hash: row.qr_code_hash,
        is_used: row.is_used,
        used_at: row.used_at,
        created_at: row.created_at,
        order_total: Number(row.orders?.total_amount ?? 0),
        currency: row.orders?.currency ?? "IQD",
      }));
    },
    refetchInterval: 5_000, // live attendance on the event page too
  });
}
