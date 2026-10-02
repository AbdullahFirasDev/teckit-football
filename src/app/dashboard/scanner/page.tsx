"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { QrScanner } from "@/components/qr-scanner";
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Spinner } from "@/components/ui";
import { useLocale } from "@/components/locale-provider";
import { useManagedEvents } from "@/lib/queries";
import { createClient } from "@/lib/supabase/client";
import { playChime } from "@/lib/chime";
import { formatDate, pct } from "@/lib/utils";
import type { CheckInStatus, TicketRow } from "@/lib/types";

interface ScanResult {
  status: CheckInStatus;
  ticket: TicketRow | null;
  at: number;
}

interface ScannerStats {
  sold: number;
  capacity: number;
  checkedIn: number;
  tierNameByTypeId: Record<string, string>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ScannerPage() {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const events = useManagedEvents();

  const [selectedEventId, setSelectedEventId] = useState<string>(searchParams.get("event") ?? "");
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [rpcError, setRpcError] = useState<string | null>(null);

  const cooldownRef = useRef(0);

  // Default to the first managed event once loaded.
  useEffect(() => {
    if (!selectedEventId && events.data && events.data.length > 0) {
      setSelectedEventId(events.data[0].id);
    }
  }, [events.data, selectedEventId]);

  const eventTitle = useMemo(
    () => events.data?.find((e) => e.id === selectedEventId)?.title ?? "",
    [events.data, selectedEventId],
  );

  // Live sold / checked-in counters for the selected event.
  const stats = useQuery<ScannerStats>({
    queryKey: ["scanner-stats", selectedEventId],
    enabled: Boolean(selectedEventId),
    queryFn: async () => {
      const supabase = createClient();
      const [typesRes, ticketsRes] = await Promise.all([
        supabase.from("ticket_types").select("id, name, sold_quantity, total_quantity").eq("event_id", selectedEventId!),
        supabase.from("tickets").select("is_used").eq("event_id", selectedEventId!),
      ]);
      if (typesRes.error) throw typesRes.error;
      if (ticketsRes.error) throw ticketsRes.error;

      const types = (typesRes.data ?? []) as { id: string; name: string; sold_quantity: number; total_quantity: number }[];
      const tickets = (ticketsRes.data ?? []) as { is_used: boolean }[];
      return {
        sold: types.reduce((sum, type) => sum + type.sold_quantity, 0),
        capacity: types.reduce((sum, type) => sum + type.total_quantity, 0),
        checkedIn: tickets.filter((row) => row.is_used).length,
        tierNameByTypeId: Object.fromEntries(types.map((type) => [type.id, type.name])),
      };
    },
    refetchInterval: 5_000,
  });

  /** Atomic check-in via the Postgres RPC; maps to green / amber / red. */
  const checkIn = useCallback(
    async (qrHash: string) => {
      // Debounce: the camera may fire several frames for the same code.
      if (Date.now() - cooldownRef.current < 2_500) return;
      cooldownRef.current = Date.now();
      setRpcError(null);

      const supabase = createClient();
      const { data, error } = await supabase.rpc("check_in_ticket", { p_qr_hash: qrHash });

      if (error) {
        setRpcError(error.message);
        playChime("error");
        return;
      }

      const payload = data as { status: CheckInStatus; ticket: TicketRow | null } | null;
      const status = payload?.status ?? "invalid";
      setResult({ status, ticket: payload?.ticket ?? null, at: Date.now() });
      playChime(status === "valid" ? "success" : "error");

      // Refresh live counters + any open event pages.
      void queryClient.invalidateQueries({ queryKey: ["scanner-stats", selectedEventId] });
      void queryClient.invalidateQueries({ queryKey: ["guest-list", selectedEventId] });
      void queryClient.invalidateQueries({ queryKey: ["overview"] });
    },
    [queryClient, selectedEventId],
  );

  const onCameraError = useCallback(() => setCameraError(true), []);
  const dismissResult = useCallback(() => setResult(null), []);

  // Manual fallback ----------------------------------------------------------

  const [manualQuery, setManualQuery] = useState("");
  const [manualRows, setManualRows] = useState<TicketRow[] | null>(null);
  const [manualBusy, setManualBusy] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  const searchManual = async (e: React.FormEvent) => {
    e.preventDefault();
    setManualError(null);
    setManualRows(null);
    if (!selectedEventId) return;

    const query = manualQuery.trim();
    const digits = query.replace(/\D/g, "");
    if (query.length < 4 && digits.length < 4) {
      setManualError(t("scanner.manualHint"));
      return;
    }

    setManualBusy(true);
    const supabase = createClient();
    let request = supabase
      .from("tickets")
      .select("*")
      .eq("event_id", selectedEventId)
      .limit(10);

    request = UUID_RE.test(query) ? request.eq("id", query) : request.like("buyer_phone", `%${digits.slice(-9)}%`);

    const { data, error } = await request;
    setManualBusy(false);

    if (error) {
      setManualError(t("common.error"));
      return;
    }
    setManualRows((data ?? []) as TicketRow[]);
  };

  const tierLabel = (ticket: TicketRow) => stats.data?.tierNameByTypeId[ticket.ticket_type_id] ?? "—";

  // Render -------------------------------------------------------------------

  if (events.isPending) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="size-8 text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{t("scanner.title")}</h1>
        <p className="mt-1 text-sm text-slate-500">{t("scanner.subtitle")}</p>
      </header>

      {events.data && events.data.length === 0 ? (
        <EmptyState title={t("dashboard.noEvents")} />
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
            <div className="space-y-4">
              <Card>
                <Field label={t("scanner.selectEvent")}>
                  <select
                    value={selectedEventId}
                    onChange={(e) => {
                      setSelectedEventId(e.target.value);
                      setCameraOn(false);
                      setResult(null);
                      setManualRows(null);
                    }}
                    className="block w-full rounded-lg border-0 bg-white px-3.5 py-2.5 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-brand-600"
                  >
                    {(events.data ?? []).map((event) => (
                      <option key={event.id} value={event.id}>
                        {event.title}
                      </option>
                    ))}
                  </select>
                </Field>
              </Card>

              {cameraError && <Alert tone="warning" title={t("scanner.cameraError")} />}
              {rpcError && <Alert tone="error" title={rpcError} />}

              <QrScanner active={cameraOn && Boolean(selectedEventId)} onScan={checkIn} onCameraError={onCameraError} />

              <div className="flex gap-2">
                {cameraOn ? (
                  <Button variant="danger" onClick={() => setCameraOn(false)}>
                    ⏹ {t("scanner.stop")}
                  </Button>
                ) : (
                  <Button onClick={() => { setCameraError(false); setCameraOn(true); }} disabled={!selectedEventId}>
                    ▶ {t("scanner.start")}
                  </Button>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <Card>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("dashboard.checkedIn")}</p>
                <p className="mt-2 text-3xl font-bold text-slate-900 ltr-nums" dir="ltr">
                  {stats.data?.checkedIn ?? 0} / {stats.data?.sold ?? 0}
                </p>
                <p className="mt-1 text-xs text-slate-500 ltr-nums" dir="ltr">
                  {t("dashboard.ticketsSold")}: {stats.data?.sold ?? 0} / {stats.data?.capacity ?? 0} ({pct(stats.data?.sold ?? 0, stats.data?.capacity ?? 0)}%)
                </p>
              </Card>

              <Card>
                <h2 className="text-sm font-bold text-slate-900">{t("scanner.manual")}</h2>
                <p className="mt-1 text-xs text-slate-500">{t("scanner.manualHint")}</p>
                <form onSubmit={searchManual} className="mt-3 space-y-3">
                  <Input
                    value={manualQuery}
                    onChange={(e) => setManualQuery(e.target.value)}
                    placeholder="+964 7XX… / ticket ID"
                    dir="ltr"
                  />
                  <Button type="submit" variant="secondary" className="w-full" loading={manualBusy} disabled={!selectedEventId}>
                    {t("scanner.search")}
                  </Button>
                </form>

                {manualError && (
                  <div className="mt-3">
                    <Alert tone="error" title={manualError} />
                  </div>
                )}

                {manualRows && manualRows.length === 0 && (
                  <div className="mt-3">
                    <Alert tone="warning" title={t("scanner.noResults")} />
                  </div>
                )}

                {manualRows && manualRows.length > 0 && (
                  <ul className="mt-3 space-y-2">
                    {manualRows.map((row) => (
                      <li key={row.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
                        <div className="min-w-0 text-sm">
                          <p className="truncate font-semibold text-slate-800">{row.buyer_name}</p>
                          <p className="truncate text-xs text-slate-500 ltr-nums" dir="ltr">
                            {row.buyer_phone} · {tierLabel(row)}
                          </p>
                        </div>
                        {row.is_used ? (
                          <Badge tone="slate">{t("tickets.statusUsed")}</Badge>
                        ) : (
                          <Button className="px-2.5 py-1.5 text-xs" onClick={() => checkIn(row.qr_code_hash)}>
                            {t("scanner.checkIn")}
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </div>
        </>
      )}

      {/* Full-screen scan result overlay */}
      {result && (
        <div
          className={`fixed inset-0 z-50 flex items-center justify-center p-6 ${
            result.status === "valid" ? "bg-green-600" : "bg-red-600"
          }`}
          role="alertdialog"
          aria-live="assertive"
        >
          <div className="w-full max-w-md space-y-4 text-center text-white">
            <div className="mx-auto grid size-20 place-items-center rounded-full bg-white/20 text-5xl">
              {result.status === "valid" ? "✓" : "✕"}
            </div>
            <h2 className="text-3xl font-black">
              {result.status === "valid"
                ? t("scanner.validTitle")
                : result.status === "already_used"
                  ? t("scanner.alreadyUsed")
                  : t("scanner.invalid")}
            </h2>

            {result.ticket && result.status !== "invalid" && (
              <div className="space-y-1 rounded-xl bg-black/20 p-4 text-start text-sm">
                <p>
                  <span className="opacity-70">{t("checkout.name")}: </span>
                  <strong>{result.ticket.buyer_name}</strong>
                </p>
                <p>
                  <span className="opacity-70">{t("dashboard.phone")}: </span>
                  <strong className="ltr-nums" dir="ltr">{result.ticket.buyer_phone}</strong>
                </p>
                <p>
                  <span className="opacity-70">{t("dashboard.ticketType")}: </span>
                  <strong>{tierLabel(result.ticket)}</strong>
                </p>
                {result.status === "already_used" && result.ticket.used_at && (
                  <p className="font-semibold">
                    {t("scanner.usedAt")}: <span className="ltr-nums">{formatDate(result.ticket.used_at)}</span>
                  </p>
                )}
                {eventTitle && <p className="pt-1 text-xs opacity-70">{eventTitle}</p>}
              </div>
            )}

            <Button variant="secondary" className="w-full" onClick={dismissResult}>
              {t("scanner.scanNext")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ScannerPageWrapper() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-16">
          <Spinner className="size-8 text-slate-400" />
        </div>
      }
    >
      <ScannerPage />
    </Suspense>
  );
}
