"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useProfile, useManagedEvents } from "@/lib/queries";
import { useLocale } from "@/components/locale-provider";
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Spinner } from "@/components/ui";
import { eventFormSchema, firstIssue } from "@/lib/validation";
import { formatDate } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

export default function DashboardEventsPage() {
  const { t } = useLocale();
  const profile = useProfile();
  const events = useManagedEvents(Boolean(profile.data));
  const queryClient = useQueryClient();

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const createEvent = useMutation({
    mutationFn: async () => {
      const parsed = eventFormSchema.safeParse({ title, description, location, eventDate });
      if (!parsed.success) throw new Error(firstIssue(parsed.error));

      const supabase = createClient();
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error(t("common.error"));

      const { error } = await supabase.from("events").insert({
        title: parsed.data.title,
        description: parsed.data.description || null,
        location: parsed.data.location,
        event_date: new Date(parsed.data.eventDate).toISOString(),
        organizer_id: userData.user.id,
        status: "active",
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      setTitle("");
      setDescription("");
      setLocation("");
      setEventDate("");
      setShowForm(false);
      void queryClient.invalidateQueries({ queryKey: ["managed-events"] });
      void queryClient.invalidateQueries({ queryKey: ["overview"] });
    },
    onError: (err: Error) => setFormError(err.message),
  });

  if (profile.isLoading || events.isPending) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="size-8 text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{t("dashboard.events")}</h1>
        <Button variant={showForm ? "secondary" : "primary"} onClick={() => setShowForm((v) => !v)}>
          {showForm ? t("dashboard.cancel") : `+ ${t("dashboard.newEvent")}`}
        </Button>
      </header>

      {showForm && (
        <Card>
          <h2 className="mb-4 text-base font-semibold text-slate-900">{t("dashboard.createEvent")}</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setFormError(null);
              createEvent.mutate();
            }}
            className="grid gap-4 sm:grid-cols-2"
          >
            <Field label={t("dashboard.eventTitle")}>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} required minLength={3} />
            </Field>
            <Field label={t("dashboard.date")}>
              <Input
                type="datetime-local"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
                required
                dir="ltr"
                className="ltr-nums"
              />
            </Field>
            <Field label={t("dashboard.location")}>
              <Input value={location} onChange={(e) => setLocation(e.target.value)} required minLength={3} />
            </Field>
            <Field label={t("dashboard.description")}>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>

            {formError && (
              <div className="sm:col-span-2">
                <Alert tone="error" title={formError} />
              </div>
            )}

            <div className="sm:col-span-2">
              <Button type="submit" loading={createEvent.isPending}>
                {t("dashboard.save")}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {events.data && events.data.length === 0 ? (
        <EmptyState title={t("dashboard.noEvents")} />
      ) : (
        <ul className="space-y-3">
          {(events.data ?? []).map((event) => (
            <li key={event.id}>
              <Card className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-semibold text-slate-900">{event.title}</p>
                    <Badge tone={event.status === "active" ? "green" : event.status === "cancelled" ? "red" : "slate"}>
                      {event.status}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-sm text-slate-500">
                    <span className="ltr-nums" dir="ltr">{formatDate(event.event_date)}</span> · {event.location}
                  </p>
                </div>
                <Link
                  href={`/dashboard/events/${event.id}`}
                  className="rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
                >
                  {t("dashboard.manage")}
                </Link>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
