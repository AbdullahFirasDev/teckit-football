import { getServerLocale } from "@/lib/locale";
import { MyTicketsScreen } from "@/components/my-tickets";

export const dynamic = "force-dynamic";

export default async function TicketsPage() {
  const locale = await getServerLocale();
  return <MyTicketsScreen locale={locale} />;
}
