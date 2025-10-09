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
      className="text-sm"
      onChange={(e) => {
        const v = e.target.value;
        setD(v);
        onChange?.(v);
      }}
      style={{
        padding: "6px 8px", border: "1px solid #ddd",
        borderRadius: 6, background: "#fff"
      }}
    />
  );
}
