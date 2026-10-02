import { z } from "zod";

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^[+]?[\d\s-]{7,20}$/, "Enter a valid phone number (digits, optional leading +).");

export const checkoutSchema = z.object({
  ticketTypeId: z.string().uuid(),
  quantity: z.coerce.number().int().min(1).max(10),
  buyerName: z.string().trim().min(2, "Name is too short.").max(255),
  buyerPhone: phoneSchema,
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

export const phoneLookupSchema = z.object({
  phone: phoneSchema,
});

export const checkInSchema = z.object({
  qrCodeHash: z.string().trim().min(8).max(255),
});

/** Manual check-in fallback: by ticket id (UUID) or by phone within an event. */
export const manualLookupSchema = z.object({
  eventId: z.string().uuid(),
  query: z.string().trim().min(4).max(255),
});

export const eventFormSchema = z.object({
  title: z.string().trim().min(3).max(255),
  description: z.string().trim().max(5000).optional().or(z.literal("")),
  location: z.string().trim().min(3).max(255),
  eventDate: z.string().min(10), // datetime-local string
});
export type EventFormInput = z.infer<typeof eventFormSchema>;

export const ticketTypeFormSchema = z.object({
  eventId: z.string().uuid(),
  name: z.string().trim().min(2).max(100),
  price: z.coerce.number().min(0).max(100_000_000),
  totalQuantity: z.coerce.number().int().min(1).max(1_000_000),
});
export type TicketTypeFormInput = z.infer<typeof ticketTypeFormSchema>;

/** Zod-safe error message extraction. */
export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid input.";
}
