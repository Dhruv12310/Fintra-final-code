"use client";

import { COMPANY_ID } from "@/lib/api";
import { usePathname } from "next/navigation";

const pageTitles: Record<string, string> = {
  "/": "Dashboard",
  "/expenses": "Expenses",
  "/journals": "Journal Entries",
  "/documents": "Smart Parser",
  "/ai": "AI Console",
};

export default function Topbar() {
  const pathname = usePathname();
  const pageTitle = pageTitles[pathname] || "MiniBooks";

  return (
    <header
      className="h-16 fixed top-0 right-0 left-60 z-10 transition-all"
      style={{ backgroundColor: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)' }}
    >
      <div className="h-full px-6 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{pageTitle}</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {pathname === "/" && "Your financial insights at a glance"}
            {pathname === "/expenses" && "Track and manage business expenses"}
            {pathname === "/journals" && "View accounting journal entries"}
            {pathname === "/documents" && "Extract data from receipts"}
            {pathname === "/ai" && "Ask your AI accountant anything"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
            style={{ backgroundColor: 'var(--bg-muted)', border: '1px solid var(--border-color)' }}
          >
            <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: 'var(--accent)' }}></div>
            <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              {COMPANY_ID ? (
                <span className="font-mono">{COMPANY_ID.slice(0, 8)}</span>
              ) : (
                "No Company"
              )}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
