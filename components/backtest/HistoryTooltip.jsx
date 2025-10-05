export default function HistoryTooltip({ content, position, threshold }) {
  if (!content) return null;
  const entries = String(content)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return (
    <div
      className="pointer-events-none fixed z-50 max-w-xs rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-xs text-gray-100 shadow-lg"
      style={{
        top: (position?.y ?? 0) + 10,
        left: (position?.x ?? 0) + 10,
      }}
    >
      {entries.map((entry, index) => {
        const [label, value] = entry.split(": ");
        const numeric = Number.parseFloat(value);
        const highlight =
          typeof threshold === "number" && Number.isFinite(numeric)
            ? numeric > threshold
            : false;
        return (
          <div key={`${entry}-${index}`} className="flex justify-between gap-2">
            <span className="text-gray-300">{label ?? ""}</span>
            <span className={highlight ? "text-green-400" : "text-red-400"}>{value ?? ""}</span>
          </div>
        );
      })}
    </div>
  );
}
