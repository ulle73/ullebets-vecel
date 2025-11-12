"use client";

import styles from "./page.module.css";

const navItems = [
  { key: "home", label: "Hem", icon: "home" },
  { key: "favorites", label: "Teams", icon: "star" },
  { key: "add", label: "Lineup", icon: "plus" },
  { key: "backtest", label: "Backtest", icon: "pulse" },
];

const iconPaths = {
  home: [
    "M3 9.75L12 3l9 6.75V21a1.5 1.5 0 0 1-1.5 1.5H4.5A1.5 1.5 0 0 1 3 21Z",
    "M9 21V12h6v9",
  ],
  star: [
    "M12 17.27L18.18 21 16.54 13.73 22 9.24 14.81 8.63 12 2 9.19 8.63 2 9.24 7.46 13.73 5.82 21 12 17.27Z",
  ],
  plus: ["M12 6v12", "M6 12h12"],
  pulse: ["M4 12h4l2-7 4 14 2-6h4"],
};

function NavIcon({ type }) {
  const paths = iconPaths[type] ?? iconPaths.home;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="20"
      height="20"
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

export default function RazBottomNav({ activeTab = "home", onChange }) {
  return (
    <nav className={styles.razBottomNav} aria-label="Raz navigation">
      {navItems.map((item) => (
        <button
          key={item.key}
          type="button"
          className={`${styles.razNavButton} ${
            activeTab === item.key ? styles.razNavButtonActive : ""
          }`}
          onClick={() => onChange?.(item.key)}
        >
          <span className={styles.razIcon}>
            <NavIcon type={item.icon} />
          </span>
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
