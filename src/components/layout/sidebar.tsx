"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState, useCallback } from "react";
import {
  LayoutDashboard,
  MessageSquare,
  BarChart3,
  Brain,
  Settings,
  RefreshCw,
} from "lucide-react";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/sessions", label: "Sessions", icon: MessageSquare },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/memories", label: "Memories", icon: Brain },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);

  const doSync = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      if (res.ok) {
        const result = await res.json();
        setLastSync(`${result.sessionsIndexed} sessions`);
        // Dispatch a custom event so pages can react to sync completion
        window.dispatchEvent(new CustomEvent("gigity:sync-complete", { detail: result }));
        // Clear the status after a few seconds
        setTimeout(() => setLastSync(null), 4000);
      }
    } finally {
      setSyncing(false);
    }
  }, []);

  return (
    <aside className="w-60 bg-zinc-900/80 backdrop-blur-sm border-r border-zinc-800/60 flex flex-col h-screen sticky top-0">
      {/* Brand */}
      <div className="px-5 py-4 border-b border-zinc-800/60">
        <div className="flex items-center gap-3">
          <Image
            src="/logo.png"
            alt="Gigity"
            width={36}
            height={36}
            className="rounded-lg"
          />
          <div>
            <h1 className="text-sm font-bold text-white tracking-tight leading-none">
              Gigity
            </h1>
            <p className="text-[10px] text-zinc-500 mt-0.5 tracking-wide uppercase">Claude Code Observatory</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider px-3 mb-2">Menu</p>
        {navItems.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== "/" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-150 ${
                isActive
                  ? "bg-indigo-600/10 text-indigo-400 border-l-[3px] border-indigo-500 -ml-px"
                  : "text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/50"
              }`}
            >
              <item.icon size={16} strokeWidth={isActive ? 2.2 : 1.8} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Sync button */}
      <div className="px-3 pb-2">
        <button
          onClick={doSync}
          disabled={syncing}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg text-xs font-medium transition-all duration-200 shadow-lg shadow-indigo-600/20"
        >
          <RefreshCw size={13} className={syncing ? "animate-spin" : ""} />
          {syncing ? "Syncing..." : "Sync Data"}
        </button>
        {lastSync && (
          <p className="text-[10px] text-emerald-400/70 text-center mt-1.5">Synced {lastSync}</p>
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-zinc-800/60">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          <p className="text-[11px] text-zinc-600">~/.claude</p>
        </div>
      </div>
    </aside>
  );
}
