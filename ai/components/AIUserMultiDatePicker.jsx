"use client";

import { useState, useMemo, useEffect } from "react";
import useSWR from "swr";
import clsx from "clsx";
import { fetchJson } from "@/lib/utils/fetchers";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year, month) {
  // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  // Adjust to 0 = Monday, ..., 6 = Sunday
  const day = new Date(year, month, 1).getDay();
  return day === 0 ? 6 : day - 1;
}

export default function AIUserMultiDatePicker({ selectedDates = [], onChange, currentDate }) {
  // Parse initial date or use today
  const initialDate = currentDate ? new Date(currentDate) : new Date();
  const [viewDate, setViewDate] = useState(initialDate);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  // Fetch match counts for the current month view
  // Fetch a bit extra to cover previous/next month days if we were to show them
  // For now, just fetching current month range
  const startStr = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const endStr = `${year}-${String(month + 1).padStart(2, "0")}-${getDaysInMonth(year, month)}`;

  const { data: counts } = useSWR(
    `/api/matches/counts?start=${startStr}&end=${endStr}`,
    fetchJson,
    { revalidateOnFocus: false }
  );

  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);

  const handlePrevMonth = () => {
    setViewDate(new Date(year, month - 1, 1));
  };

  const handleNextMonth = () => {
    setViewDate(new Date(year, month + 1, 1));
  };

  const toggleDate = (day) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const exists = selectedDates.includes(dateStr);

    let newDates;
    if (exists) {
      newDates = selectedDates.filter(d => d !== dateStr);
    } else {
      newDates = [...selectedDates, dateStr].sort();
    }
    onChange?.(newDates);
  };

  // Generate grid cells
  const cells = [];
  // Empty cells for padding before first day
  for (let i = 0; i < firstDay; i++) {
    cells.push(<div key={`empty-${i}`} />);
  }

  // Day cells
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const isSelected = selectedDates.includes(dateStr);
    const count = counts?.[dateStr] ?? 0;

    // Determine if date is in the past (for visual feedback only)
    const checkDate = new Date(year, month, day);
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalize today to start of day
    const isPast = checkDate < today;

    // Determine count color
    let countColor = "text-emerald-400"; // Default green for future/today
    if (isPast) {
      countColor = "text-slate-500"; // Gray for past
    }

    cells.push(
      <button
        key={day}
        onClick={() => toggleDate(day)}
        className={clsx(
          "flex flex-col items-center justify-center rounded-lg py-2 transition-all hover:bg-white/5",
          isSelected ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/50" : "text-slate-300"
        )}
      >
        <span className={clsx("text-lg font-bold", isSelected && "text-white")}>{day}</span>
        <span className={clsx("text-[10px] font-medium h-3", countColor)}>
          {count > 0 ? count : ""}
        </span>
      </button>
    );
  }

  return (
    <div className="w-fit min-w-[340px] rounded-3xl border border-white/10 bg-gradient-to-b from-slate-900 to-[#020617] p-6 shadow-2xl shadow-black/50 backdrop-blur-xl">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between border-b border-white/5 pb-4">
        <button
          onClick={handlePrevMonth}
          className="group rounded-full p-2 text-slate-400 transition-all hover:bg-white/5 hover:text-white"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-5 w-5 transition-transform group-hover:-translate-x-0.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>
        <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-slate-100">
          {MONTHS[month]} <span className="text-emerald-400">{year}</span>
        </h3>
        <button
          onClick={handleNextMonth}
          className="group rounded-full p-2 text-slate-400 transition-all hover:bg-white/5 hover:text-white"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-5 w-5 transition-transform group-hover:translate-x-0.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
        </button>
      </div>

      {/* Weekday Headers */}
      <div className="mb-3 grid grid-cols-7 text-center">
        {["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].map((d) => (
          <span key={d} className="text-[10px] font-bold tracking-wider text-slate-500">
            {d}
          </span>
        ))}
      </div>

      {/* Calendar Grid */}
      <div className="grid grid-cols-7 gap-2">
        {cells}
      </div>
    </div>
  );
}
