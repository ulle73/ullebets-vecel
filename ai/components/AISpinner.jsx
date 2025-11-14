"use client";

export default function AISpinner({ label = "Laddar" }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 pt-4 text-slate-400">
      <div
        className="h-12 w-12 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent"
        role="status"
        aria-live="polite"
        aria-label={label}
      />
      <p className="text-xs uppercase tracking-wide">{label}</p>
    </div>
  );
}
