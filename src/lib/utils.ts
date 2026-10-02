import { clsx, type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

/** Formats an amount for display. IQD has no minor unit — render whole dinars. */
export function formatMoney(amount: number | string, currency = "IQD"): string {
  const value = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(value)) return `0 ${currency}`;
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 0 })} ${currency}`;
}

export function formatDate(value: string | Date, withTime = true): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
  });
}

export type CsvColumn<T> = { header: string; value: (row: T) => string | number | null | undefined };

/** Builds RFC 4180-compatible CSV content (quotes escaped, BOM for Excel/UTF-8). */
export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const escape = (raw: string | number | null | undefined) => {
    const s = raw === null || raw === undefined ? "" : String(raw);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    columns.map((c) => escape(c.header)).join(","),
    ...rows.map((row) => columns.map((c) => escape(c.value(row))).join(",")),
  ];
  return "\uFEFF" + lines.join("\r\n");
}

export function pct(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((part / total) * 100));
}
