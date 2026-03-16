"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Info, X } from "lucide-react";

interface InfoPopoverProps {
  title: string;
  children: React.ReactNode;
}

function getPosition(el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  const panelWidth = 320;
  let left = rect.left + rect.width / 2 - panelWidth / 2;
  if (left < 8) left = 8;
  if (left + panelWidth > window.innerWidth - 8) left = window.innerWidth - panelWidth - 8;
  let top = rect.bottom + 8;
  if (top + 320 > window.innerHeight) {
    top = rect.top - 8;
  }
  return { top, left };
}

export function InfoPopover({ title, children }: InfoPopoverProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const toggle = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    if (!open && buttonRef.current) {
      setPos(getPosition(buttonRef.current));
    }
    setOpen(!open);
  };

  // Close on outside click, reposition on scroll/resize
  useEffect(() => {
    if (!open) return;

    const onOutsideClick = (e: MouseEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };

    const onReposition = () => {
      if (buttonRef.current) setPos(getPosition(buttonRef.current));
    };

    document.addEventListener("mousedown", onOutsideClick);
    window.addEventListener("scroll", onReposition, true);
    window.addEventListener("resize", onReposition);
    return () => {
      document.removeEventListener("mousedown", onOutsideClick);
      window.removeEventListener("scroll", onReposition, true);
      window.removeEventListener("resize", onReposition);
    };
  }, [open]);

  return (
    <>
      <span
        ref={buttonRef}
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(e); } }}
        className="inline-flex p-0.5 rounded-full text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800/50 transition-colors cursor-pointer"
        title={`About ${title}`}
      >
        <Info size={13} />
      </span>

      {open && createPortal(
        <div
          ref={panelRef}
          className="fixed z-[9999] w-80 bg-zinc-900 border border-zinc-700/60 rounded-xl shadow-2xl"
          style={{ top: pos.top, left: pos.left }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800/60">
            <span className="text-xs font-semibold text-zinc-300">{title}</span>
            <button onClick={() => setOpen(false)} className="p-0.5 rounded hover:bg-zinc-800 transition-colors">
              <X size={12} className="text-zinc-500" />
            </button>
          </div>
          <div className="px-4 py-3 text-[11px] leading-relaxed text-zinc-400 space-y-2 max-h-80 overflow-y-auto">
            {children}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
