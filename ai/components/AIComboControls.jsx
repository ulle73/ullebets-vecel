"use client";

export default function AIComboControls({
  legs,
  onLegChange,
  oddsRange,
  onOddsRangeChange,
  disabled = false,
}) {
  const handleLegChange = (event) => {
    const value = Number(event.target.value);
    if (Number.isFinite(value)) {
      onLegChange(value);
    }
  };

  const handleOddsChange = (field) => (event) => {
    const value = Number(event.target.value);
    if (Number.isFinite(value)) {
      onOddsRangeChange({ ...oddsRange, [field]: value });
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto">
      <div className="grid gap-3 sm:grid-cols-[repeat(auto-fit,_minmax(0,1fr))]">
        <label className="flex flex-col gap-1 text-sm text-slate-200">
          Kombo-längd
          <select
            className="rounded border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400"
            value={legs}
            onChange={handleLegChange}
            disabled={disabled}
          >
            <option value={1}>Singel</option>
            <option value={2}>Dubbel</option>
            <option value={3}>Trippel</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm text-slate-200">
          Min odds
          <input
            type="number"
            min={1.01}
            step="0.01"
            value={oddsRange.min}
            onChange={handleOddsChange("min")}
            disabled={disabled}
            className="rounded border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-slate-200">
          Max odds
          <input
            type="number"
            min={1.01}
            step="0.01"
            value={oddsRange.max}
            onChange={handleOddsChange("max")}
            disabled={disabled}
            className="rounded border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400"
          />
        </label>
      </div>
    </div>
  );
}
