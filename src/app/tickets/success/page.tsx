import { getServerLocale } from "@/lib/locale";
import { SuccessScreen } from "@/components/success-content";

export const dynamic = "force-dynamic";

export default async function SuccessPage() {
  // Locale resolved on the server so the redirect target from Wayl renders in
  // the customer's chosen language without hydration flicker.
  const locale = await getServerLocale();
  return <SuccessScreen locale={locale} />;
}
