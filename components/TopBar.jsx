"use client";

import { Search, Bell, MessageSquare, ChevronDown } from "lucide-react";
import Image from "next/image";

export default function TopBar() {
  return (
    <header className="flex h-16 items-center justify-between border-b border-white/5 bg-black px-6">
      <div className="flex items-center gap-4">
        {/* Mobile menu trigger could go here */}
        <h1 className="text-xl font-bold text-white">Home</h1>
      </div>

      <div className="flex items-center gap-6">
        <div className="relative hidden md:block">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            placeholder="Search"
            className="h-10 w-64 rounded-xl border border-white/10 bg-white/5 pl-10 pr-4 text-sm text-white placeholder-gray-500 focus:border-[#00f2ea]/50 focus:outline-none focus:ring-1 focus:ring-[#00f2ea]/50"
          />
        </div>

        <div className="flex items-center gap-4">
          <button className="relative rounded-lg p-2 text-gray-400 hover:bg-white/5 hover:text-white">
            <MessageSquare className="h-5 w-5" />
            <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-red-500 ring-2 ring-black" />
          </button>
          <button className="relative rounded-lg p-2 text-gray-400 hover:bg-white/5 hover:text-white">
            <Bell className="h-5 w-5" />
          </button>

          <div className="flex items-center gap-3 border-l border-white/10 pl-6">
            <div className="relative h-8 w-8 overflow-hidden rounded-full bg-gray-700">
              {/* Placeholder avatar */}
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#00f2ea] to-blue-600 text-xs font-bold text-white">
                JD
              </div>
            </div>
            <ChevronDown className="h-4 w-4 text-gray-500" />
          </div>
        </div>
      </div>
    </header>
  );
}
