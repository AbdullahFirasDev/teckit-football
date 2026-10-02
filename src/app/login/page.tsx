import { Suspense } from "react";
import { getServerLocale } from "@/lib/locale";
import { Spinner } from "@/components/ui";
import { LoginForm } from "@/components/login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const locale = await getServerLocale();
  return (
    <Suspense
      fallback={
        <div className="py-16 text-center">
          <Spinner className="mx-auto size-8 text-slate-400" />
        </div>
      }
    >
      <LoginForm locale={locale} />
    </Suspense>
  );
}
