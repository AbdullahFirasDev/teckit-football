import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const referenceSchema = z.string().uuid();

/**
 * Order + issued tickets, fetched by the unguessable order reference (a UUID
 * that doubles as the Wayl referenceId). Polled by the success screen until
 * the webhook has fulfilled the order.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ reference: string }> },
) {
  const { reference } = await params;

  const parsed = referenceSchema.safeParse(reference);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid order reference." }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: order, error } = await admin
    .from("orders")
    .select(
      `*,
       events (id, title, location, event_date),
       ticket_types (id, name),
       tickets (*)
      `,
    )
    .eq("id", parsed.data)
    .single();

  if (error || !order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  return NextResponse.json(
    { order },
    { headers: { "Cache-Control": "no-store" } },
  );
}
