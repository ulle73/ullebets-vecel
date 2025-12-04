"use client";

import { Home, Trophy, BarChart2, Settings, Activity } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { icon: Home, label: "Home", href: "/" },
  { icon: Trophy, label: "Matches", href: "/matches" },
  { icon: Activity, label: "Predictions", href: "/predictions" },
  { icon: BarChart2, label: "Analytics", href: "/analytics" },
  { icon: Settings, label: "Settings", href: "/settings" },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden h-screen w-64 flex-col border-r border-white/5 bg-black lg:flex">
      <div className="flex h-16 items-center px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[#00f2ea] to-[#00a8a3]">
            <Activity className="h-5 w-5 text-black" />
          </div>
          <span className="text-lg font-bold text-white">
            Advanced
            <br />
            Match Hub
          </span>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-6">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${isActive
                  ? "bg-[#00f2ea]/10 text-[#00f2ea]"
                  : "text-gray-400 hover:bg-white/5 hover:text-white"
                }`}
            >
              <item.icon
                className={`h-5 w-5 transition-colors ${isActive ? "text-[#00f2ea]" : "text-gray-500 group-hover:text-white"
                  }`}
              />
              {item.label}
            </Link>
          );
        })}

        <div className="mt-8 px-3">
          <div className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2">
            <span className="text-xs font-medium text-gray-400">Top Matchups</span>
            <span className="rounded bg-[#00f2ea]/20 px-1.5 py-0.5 text-[10px] font-bold text-[#00f2ea]">
              LIVE
            </span>
          </div>
          <div className="mt-2 space-y-1">
            <div className="cursor-pointer rounded-lg px-3 py-2 text-sm text-gray-500 hover:bg-white/5 hover:text-white">
              Snme matchups
            </div>
          </div>
        </div>
      </nav>

      <div className="border-t border-white/5 p-4">
        <button className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-gray-400 transition-colors hover:bg-white/5 hover:text-white">
          <Settings className="h-5 w-5" />
          Settings
        </button>
      </div>
    </aside>
  );
}
