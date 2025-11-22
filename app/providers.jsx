"use client";

import { SWRConfig } from "swr";
import { useMemo, useRef } from "react";
import {
  DEFAULT_TTL_MS,
  LINEUPS_TTL_MS,
  MATCHES_TTL_MS,
  TEAM_PROFILE_TTL_MS,
} from "@/lib/utils/apiKeys";

function getStorage() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch (error) {
    console.warn("SWR persistent cache: localStorage otillgänglig", error);
    return null;
  }
}

// No-operation cache to disable persistent caching
class NoopCache extends Map {
  get(_key) {
    return undefined; // Always return undefined for any key
  }
  set(_key, _value) {
    // Do nothing
  }
  delete(_key) {
    // Do nothing
  }
  clear() {
    // Do nothing
  }
}

// Removed resolveTtl as it's no longer needed for NoopCache

function createCache() {
  // Always return NoopCache to disable persistent caching
  return new NoopCache();
}

export default function Providers({ children }) {
  const cacheRef = useRef();
  if (!cacheRef.current) {
    cacheRef.current = createCache();
  }

  const value = useMemo(
    () => ({
      provider: () => cacheRef.current,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      revalidateIfStale: false,
      suspense: false,
    }),
    []
  );

  return <SWRConfig value={value}>{children}</SWRConfig>;
}
