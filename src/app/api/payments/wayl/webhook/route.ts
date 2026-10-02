import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyWaylSignature, isWaylPaid, isWaylFailed } from "@/lib/wayl/verify";
import { isMockCheckout } from "@/lib/payments-mode";

export const dynamic = "force-dynamic";

/**
 * Wayl webhook — the moment of instant ticket issuance.
 *
 * Security: Wayl signs the raw request body with the `webhookSecret` we passed
 * when creating the link. We recompute HMAC-SHA256 over the exact bytes and
 * compare (constant-time) against the `x-wayl-signature-256` header.
 *
 * Idempotency: Wayl retries on error/timeout; `issue_tickets_for_order` is
 * transactional and returns already-issued tickets if the order is fulfilled,
 * so duplicate deliveries never double-issue or oversell.
 */
export async function POST(request: Request) {
  // TEMPORARY (mock checkout): no Wayl links are created in mock mode, so any
  // delivery here is stale. Ack 200 to stop retries without touching data.
  // Restore real fulfillment by setting PAYMENTS_MODE=wayl.
  if (isMockCheckout()) {
    return NextResponse.json({ received: true, note: "wayl disabled (mock checkout active)" });
  }

  const secret = process.env.WAYL_WEBHOOK_SECRET;

  try {
    const rawBody = await request.text();

    if (!secret || !verifyWaylSignature(rawBody, request.headers.get("x-wayl-signature-256"), secret)) {
      console.warn("[wayl-webhook] signature verification failed");
      return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
    }

    const payload = JSON.parse(rawBody) as {
      event?: string;
      referenceId?: string;
      paymentStatus?: string;
      paymentMethod?: string;
      status?: string;
    };

    const referenceId = payload.referenceId;
    if (!referenceId) {
      return NextResponse.json({ error: "Missing referenceId." }, { status: 400 });
    }

    // Resolve the lifecycle state from whatever fields this delivery carries.
    const effectiveStatus = payload.status ?? payload.paymentStatus ?? payload.event ?? "";
    const paid = isWaylPaid(effectiveStatus);
    const failed = isWaylFailed(effectiveStatus);

    const admin = createAdminClient();
    const { data: order, error: orderError } = await admin
      .from("orders")
      .select("id, status")
      .eq("id", referenceId)
      .single();

    if (orderError || !order) {
      // Unknown reference: ack 200 so Wayl stops retrying, but log loudly.
      console.error("[wayl-webhook] order not found for reference:", referenceId);
      return NextResponse.json({ received: true, note: "unknown reference" });
    }

    if (paid) {
      // Atomic + idempotent issuance inside Postgres.
      const { error: issueError } = await admin.rpc("issue_tickets_for_order", {
        p_order_id: order.id,
      });

      if (issueError) {
        console.error("[wayl-webhook] issuance failed:", issueError);
        // Non-2xx makes Wayl retry with the same payload — exactly what we
        // want for transient failures (e.g. temporary contention).
        return NextResponse.json({ error: "Issuance failed; will retry." }, { status: 500 });
      }

      console.info("[wayl-webhook] tickets issued for order:", order.id);
      return NextResponse.json({ received: true, status: "issued" });
    }

    if (failed && order.status === "pending") {
      await admin.from("orders").update({ status: "cancelled" }).eq("id", order.id);
      return NextResponse.json({ received: true, status: "cancelled" });
    }

    // Pending / processing events: nothing to do yet.
    return NextResponse.json({ received: true, status: "ignored" });
  } catch (error) {
    console.error("[wayl-webhook] unexpected error:", error);
    // 200-with-error would tell Wayl "handled"; use 500 so it retries.
    return NextResponse.json({ error: "Unexpected server error." }, { status: 500 });
  }
}
