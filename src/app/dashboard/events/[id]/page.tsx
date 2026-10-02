"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEventDetail, useGuestList } from "@/lib/queries";
import { useLocale } from "@/components/locale-provider";
import { Alert, Badge, Button, Card, EmptyState, Field, Input, ProgressBar, Spinner } from "@/components/ui";
import { ticketTypeFormSchema, firstIssue } from "@/lib/validation";
import { createClient } from "@/lib/supabase/client";
import { downloadTextFile, slugify } from "@/lib/download";
import { toCsv, formatDate, formatMoney, pct } from "@/lib/utils";
import type { GuestRow } from "@/lib/types";

export default function ManageEventPage() {
  const { t } = useLocale();
  const params = useParams<{ id: string }>();
  const eventId = params?.id;
  const queryClient = useQueryClient();

  const event = useEventDetail(eventId);
  const guests = useGuestList(eventId);

  const [tierName, setTierName] = useState("");
  const [price, setPrice] = useState("");
  const [totalQty, setTotalQty] = useState("");
  const [tierError, setTierError] = useState<string | null>(null);

  const addTier = useMutation({
    mutationFn: async () => {
      const parsed = ticketTypeFormSchema.safeParse({
        eventId,
        name: tierName,
        price: Number(price),
        totalQuantity: Number(totalQty),
      });
      if (!parsed.success) throw new Error(firstIssue(parsed.error));

      const supabase = createClient();
      const { error } = await supabase.from("ticket_types").insert({
        event_id: eventId,
        name: parsed.data.name,
        price: parsed.data.price,
        total_quantity: parsed.data.totalQuantity,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      setTierName("");
      setPrice("");
      setTotalQty("");
      void queryClient.invalidateQueries({ queryKey: ["event-detail", eventId] });
    },
    onError: (err: Error) => setTierError(err.message),
  });

  const updateStatus = useMutation({
    mutationFn: async (status: string) => {
      const supabase = createClient();
      const { error } = await supabase.from("events").update({ status }).eq("id", eventId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["event-detail", eventId] }),
  });

  if (event.isPending || guests.isPending) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="size-8 text-slate-400" />
      </div>
    );
  }

  if (event.isError || !event.data) {
    return <Alert tone="error" title={event.error instanceof Error ? event.error.message : t("common.error")} />;
  }

  const tiers = event.data.ticket_types ?? [];
  const guestRows = guests.data ?? [];

  const revenue = guestRows.reduce((sum, g) => sum + Number(g.order_total || 0), 0);
  const sold = tiers.reduce((sum, tier) => sum + tier.sold_quantity, 0);
  const capacity = tiers.reduce((sum, tier) => sum + tier.total_quantity, 0);
  const checkedIn = guestRows.filter((g) => g.is_used).length;

  const exportCsv = () => {
    const csv = toCsv<GuestRow>(guestRows, [
      { header: "Guest", value: (g) => g.buyer_name },
      { header: "Phone", value: (g) => g.buyer_phone },
      { header: "Tier", value: (g) => g.ticket_type },
      { header: "Ticket ID", value: (g) => g.id },
      { header: "Status", value: (g) => (g.is_used ? "checked-in" : "valid") },
      { header: "Checked in at", value: (g) => (g.used_at ? formatDate(g.used_at) : "") },
      { header: "Issued at", value: (g) => formatDate(g.created_at) },
      { header: "Order total", value: (g) => Number(g.order_total || 0) },
      { header: "Currency", value: (g) => g.currency },
    ]);
    downloadTextFile(`guests-${slugify(event.data!.title)}.csv`, csv);
  };

  return (
    <div className="space-y-6">
      <Link href="/dashboard/events" className="inline-block text-sm font-medium text-brand-600 hover:text-brand-700">
        ← {t("dashboard.backToEvents")}
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">{event.data.title}</h1>
            <select
              value={event.data.status}
              onChange={(e) => updateStatus.mutate(e.target.value)}
              className="rounded-full border-0 bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 ring-1 ring-inset ring-slate-200"
              aria-label={t("dashboard.status")}
            >
              <option value="active">active</option>
              <option value="completed">completed</option>
              <option value="cancelled">cancelled</option>
            </select>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            <span className="ltr-nums" dir="ltr">{formatDate(event.data.event_date)}</span> · {event.data.location}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/dashboard/scanner?event=${event.data.id}`}
            className="rounded-lg bg-green-600 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-green-700"
          >
            {t("dashboard.scanner")}
          </Link>
          <Button variant="secondary" onClick={exportCsv} disabled={guestRows.length === 0}>
            {t("dashboard.exportCsv")}
          </Button>
        </div>
      </header>

      {/* KPI strip */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("dashboard.revenue")}</p>
          <p className="mt-2 text-3xl font-bold text-slate-900 ltr-nums" dir="ltr">{formatMoney(revenue)}</p>
        </Card>
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("dashboard.ticketsSold")}</p>
          <p className="mt-2 text-3xl font-bold text-slate-900 ltr-nums" dir="ltr">{sold} / {capacity}</p>
          <div className="mt-3">
            <ProgressBar value={pct(sold, capacity)} />
          </div>
        </Card>
        <Card>
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("dashboard.checkedIn")}</p>
            <Badge tone="green">
              <span className="me-1 inline-block size-1.5 animate-pulse rounded-full bg-green-600" aria-hidden />
              {t("dashboard.live")}
            </Badge>
          </div>
          <p className="mt-2 text-3xl font-bold text-slate-900 ltr-nums" dir="ltr">{checkedIn} / {sold}</p>
          <div className="mt-3">
            <ProgressBar value={pct(checkedIn, sold)} tone="green" />
          </div>
        </Card>
      </div>

      {/* Tier sales summary */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-slate-900">{t("dashboard.sales")}</h2>
        {tiers.length === 0 ? (
          <EmptyState title={t("dashboard.addTier")} />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {tiers.map((tier) => {
              const remaining = Math.max(0, tier.total_quantity - tier.sold_quantity);
              return (
                <li key={tier.id}>
                  <Card className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-slate-900">{tier.name}</p>
                      <span className="text-sm font-bold text-slate-900 ltr-nums">{formatMoney(Number(tier.price))}</span>
                    </div>
                    <ProgressBar value={pct(tier.sold_quantity, tier.total_quantity)} />
                    <p className="text-xs text-slate-500 ltr-nums" dir="ltr">
                      {tier.sold_quantity} / {tier.total_quantity} · {t("dashboard.remaining")}: {remaining}
                    </p>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Add tier */}
      <Card>
        <h2 className="mb-4 text-base font-semibold text-slate-900">{t("dashboard.addTier")}</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setTierError(null);
            addTier.mutate();
          }}
          className="grid gap-4 sm:grid-cols-3"
        >
          <Field label={t("dashboard.tierName")}>
            <Input value={tierName} onChange={(e) => setTierName(e.target.value)} required placeholder="VIP" minLength={2} />
          </Field>
          <Field label={t("dashboard.price")}>
            <Input
              type="number"
              min={0}
              step="1000"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              required
              dir="ltr"
              className="ltr-nums"
            />
          </Field>
          <Field label={t("dashboard.totalQty")}>
            <Input
              type="number"
              min={1}
              step="1"
              value={totalQty}
              onChange={(e) => setTotalQty(e.target.value)}
              required
              dir="ltr"
              className="ltr-nums"
            />
          </Field>
          {tierError && (
            <div className="sm:col-span-3">
              <Alert tone="error" title={tierError} />
            </div>
          )}
          <div className="sm:col-span-3">
            <Button type="submit" loading={addTier.isPending}>
              {t("dashboard.save")}
            </Button>
          </div>
        </form>
      </Card>

      {/* Guest list */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-900">
            {t("dashboard.guestList")} <span className="text-sm font-normal text-slate-500">({guestRows.length})</span>
          </h2>
        </div>

        {guestRows.length === 0 ? (
          <EmptyState title={t("scanner.noResults")} />
        ) : (
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-start text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3 text-start font-semibold">{t("dashboard.guest")}</th>
                  <th className="px-4 py-3 text-start font-semibold">{t("dashboard.phone")}</th>
                  <th className="px-4 py-3 text-start font-semibold">{t("dashboard.ticketType")}</th>
                  <th className="px-4 py-3 text-start font-semibold">{t("dashboard.status")}</th>
                  <th className="px-4 py-3 text-end font-semibold">{t("dashboard.total")}</th>
                </tr>
              </thead>
              <tbody>
                {guestRows.map((guest) => (
                  <tr key={guest.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3 font-medium text-slate-800">{guest.buyer_name}</td>
                    <td className="px-4 py-3 text-slate-600 ltr-nums" dir="ltr">{guest.buyer_phone}</td>
                    <td className="px-4 py-3 text-slate-600">{guest.ticket_type}</td>
                    <td className="px-4 py-3">
                      {guest.is_used ? (
                        <Badge tone="slate">
                          {t("tickets.statusUsed")} · <span className="ltr-nums">{guest.used_at ? formatDate(guest.used_at) : ""}</span>
                        </Badge>
                      ) : (
                        <Badge tone="green">{t("tickets.statusValid")}</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-end font-semibold text-slate-800 ltr-nums" dir="ltr">
                      {formatMoney(Number(guest.order_total || 0), guest.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>
    </div>
  );
}
