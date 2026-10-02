import { NextResponse } from "next/server";
import { z } from "zod";
import { checkoutSchema, firstIssue } from "@/lib/validation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createWaylLink, isWaylConfigured, WAYL_CURRENCY } from "@/lib/wayl/client";
import { isMockCheckout } from "@/lib/payments-mode";

export const dynamic = "force-dynamic";

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

export async function POST(request: Request) {
  try {
    // TEMPORARY (mock checkout): Wayl is bypassed while PAYMENTS_MODE=mock.
    // Restore the real flow by setting PAYMENTS_MODE=wayl.
    if (isMockCheckout()) {
      return NextResponse.json(
        { error: "Wayl checkout is temporarily disabled — mock checkout is active." },
        { status: 503 },
      );
    }

    if (!isWaylConfigured()) {
      return NextResponse.json(
        { error: "Payments are not configured yet. Please try again later." },
        { status: 503 },
      );
    }

    const parsed = checkoutSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const { ticketTypeId, quantity, buyerName, buyerPhone } = parsed.data;

    const admin = createAdminClient();

    // Load the tier + its event, and verify availability before charging.
    const { data: ticketType, error: ttError } = await admin
      .from("ticket_types")
      .select("id, name, price, total_quantity, sold_quantity, event_id, events(title)")
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
    const eventTitle =
      Array.isArray(ticketType.events) && ticketType.events[0]?.title
        ? String(ticketType.events[0].title)
        : "Event ticket";
    const tierLabel = `${eventTitle} — ${ticketType.name}`;

    // 1. Persist the order first; its id doubles as the Wayl referenceId so
    //    the webhook can correlate the payment without trusting metadata.
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
        currency: WAYL_CURRENCY,
        status: "pending",
      })
      .select("id")
      .single();

    if (orderError || !order) {
      console.error("[create-session] order insert failed:", orderError);
      return NextResponse.json({ error: "Could not start checkout. Please try again." }, { status: 500 });
    }

    // 2. Create the Wayl payment link.
    let link;
    try {
      link = await createWaylLink({
        referenceId: order.id,
        total: totalAmount,
        lineItems:
          quantity === 1
            ? [{ label: tierLabel, amount: totalAmount }]
            : [
                { label: `${ticketType.name} × ${quantity}`, amount: totalAmount },
              ],
        webhookUrl: `${BASE_URL}/api/payments/wayl/webhook`,
        redirectionUrl: `${BASE_URL}/tickets/success?ref=${order.id}`,
      });
    } catch (waylError) {
      // Roll the pending order back to `failed` so dashboards stay truthful.
      await admin.from("orders").update({ status: "failed" }).eq("id", order.id);
      console.error("[create-session] Wayl link creation failed:", waylError);
      return NextResponse.json({ error: "Payment provider is unavailable. Please try again." }, { status: 502 });
    }

    // 3. Stash Wayl identifiers for reconciliation.
    await admin
      .from("orders")
      .update({ wayl_link_id: link.id, wayl_code: link.code })
      .eq("id", order.id);

    return NextResponse.json({ checkoutUrl: link.url, referenceId: order.id });
  } catch (error) {
    console.error("[create-session] unexpected error:", error);
    return NextResponse.json({ error: "Unexpected server error." }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed." }, { status: 405 });
}

// Keep zod import referenced for tree-shaking safety in edge builds.
void z;
