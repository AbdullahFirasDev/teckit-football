import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createTranslator } from "@/lib/i18n";
import { getServerLocale } from "@/lib/locale";
import { Badge, Card, EmptyState } from "@/components/ui";
import type { EventWithTickets } from "@/lib/types";
import { formatDate, formatMoney, pct } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function EventsPage() {
  const locale = await getServerLocale();
  const t = createTranslator(locale);

  const supabase = await createClient();
  const { data } = await supabase
    .from("events")
    .select("*, ticket_types(*)")
    .eq("status", "active")
    .gte("event_date", new Date().toISOString())
    .order("event_date", { ascending: true })
    .limit(50);

  const events = (data ?? []) as unknown as EventWithTickets[];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{t("events.title")}</h1>
        <p className="mt-1 text-sm text-slate-500">{t("events.subtitle")}</p>
      </header>

      {events.length === 0 ? (
        <EmptyState title={t("events.empty")} />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {events.map((event) => {
            const tiers = event.ticket_types ?? [];
            const available = tiers.filter((tier) => tier.total_quantity - tier.sold_quantity > 0);
            const fromPrice = available.length > 0 ? Math.min(...available.map((tier) => Number(tier.price))) : null;
            const soldOut = fromPrice === null;
            const remaining = tiers.reduce((sum, tier) => sum + Math.max(0, tier.total_quantity - tier.sold_quantity), 0);
            const capacity = tiers.reduce((sum, tier) => sum + tier.total_quantity, 0);

            return (
              <li key={event.id}>
                <Card className="flex h-full flex-col gap-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-brand-600 ltr-nums" dir="ltr">
                      {formatDate(event.event_date)}
                    </span>
                    {soldOut ? <Badge tone="red">{t("events.soldOut")}</Badge> : <Badge tone="green">{remaining} {t("event.remaining")}</Badge>}
                  </div>

                  <h2 className="text-lg font-bold leading-snug text-slate-900">
                    <Link href={`/events/${event.id}`} className="hover:text-brand-700">
                      {event.title}
                    </Link>
                  </h2>
                  <p className="text-sm text-slate-500">{event.location}</p>

                  <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                    <span className="text-sm text-slate-600">
                      {fromPrice !== null ? (
                        <>
                          {t("events.from")}{" "}
                          <strong className="text-slate-900 ltr-nums">{formatMoney(fromPrice)}</strong>
                        </>
                      ) : null}
                    </span>
                    <Link
                      href={`/events/${event.id}`}
                      className="rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
                    >
                      {t("events.viewDetails")}
                    </Link>
                  </div>

                  {capacity > 0 && (
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-brand-500" style={{ width: `${pct(capacity - remaining, capacity)}%` }} />
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
