"use client";

import Link from "next/link";
import { useProfile, useOverview } from "@/lib/queries";
import { useLocale } from "@/components/locale-provider";
import { Badge, Card, EmptyState, ProgressBar, Spinner } from "@/components/ui";
import { formatMoney, pct } from "@/lib/utils";

export default function DashboardOverviewPage() {
  const { t } = useLocale();
  const profile = useProfile();
  const overview = useOverview(Boolean(profile.data) && !profile.isLoading);

  if (profile.isLoading || overview.isPending) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="size-8 text-slate-400" />
      </div>
    );
  }

  if (!profile.data) {
    return <EmptyState title={t("common.error")} />;
  }

  const data = overview.data ?? { revenue: 0, sold: 0, capacity: 0, checkedIn: 0, perEvent: [] };

  const kpis = [
    { label: t("dashboard.revenue"), value: formatMoney(data.revenue) },
    { label: t("dashboard.ticketsSold"), value: `${data.sold} / ${data.capacity}` },
    { label: t("dashboard.checkedIn"), value: `${data.checkedIn} / ${data.sold}` },
  ];

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">{t("dashboard.overview")}</h1>
          <p className="mt-1 text-sm text-slate-500">{t("dashboard.subtitle")}</p>
        </div>
        <Badge tone="green">
          <span className="me-1 inline-block size-1.5 animate-pulse rounded-full bg-green-600" aria-hidden />
          {t("dashboard.live")}
        </Badge>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        {kpis.map((kpi) => (
          <Card key={kpi.label} className="text-center sm:text-start">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{kpi.label}</p>
            <p className="mt-2 text-3xl font-bold text-slate-900 ltr-nums" dir="ltr">
              {kpi.value}
            </p>
          </Card>
        ))}
      </div>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-slate-900">{t("dashboard.events")}</h2>
        {data.perEvent.length === 0 ? (
          <EmptyState title={t("dashboard.noEvents")}>
            <Link href="/dashboard/events" className="font-semibold text-brand-600 hover:text-brand-700">
              {t("dashboard.newEvent")}
            </Link>
          </EmptyState>
        ) : (
          <ul className="space-y-3">
            {data.perEvent.map((event) => (
              <li key={event.eventId}>
                <Card className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-slate-900">{event.title}</p>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-bold text-slate-900 ltr-nums">{formatMoney(event.revenue)}</span>
                      <Link href={`/dashboard/events/${event.eventId}`} className="text-brand-600 hover:text-brand-700">
                        {t("dashboard.manage")} →
                      </Link>
                    </div>
                  </div>
                  <ProgressBar value={pct(event.sold, event.capacity)} />
                  <div className="flex flex-wrap justify-between gap-2 text-xs text-slate-500">
                    <span className="ltr-nums" dir="ltr">
                      {t("dashboard.ticketsSold")}: {event.sold} / {event.capacity}
                    </span>
                    <span className="ltr-nums" dir="ltr">
                      {t("dashboard.checkedIn")}: {event.checkedIn} / {event.sold}
                    </span>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
