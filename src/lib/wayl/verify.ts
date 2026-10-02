import crypto from "crypto";

/**
 * Verifies Wayl's `x-wayl-signature-256` header: HMAC-SHA256 (hex) over the
 * exact raw request bytes, keyed with the webhookSecret we sent when the link
 * was created. Uses a constant-time comparison.
 */
export function verifyWaylSignature(rawBody: string | Buffer, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false;

  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const signatureBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  if (signatureBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
}

/**
 * Wayl lifecycle states ("Created, Pending, Processing, Complete, Delivered,
 * Cancelled, Rejected, Returned") — treated as paid only once money settled.
 */
const PAID_STATUSES = new Set(["complete", "delivered", "paid", "succeeded", "captured", "settled"]);

export function isWaylPaid(status?: string | null): boolean {
  return Boolean(status && PAID_STATUSES.has(status.trim().toLowerCase()));
}

/** A Webhook is terminal-failed when Wayl reports a cancelled/rejected state. */
export function isWaylFailed(status?: string | null): boolean {
  return Boolean(status && ["cancelled", "rejected", "returned", "failed", "expired"].includes(status.trim().toLowerCase()));
}
