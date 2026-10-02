"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, Button, Card, Field, Input } from "@/components/ui";
import { createTranslator, type Locale } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/client";

function Form({ locale }: { locale: Locale }) {
  const t = createTranslator(locale);
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") ?? "/dashboard";

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);

    try {
      const supabase = createClient();

      if (mode === "signup") {
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName || email.split("@")[0] },
          },
        });
        if (signUpError) {
          setError(signUpError.message);
          setPending(false);
          return;
        }
        // Session is active immediately unless email confirmation is enforced.
        router.push(nextPath);
        router.refresh();
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        setError(t("login.invalid"));
        setPending(false);
        return;
      }
      router.push(nextPath);
      router.refresh();
    } catch {
      setError(t("common.error"));
      setPending(false);
    }
  };

  return (
    <div className="mx-auto max-w-sm space-y-6 py-6">
      <header className="text-center">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{t("login.title")}</h1>
        <p className="mt-1 text-sm text-slate-500">{t("login.subtitle")}</p>
      </header>

      <Card>
        <form onSubmit={submit} className="space-y-4">
          {mode === "signup" && (
            <Field label={t("checkout.name")}>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" placeholder="Ahmed Ali" />
            </Field>
          )}

          <Field label={t("login.email")}>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              dir="ltr"
              required
              placeholder="you@example.com"
            />
          </Field>

          <Field label={t("login.password")}>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              dir="ltr"
              required
              minLength={6}
              placeholder="••••••••"
            />
          </Field>

          {error && <Alert tone="error" title={error} />}

          <Button type="submit" className="w-full" loading={pending}>
            {mode === "signup" ? t("login.signUp") : t("login.signIn")}
          </Button>

          <p className="text-center text-sm">
            <button
              type="button"
              className="font-medium text-brand-600 hover:text-brand-700"
              onClick={() => {
                setMode(mode === "signin" ? "signup" : "signin");
                setError(null);
              }}
            >
              {mode === "signin" ? t("login.needAccount") : t("login.haveAccount")}
            </button>
          </p>
        </form>
      </Card>
    </div>
  );
}

export function LoginForm({ locale }: { locale: Locale }) {
  return (
    <Suspense fallback={null}>
      <Form locale={locale} />
    </Suspense>
  );
}
