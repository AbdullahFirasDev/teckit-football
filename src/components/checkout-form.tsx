"use client";

import { useState } from "react";
import { Alert, Button, Card, Field, Input } from "@/components/ui";
import { useLocale } from "@/components/locale-provider";
import { formatMoney } from "@/lib/utils";
import { checkoutSchema, firstIssue } from "@/lib/validation";

export interface CheckoutTier {
  id: string;
  name: string;
  price: number;
  remaining: number;
}

interface CheckoutFormProps {
  tiers: CheckoutTier[];
  /** TEMPORARY: when true, POST to the mock checkout (no payment gateway). */
  mockCheckout?: boolean;
}

export function CheckoutForm({ tiers, mockCheckout = false }: CheckoutFormProps) {
  const { t } = useLocale();
  const purchasable = tiers.filter((tier) => tier.remaining > 0);

  const [tierId, setTierId] = useState(purchasable[0]?.id ?? "");
  const [quantity, setQuantity] = useState(1);
  const [buyerName, setBuyerName] = useState("");
  const [buyerPhone, setBuyerPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selectedTier = purchasable.find((tier) => tier.id === tierId) ?? null;
  const maxQuantity = selectedTier ? Math.min(10, selectedTier.remaining) : 1;
  const total = selectedTier ? selectedTier.price * quantity : 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const parsed = checkoutSchema.safeParse({
      ticketTypeId: tierId,
      quantity,
      buyerName,
      buyerPhone,
    });
    if (!parsed.success) {
      setError(firstIssue(parsed.error));
      return;
    }

    setSubmitting(true);
    try {
      const endpoint = mockCheckout
        ? "/api/payments/mock/checkout"
        : "/api/payments/wayl/create-session";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const body = (await res.json().catch(() => null)) as {
        checkoutUrl?: string;
        referenceId?: string;
        error?: string;
      } | null;

      if (mockCheckout) {
        // Tickets are already issued — go straight to the success screen.
        if (!res.ok || !body?.referenceId) {
          setError(body?.error ?? t("common.error"));
          setSubmitting(false);
          return;
        }
        window.location.assign(`/tickets/success?ref=${body.referenceId}`);
        return;
      }

      if (!res.ok || !body?.checkoutUrl) {
        setError(body?.error ?? t("common.error"));
        setSubmitting(false);
        return;
      }

      // Hand off to Wayl's hosted checkout; it redirects back to /tickets/success.
      window.location.assign(body.checkoutUrl);
    } catch {
      setError(t("common.error"));
      setSubmitting(false);
    }
  };

  if (purchasable.length === 0) {
    return (
      <Card>
        <p className="text-center text-sm font-semibold text-slate-700">{t("events.soldOut")}</p>
      </Card>
    );
  }

  return (
    <Card>
      <h2 className="mb-4 text-base font-semibold text-slate-900">{t("checkout.title")}</h2>

      {mockCheckout && (
        <div className="mb-4">
          <Alert tone="warning" title={t("checkout.mockBanner")} />
        </div>
      )}

      <form onSubmit={submit} className="space-y-4">
        <Field label={t("checkout.tier")}>
          <select
            className="block w-full rounded-lg border-0 bg-white px-3.5 py-2.5 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-brand-600"
            value={tierId}
            onChange={(e) => {
              setTierId(e.target.value);
              setQuantity(1);
            }}
          >
            {purchasable.map((tier) => (
              <option key={tier.id} value={tier.id}>
                {tier.name} — {formatMoney(tier.price)} ({tier.remaining} {t("event.remaining")})
              </option>
            ))}
          </select>
        </Field>

        <Field label={t("checkout.quantity")}>
          <select
            className="block w-full rounded-lg border-0 bg-white px-3.5 py-2.5 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-brand-600"
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
          >
            {Array.from({ length: maxQuantity }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t("checkout.name")}>
          <Input
            value={buyerName}
            onChange={(e) => setBuyerName(e.target.value)}
            autoComplete="name"
            required
            placeholder="Ahmed Ali"
          />
        </Field>

        <Field label={t("checkout.phone")} hint={t("checkout.phoneHint")}>
          <Input
            value={buyerPhone}
            onChange={(e) => setBuyerPhone(e.target.value)}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            required
            dir="ltr"
            placeholder="+964 7XX XXX XXXX"
          />
        </Field>

        <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
          <span className="text-sm font-medium text-slate-600">{t("checkout.total")}</span>
          <span className="text-xl font-bold text-slate-900 ltr-nums">{formatMoney(total)}</span>
        </div>

        {error && <Alert tone="error" title={error} />}

        <Button type="submit" className="w-full" loading={submitting}>
          {mockCheckout ? t("checkout.payMock") : t("checkout.pay")}
        </Button>

        <p className="text-center text-xs text-slate-500">
          {mockCheckout ? t("checkout.mockNote") : t("checkout.payNote")}
        </p>
      </form>
    </Card>
  );
}
