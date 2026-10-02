"use client";

import { useEffect, useRef, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { PDFDownloadLink } from "@react-pdf/renderer";
import { Badge, Button, Card } from "@/components/ui";
import { useLocale } from "@/components/locale-provider";
import { TicketPdf, type TicketPdfItem } from "@/components/ticket-pdf";
import { formatDate } from "@/lib/utils";

export interface TicketDisplayData {
  id: string;
  buyerName: string;
  buyerPhone: string;
  qrCodeHash: string;
  eventTitle: string;
  eventLocation: string;
  eventDate: string;
  tierName: string;
  isUsed: boolean;
  usedAt: string | null;
}

function toPdfItem(ticket: TicketDisplayData, qrDataUrl: string): TicketPdfItem {
  return {
    ticketId: ticket.id,
    eventTitle: ticket.eventTitle,
    eventLocation: ticket.eventLocation,
    eventDate: formatDate(ticket.eventDate),
    tierName: ticket.tierName,
    buyerName: ticket.buyerName,
    buyerPhone: ticket.buyerPhone,
    qrDataUrl,
  };
}

interface TicketCardProps {
  ticket: TicketDisplayData;
  filenameBase?: string;
  /** Called once the QR canvas is rendered and captured as a PNG data URL. */
  onQrReady?: (ticketId: string, dataUrl: string) => void;
}

export function TicketCard({ ticket, filenameBase, onQrReady }: TicketCardProps) {
  const { t } = useLocale();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const reportedRef = useRef(false);

  // Capture the rendered QR canvas as a PNG data URL for the PDF download.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || qrDataUrl) return;
    try {
      setQrDataUrl(canvas.toDataURL("image/png"));
    } catch {
      // Tainted canvas would only happen with cross-origin data — not our case.
    }
  }, [qrDataUrl]);

  useEffect(() => {
    if (qrDataUrl && onQrReady && !reportedRef.current) {
      reportedRef.current = true;
      onQrReady(ticket.id, qrDataUrl);
    }
  }, [qrDataUrl, onQrReady, ticket.id]);

  const pdfItem = qrDataUrl ? toPdfItem(ticket, qrDataUrl) : null;
  const filename = `${filenameBase ?? "ticket"}-${ticket.id.slice(0, 8)}.pdf`;

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-bold text-slate-900">{ticket.eventTitle}</h3>
          <p className="mt-0.5 text-sm text-slate-500">
            {formatDate(ticket.eventDate)} · {ticket.eventLocation}
          </p>
        </div>
        {ticket.isUsed ? (
          <Badge tone="slate">{t("tickets.statusUsed")}</Badge>
        ) : (
          <Badge tone="green">{t("tickets.statusValid")}</Badge>
        )}
      </div>

      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4">
        <QRCodeCanvas
          ref={canvasRef}
          value={ticket.qrCodeHash}
          size={180}
          marginSize={2}
          level="M"
          className="rounded-lg bg-white p-1"
        />
        <p className="text-center text-xs text-slate-400 ltr-nums" dir="ltr">
          {ticket.id}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <dt className="text-xs text-slate-500">{t("checkout.name")}</dt>
          <dd className="font-medium text-slate-800">{ticket.buyerName}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">{t("dashboard.phone")}</dt>
          <dd className="font-medium text-slate-800 ltr-nums" dir="ltr">{ticket.buyerPhone}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">{t("checkout.tier")}</dt>
          <dd className="font-medium text-slate-800">{ticket.tierName}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">{t("tickets.usedAt")}</dt>
          <dd className="font-medium text-slate-800">{ticket.usedAt ? formatDate(ticket.usedAt) : "—"}</dd>
        </div>
      </dl>

      {pdfItem ? (
        <PDFDownloadLink document={<TicketPdf items={[pdfItem]} />} fileName={filename}>
          {({ loading, error }) => (
            <Button className="w-full" variant="secondary" disabled={loading || Boolean(error)}>
              {error ? t("common.error") : t("tickets.download")}
            </Button>
          )}
        </PDFDownloadLink>
      ) : (
        <Button className="w-full" variant="secondary" disabled loading>
          {t("tickets.download")}
        </Button>
      )}
    </Card>
  );
}
