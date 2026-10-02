"use client";

import { useState } from "react";
import { Alert, Button, Card, EmptyState, Field, Input, Spinner } from "@/components/ui";
import { LocaleProvider } from "@/components/locale-provider";
import { TicketCard, type TicketDisplayData } from "@/components/ticket-card";
import { createTranslator, type Locale } from "@/lib/i18n";
import { phoneLookupSchema, firstIssue } from "@/lib/validation";

interface LookupTicket {
  id: string;
  buyer_name: string;
  buyer_phone: string;
  qr_code_hash: string;
  is_used: boolean;
  used_at: string | null;
  created_at: string;
  events: { title: string; location: string; event_date: string } | null;
  ticket_types: { name: string } | null;
}

function MyTickets({ locale }: { locale: Locale }) {
  const t = createTranslator(locale);
  const [phone, setPhone] = useState("");
  const [tickets, setTickets] = useState<TicketDisplayData[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const parsed = phoneLookupSchema.safeParse({ phone });
    if (!parsed.success) {
      setError(firstIssue(parsed.error));
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/tickets/lookup?phone=${encodeURIComponent(parsed.data.phone)}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error();
      const body = (await res.json()) as { tickets: LookupTicket[] };

      setTickets(
        body.tickets.map((row) => ({
          id: row.id,
          buyerName: row.buyer_name,
          buyerPhone: row.buyer_phone,
          qrCodeHash: row.qr_code_hash,
          eventTitle: row.events?.title ?? "Event",
          eventLocation: row.events?.location ?? "",
          eventDate: row.events?.event_date ?? "",
          tierName: row.ticket_types?.name ?? "",
          isUsed: row.is_used,
          usedAt: row.used_at,
        })),
      );
    } catch {
      setError(t("common.error"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{t("tickets.mine")}</h1>
        <p className="mt-1 text-sm text-slate-500">{t("tickets.mineHint")}</p>
      </header>

      <Card>
        <form onSubmit={search} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Field label={t("checkout.phone")}>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                type="tel"
                inputMode="tel"
                dir="ltr"
                required
                placeholder="+964 7XX XXX XXXX"
              />
            </Field>
          </div>
          <Button type="submit" loading={loading} className="sm:w-auto">
            {t("tickets.find")}
          </Button>
        </form>
      </Card>

      {error && <Alert tone="error" title={error} />}

      {loading && <Spinner className="mx-auto size-8 text-slate-400" />}

      {!loading && tickets && tickets.length === 0 && <EmptyState title={t("tickets.none")} />}

      {!loading && tickets && tickets.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {tickets.map((ticket) => (
            <TicketCard
              key={ticket.id}
              ticket={ticket}
              filenameBase={(ticket.eventTitle.slice(0, 20) || "ticket").replace(/\s+/g, "-").toLowerCase()}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function MyTicketsScreen({ locale }: { locale: Locale }) {
  return (
    <LocaleProvider locale={locale}>
      <MyTickets locale={locale} />
    </LocaleProvider>
  );
}
