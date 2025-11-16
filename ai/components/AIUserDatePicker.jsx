"use client";

import { useEffect, useState } from "react";

export default function AIUserDatePicker({ value, onChange, min, max }) {
  const [current, setCurrent] = useState(value ?? "");

  useEffect(() => {
    setCurrent(value ?? "");
  }, [value]);

  return (
    <div className="flex w-full min-w-0">
      {/* <label className="mb-2 block text-xs uppercase tracking-wide text-slate-500">
        Datum
      </label> */}
      <input
        type="date"
        value={current}
        min={min}
        max={max}
        className="flex-1 w-full min-w-0 rounded-full bg-slate-200/80 px-3 sm:px-5 py-3 text-center text-lg font-semibold text-black focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
        onChange={(event) => {
          const next = event.target.value;
          setCurrent(next);
          onChange?.(next);
        }}
      />
    </div>
  );
}
