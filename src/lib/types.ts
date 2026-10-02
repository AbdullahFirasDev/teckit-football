export type UserRole = "admin" | "organizer" | "staff";
export type EventStatus = "active" | "cancelled" | "completed";
export type OrderStatus = "pending" | "paid" | "failed" | "cancelled";
export type CheckInStatus = "valid" | "already_used" | "invalid";

export interface AppUser {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  created_at: string;
}

export interface EventRow {
  id: string;
  organizer_id: string | null;
  title: string;
  description: string | null;
  location: string;
  event_date: string;
  status: EventStatus;
  created_at: string;
}

export interface TicketTypeRow {
  id: string;
  event_id: string;
  name: string;
  price: number | string;
  total_quantity: number;
  sold_quantity: number;
  created_at: string;
}

export interface OrderRow {
  id: string;
  event_id: string;
  ticket_type_id: string;
  buyer_name: string;
  buyer_phone: string;
  quantity: number;
  unit_price: number | string;
  total_amount: number | string;
  currency: string;
  status: OrderStatus;
  wayl_link_id: string | null;
  wayl_code: string | null;
  wayl_payment_method: string | null;
  paid_at: string | null;
  created_at: string;
}

export interface TicketRow {
  id: string;
  ticket_type_id: string;
  event_id: string;
  order_id: string | null;
  buyer_name: string;
  buyer_phone: string;
  qr_code_hash: string;
  is_used: boolean;
  used_at: string | null;
  created_at: string;
}

/** Shape returned by the `check_in_ticket` RPC. */
export interface CheckInResult {
  status: CheckInStatus;
  ticket: TicketRow | null;
}

export interface EventWithTickets extends EventRow {
  ticket_types: TicketTypeRow[];
}

/** Denormalized view used by the dashboard guest list. */
export interface GuestRow {
  id: string;
  buyer_name: string;
  buyer_phone: string;
  ticket_type: string;
  qr_code_hash: string;
  is_used: boolean;
  used_at: string | null;
  created_at: string;
  order_total: number | string;
  currency: string;
}
