import "server-only";

/**
 * Minimal server-side client for the Wayl Checkout API.
 * Docs: https://wayl.io/docs — base URL https://api.thewayl.com
 * Auth header: X-WAYL-AUTHENTICATION: <merchant token>
 */

export const WAYL_API_BASE = process.env.WAYL_API_BASE_URL ?? "https://api.thewayl.com";
export const WAYL_ENV = (process.env.WAYL_ENV ?? "test") as "test" | "live";
/** Wayl's API currently settles in IQD; USD is kept configurable for when it is enabled. */
export const WAYL_CURRENCY = process.env.WAYL_CURRENCY ?? "IQD";

export interface WaylLink {
  referenceId: string;
  id: string | null;
  code: string | null;
  url: string;
  status: string;
  total: string | number;
  currency: string;
}

export interface CreateWaylLinkInput {
  referenceId: string;
  /** Integer amount in IQD (Wayl's API takes whole units). */
  total: number;
  lineItems: { label: string; amount: number }[];
  webhookUrl: string;
  redirectionUrl: string;
}

export function isWaylConfigured(): boolean {
  return Boolean(process.env.WAYL_API_KEY && process.env.WAYL_WEBHOOK_SECRET);
}

function requireApiKey(): string {
  const key = process.env.WAYL_API_KEY;
  if (!key) {
    throw new Error("WAYL_API_KEY is not configured.");
  }
  return key;
}

async function waylRequest<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${WAYL_API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-WAYL-AUTHENTICATION": requireApiKey(),
      ...init.headers,
    },
    cache: "no-store",
  });

  const body = await res.json().catch(() => null);

  if (!res.ok) {
    const message =
      (body && typeof body === "object" && "message" in body && String(body.message)) ||
      `Wayl API request failed with status ${res.status}`;
    throw new Error(message);
  }

  return body as T;
}

/** Creates a Wayl payment link and returns the hosted checkout URL. */
export async function createWaylLink(input: CreateWaylLinkInput): Promise<WaylLink> {
  const payload = {
    env: WAYL_ENV,
    referenceId: input.referenceId,
    total: Math.round(input.total),
    currency: WAYL_CURRENCY,
    customParameter: "",
    lineItem: input.lineItems.map((item) => ({
      label: item.label,
      amount: Math.round(item.amount),
      type: "increase" as const,
    })),
    webhookUrl: input.webhookUrl,
    // Merchant-generated secret: Wayl signs webhook bodies with it; we verify
    // the x-wayl-signature-256 header on receipt.
    webhookSecret: process.env.WAYL_WEBHOOK_SECRET!,
    redirectionUrl: input.redirectionUrl,
  };

  const body = await waylRequest<{ data: WaylLink }>("/api/v1/links", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  if (!body?.data?.url) {
    throw new Error("Wayl did not return a checkout URL.");
  }
  return body.data;
}

/** Fetches the current lifecycle status of a link by our own reference id. */
export async function getWaylLink(referenceId: string): Promise<WaylLink | null> {
  const body = await waylRequest<{ data: WaylLink | null }>(
    `/api/v1/links/${encodeURIComponent(referenceId)}`,
    { method: "GET" },
  );
  return body?.data ?? null;
}
