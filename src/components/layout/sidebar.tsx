"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState, useCallback, useEffect, useRef } from "react";
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

const AUTO_SYNC_INTERVAL = 10_000; // 10 seconds

export function Sidebar() {
  const pathname = usePathname();
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [autoSync, setAutoSync] = useState(true);
  const syncingRef = useRef(false);

  const doSync = useCallback(async (isAuto = false) => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      if (res.ok) {
        const result = await res.json();
        if (!isAuto || result.sessionsIndexed > 0) {
          setLastSync(isAuto ? `auto · ${result.sessionsIndexed} new` : `${result.sessionsIndexed} sessions`);
          setTimeout(() => setLastSync(null), isAuto ? 3000 : 4000);
        }
        window.dispatchEvent(new CustomEvent("gigity:sync-complete", { detail: result }));
      }
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, []);

  // Auto-sync on mount
  useEffect(() => {
    doSync(true);
  }, [doSync]);

  // Auto-polling: every 30s when tab is visible and autoSync is enabled
  useEffect(() => {
    if (!autoSync) return;

    const tick = () => {
      if (document.visibilityState === "visible") {
        doSync(true);
      }
    };

    const id = setInterval(tick, AUTO_SYNC_INTERVAL);
    return () => clearInterval(id);
  }, [autoSync, doSync]);

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

      {/* Sync controls */}
      <div className="px-3 pb-2 space-y-2">
        <button
          onClick={() => doSync(false)}
          disabled={syncing}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg text-xs font-medium transition-all duration-200 shadow-lg shadow-indigo-600/20"
        >
          <RefreshCw size={13} className={syncing ? "animate-spin" : ""} />
          {syncing ? "Syncing..." : "Sync Data"}
        </button>
        <div className="flex items-center justify-between px-1">
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoSync}
              onChange={(e) => setAutoSync(e.target.checked)}
              className="w-3 h-3 rounded border-zinc-700 bg-zinc-800 text-indigo-500 focus:ring-0 focus:ring-offset-0 accent-indigo-500"
            />
            <span className="text-[10px] text-zinc-500">Auto-sync 10s</span>
          </label>
          {lastSync && (
            <span className="text-[10px] text-emerald-400/70">{lastSync}</span>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-zinc-800/60">
        <div className="flex items-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full ${autoSync ? "bg-emerald-500" : "bg-zinc-600"}`} />
          <p className="text-[11px] text-zinc-600">~/.claude</p>
        </div>
      </div>
    </aside>
  );
}
