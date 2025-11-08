"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const GA_ID = process.env.NEXT_PUBLIC_GA_ID;

export default function GAReporter() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!GA_ID || typeof window === "undefined") return;

    const page_path = searchParams?.toString()
      ? `${pathname}?${searchParams.toString()}`
      : pathname || "/";

    // Trigga pageview på varje route-byte
    window.gtag?.("config", GA_ID, { page_path });
  }, [pathname, searchParams]);

  return null;
}
