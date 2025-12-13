"use client";

import { useState, useEffect } from "react";

export default function DatePicker({ value, onChange, min, max }) {
  const [d, setD] = useState(value);

  useEffect(() => { setD(value); }, [value]);

  return (
    <input
      type="date"
      value={d}
      min={min}
      max={max}
      className="text-sm bg-[#0A0A0A] text-white border border-white/10 rounded-lg shadow-sm focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-none px-3 py-2 transition-all hover:border-white/20"
      onChange={(e) => {
        const v = e.target.value;
        setD(v);
        onChange?.(v);
      }}
      style={{
        colorScheme: "dark",
      }}
    />
  );
}
