import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isMockCheckout } from "@/lib/payments-mode";
import { createTranslator } from "@/lib/i18n";
import { getServerLocale } from "@/lib/locale";
import { Card } from "@/components/ui";
import { CheckoutForm } from "@/components/checkout-form";
import type { EventWithTickets, TicketTypeRow } from "@/lib/types";
import { formatDate, formatMoney } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const locale = await getServerLocale();
  const t = createTranslator(locale);

  const supabase = await createClient();
  const { data } = await supabase
    .from("events")
    .select("*, ticket_types(*)")
    .eq("id", id)
    .single();

  if (!data) notFound();
  const event = data as unknown as EventWithTickets;
  const tiers = (event.ticket_types ?? []) as TicketTypeRow[];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/" className="inline-block text-sm font-medium text-brand-600 hover:text-brand-700">
        ← {t("events.backToEvents")}
      </Link>

      <header className="space-y-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-brand-600 ltr-nums" dir="ltr">
          {formatDate(event.event_date)}
        </p>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{event.title}</h1>
        <p className="text-sm text-slate-500">
          📍 {event.location}
        </p>
      </header>

      {event.description && (
        <section>
          <h2 className="mb-2 text-base font-semibold text-slate-900">{t("event.what")}</h2>
          <p className="whitespace-pre-line text-sm leading-relaxed text-slate-600">{event.description}</p>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-base font-semibold text-slate-900">{t("event.tickets")}</h2>
        <ul className="space-y-3">
          {tiers.map((tier) => {
            const remaining = Math.max(0, tier.total_quantity - tier.sold_quantity);
            const soldOut = remaining === 0;
            return (
              <li key={tier.id}>
                <Card className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-900">{tier.name}</p>
                    <p className="text-sm text-slate-500 ltr-nums" dir="ltr">
                      {soldOut
                        ? t("events.soldOut")
                        : `${remaining} ${t("event.remaining")} · ${tier.total_quantity} total`}
                    </p>
                  </div>
                  <span className="text-lg font-bold text-slate-900 ltr-nums">{formatMoney(Number(tier.price))}</span>
                </Card>
              </li>
            );
          })}
        </ul>
      </section>

      <CheckoutForm
        mockCheckout={isMockCheckout()}
        tiers={tiers.map((tier) => ({
          id: tier.id,
          name: tier.name,
          price: Number(tier.price),
          remaining: Math.max(0, tier.total_quantity - tier.sold_quantity),
        }))}
      />
    </div>
  );
}
