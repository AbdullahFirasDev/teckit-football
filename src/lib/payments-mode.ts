/**
 * TEMPORARY (mock checkout): switches the checkout flow while the Wayl
 * payment gateway is being bypassed for testing.
 *
 *   PAYMENTS_MODE=mock (default) → tickets are issued instantly with no
 *   payment via /api/payments/mock/checkout; the Wayl routes refuse requests.
 *   PAYMENTS_MODE=wayl           → restore the real integration unchanged.
 *
 * Remove this file (and the guards using it) when real payments go live.
 */
export type PaymentsMode = "mock" | "wayl";

export function getPaymentsMode(): PaymentsMode {
  return (process.env.PAYMENTS_MODE ?? "mock").trim().toLowerCase() === "wayl"
    ? "wayl"
    : "mock";
}

export function isMockCheckout(): boolean {
  return getPaymentsMode() === "mock";
}
