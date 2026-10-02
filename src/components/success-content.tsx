"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PDFDownloadLink } from "@react-pdf/renderer";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, Spinner } from "@/components/ui";
import { LocaleProvider } from "@/components/locale-provider";
import { TicketCard, type TicketDisplayData } from "@/components/ticket-card";
import { TicketPdf, type TicketPdfItem } from "@/components/ticket-pdf";
import { createTranslator, type Locale } from "@/lib/i18n";

interface OrderResponse {
  id: string;
  status: "pending" | "paid" | "failed" | "cancelled";
  quantity: number;
  total_amount: number | string;
  currency: string;
  events: { title: string; location: string; event_date: string } | null;
  ticket_types: { name: string } | null;
  tickets: {
    id: string;
    buyer_name: string;
    buyer_phone: string;
    qr_code_hash: string;
    is_used: boolean;
    used_at: string | null;
  }[];
}

function SuccessContent({ locale }: { locale: Locale }) {
  const t = useMemo(() => createTranslator(locale), [locale]);
  const reference = useSearchParams().get("ref");

  const orderQuery = useQuery<OrderResponse>({
    queryKey: ["order", reference],
    enabled: Boolean(reference),
    queryFn: async () => {
      const res = await fetch(`/api/orders/${reference}`, { cache: "no-store" });
      if (!res.ok) throw new Error(res.status === 404 ? t("success.notFound") : t("common.error"));
      const body = (await res.json()) as { order: OrderResponse };
      return body.order;
    },
    // Poll until the webhook fulfills the order; stop once terminal.
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && status !== "pending" ? false : 2_500;
    },
    retry: 1,
  });

  const order = orderQuery.data;
  const isPaid = order?.status === "paid";

  const tickets: TicketDisplayData[] = useMemo(() => {
    if (!order || !isPaid) return [];
    return (order.tickets ?? []).map((ticket) => ({
      id: ticket.id,
      buyerName: ticket.buyer_name,
      buyerPhone: ticket.buyer_phone,
      qrCodeHash: ticket.qr_code_hash,
      eventTitle: order.events?.title ?? "Event",
      eventLocation: order.events?.location ?? "",
      eventDate: order.events?.event_date ?? "",
      tierName: order.ticket_types?.name ?? "",
      isUsed: ticket.is_used,
      usedAt: ticket.used_at,
    }));
  }, [order, isPaid]);

  // QR data URLs reported by each TicketCard — reused for the combined PDF.
  const [qrUrls, setQrUrls] = useState<Record<string, string>>({});
  const onQrReady = (ticketId: string, dataUrl: string) => {
    setQrUrls((prev) => (prev[ticketId] ? prev : { ...prev, [ticketId]: dataUrl }));
  };

  const pdfItems: TicketPdfItem[] = useMemo(
    () =>
      tickets
        .filter((ticket) => qrUrls[ticket.id])
        .map((ticket) => ({
          ticketId: ticket.id,
          eventTitle: ticket.eventTitle,
          eventLocation: ticket.eventLocation,
          eventDate: new Date(ticket.eventDate).toLocaleString("en-GB", {
            year: "numeric",
            month: "short",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }),
          tierName: ticket.tierName,
          buyerName: ticket.buyerName,
          buyerPhone: ticket.buyerPhone,
          qrDataUrl: qrUrls[ticket.id],
        })),
    [tickets, qrUrls],
  );

  if (!reference) {
    return <Alert tone="error" title={t("success.notFound")} />;
  }

  if (!order) {
    if (orderQuery.isError) {
      return (
        <Alert tone="error" title={orderQuery.error instanceof Error ? orderQuery.error.message : t("common.error")}>
          <Link href="/" className="font-semibold underline">
            {t("events.backToEvents")}
          </Link>
        </Alert>
      );
    }
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-slate-500">
        <Spinner className="size-8" />
        <p className="text-sm">{t("common.loading")}</p>
      </div>
    );
  }

  if (!isPaid) {
    const terminal = order.status === "failed" || order.status === "cancelled";
    return (
      <div className="mx-auto max-w-md space-y-4 text-center">
        <Card className="flex flex-col items-center gap-3 py-10">
          {terminal ? (
            <Alert tone="warning" title={t("common.error")}>
              <Link href="/" className="font-semibold underline">
                {t("events.backToEvents")}
              </Link>
            </Alert>
          ) : (
            <>
              <Spinner className="size-8 text-brand-600" />
              <h1 className="text-lg font-bold text-slate-900">{t("success.waiting")}</h1>
              <p className="text-sm text-slate-500">{t("success.pendingHelp")}</p>
            </>
          )}
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="rounded-2xl bg-green-50 p-6 text-center ring-1 ring-green-200">
        <div className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-green-600 text-2xl text-white">✓</div>
        <h1 className="text-xl font-bold text-green-900 sm:text-2xl">{t("success.title")}</h1>
        <p className="mt-1 text-sm text-green-800">{t("success.subtitle")}</p>
        <p className="mt-3 text-xs font-medium text-green-700 ltr-nums" dir="ltr">
          {t("success.orderRef")}: {order.id}
        </p>
      </header>

      {pdfItems.length > 0 && (
        <div className="flex justify-center">
          <PDFDownloadLink
            document={<TicketPdf items={pdfItems} />}
            fileName={`tickets-${order.id.slice(0, 8)}.pdf`}
          >
            {({ loading, error }) => (
              <Button disabled={loading || Boolean(error)}>
                {error ? t("common.error") : t("success.downloadAll")}
              </Button>
            )}
          </PDFDownloadLink>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {tickets.map((ticket) => (
          <TicketCard
            key={ticket.id}
            ticket={ticket}
            filenameBase={(ticket.eventTitle.slice(0, 20) || "ticket").replace(/\s+/g, "-").toLowerCase()}
            onQrReady={onQrReady}
          />
        ))}
      </div>

      <p className="text-center">
        <Link href="/" className="text-sm font-medium text-brand-600 hover:text-brand-700">
          {t("events.backToEvents")}
        </Link>
      </p>
    </div>
  );
}

export function SuccessScreen({ locale }: { locale: Locale }) {
  return (
    <LocaleProvider locale={locale}>
      <Suspense
        fallback={
          <div className="py-16 text-center">
            <Spinner className="mx-auto size-8 text-slate-400" />
          </div>
        }
      >
        <SuccessContent locale={locale} />
      </Suspense>
    </LocaleProvider>
  );
}
