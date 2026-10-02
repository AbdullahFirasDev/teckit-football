"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale } from "@/components/locale-provider";
import { cn } from "@/lib/utils";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { t } = useLocale();
  const pathname = usePathname();

  const tabs = [
    { href: "/dashboard", label: t("dashboard.overview"), exact: true },
    { href: "/dashboard/events", label: t("dashboard.events"), exact: false },
    { href: "/dashboard/scanner", label: t("dashboard.scanner"), exact: false },
  ];

  return (
    <div className="space-y-6">
      <nav className="flex flex-wrap gap-1.5" aria-label="Dashboard">
        {tabs.map((tab) => {
          const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors",
                active ? "bg-brand-600 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
