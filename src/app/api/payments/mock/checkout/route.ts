import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { checkoutSchema, firstIssue } from "@/lib/validation";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMockCheckout } from "@/lib/payments-mode";

export const dynamic = "force-dynamic";

/**
 * TEMPORARY mock checkout — issues tickets instantly with no payment gateway.
 *
 * Flow (mirrors the Wayl webhook path so the rest of the app is unchanged):
 *   1. Validate + persist an order already marked `paid` (dashboards stay
 *      truthful; the id doubles as the success-page reference).
 *   2. Call the atomic `purchase_ticket` Postgres RPC once per unit — the same
 *      row-locked stock deduction + ticket insert the real flow uses — with a
 *      server-generated `crypto.randomUUID()` as the QR hash.
 *   3. Link the issued tickets to the order so the existing
 *      /tickets/success?ref=<order id> screen (QR, PDF) and reports work.
 *
 * Restore real payments with PAYMENTS_MODE=wayl.
 */
export async function POST(request: Request) {
  try {
    // Hard guard: this endpoint must never issue tickets once Wayl is live.
    if (!isMockCheckout()) {
      return NextResponse.json({ error: "Mock checkout is disabled." }, { status: 403 });
    }

    const parsed = checkoutSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const { ticketTypeId, quantity, buyerName, buyerPhone } = parsed.data;

    const admin = createAdminClient();

    // Load the tier + event; the RPC below re-checks stock atomically anyway,
    // but a friendly pre-check avoids creating doomed orders.
    const { data: ticketType, error: ttError } = await admin
      .from("ticket_types")
      .select("id, name, price, total_quantity, sold_quantity, event_id")
      .eq("id", ticketTypeId)
      .single();

    if (ttError || !ticketType) {
      return NextResponse.json({ error: "Ticket tier not found." }, { status: 404 });
    }

    const remaining = ticketType.total_quantity - ticketType.sold_quantity;
    if (remaining < quantity) {
      return NextResponse.json(
        { error: remaining <= 0 ? "Tickets are sold out." : `Only ${remaining} ticket(s) left.` },
        { status: 409 },
      );
    }

    const unitPrice = Number(ticketType.price);
    const totalAmount = Math.round(unitPrice * quantity);

    // 1. Order row already paid — `wayl_payment_method: "mock"` marks its origin.
    const { data: order, error: orderError } = await admin
      .from("orders")
      .insert({
        event_id: ticketType.event_id,
        ticket_type_id: ticketType.id,
        buyer_name: buyerName,
        buyer_phone: buyerPhone,
        quantity,
        unit_price: unitPrice,
        total_amount: totalAmount,
        currency: process.env.WAYL_CURRENCY ?? "IQD",
        status: "paid",
        paid_at: new Date().toISOString(),
        wayl_payment_method: "mock",
      })
      .select("id")
      .single();

    if (orderError || !order) {
      console.error("[mock-checkout] order insert failed:", orderError);
      return NextResponse.json({ error: "Could not complete checkout. Please try again." }, { status: 500 });
    }

    // 2. Issue one ticket per unit through the atomic RPC.
    const ticketIds: string[] = [];
    for (let i = 0; i < quantity; i++) {
      const { data: ticketId, error: issueError } = await admin.rpc("purchase_ticket", {
        p_ticket_type_id: ticketType.id,
        p_event_id: ticketType.event_id,
        p_buyer_name: buyerName,
        p_buyer_phone: buyerPhone,
        p_qr_hash: randomUUID(),
      });

      if (issueError || !ticketId) {
        // Roll the order back so reports don't count an unfulfilled purchase.
        await admin.from("orders").update({ status: "failed" }).eq("id", order.id);
        const soldOut = issueError?.message?.toLowerCase().includes("sold out");
        console.error("[mock-checkout] issuance failed:", issueError);
        return NextResponse.json(
          { error: soldOut ? "Tickets are sold out." : "Ticket issuance failed. Please try again." },
          { status: soldOut ? 409 : 500 },
        );
      }
      ticketIds.push(String(ticketId));
    }

    // 3. Link tickets to the order (orders API + guest list join on this).
    const { error: linkError } = await admin
      .from("tickets")
      .update({ order_id: order.id })
      .in("id", ticketIds);
    if (linkError) {
      // Tickets exist and are valid; only the join is missing. Don't fail the purchase.
      console.error("[mock-checkout] ticket->order link failed:", linkError);
    }

    return NextResponse.json({ referenceId: order.id, ticketIds });
  } catch (error) {
    console.error("[mock-checkout] unexpected error:", error);
    return NextResponse.json({ error: "Unexpected server error." }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed." }, { status: 405 });
}

// Keep zod import referenced for tree-shaking safety in edge builds.
void z;
