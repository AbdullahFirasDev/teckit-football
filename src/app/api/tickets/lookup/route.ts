import { NextResponse } from "next/server";
import { phoneLookupSchema, firstIssue } from "@/lib/validation";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * "My Tickets" — customers retrieve tickets by the phone number they used at
 * checkout (chosen auth model: no customer accounts). Returns only what is
 * needed to display/re-download a ticket.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = phoneLookupSchema.safeParse({ phone: url.searchParams.get("phone") ?? "" });

  if (!parsed.success) {
    return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  }

  const phone = parsed.data.phone.replace(/[\s-]/g, "");
  const admin = createAdminClient();

  // Normalize: match on digits only so +964/07xx variants still match.
  const digits = phone.replace(/\D/g, "").slice(-9);

  const { data, error } = await admin
    .from("tickets")
    .select(
      `id, buyer_name, buyer_phone, qr_code_hash, is_used, used_at, created_at,
       events (id, title, location, event_date),
       ticket_types (id, name, price)
      `,
    )
    .like("buyer_phone", `%${digits}%`)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("[tickets-lookup]", error);
    return NextResponse.json({ error: "Lookup failed." }, { status: 500 });
  }

  return NextResponse.json(
    { tickets: data ?? [] },
    { headers: { "Cache-Control": "no-store" } },
  );
}
