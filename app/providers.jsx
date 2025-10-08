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

class PersistentCache extends Map {
  constructor(storageKey, resolveTtl) {
    super();
    this.storageKey = storageKey;
    this.resolveTtl = resolveTtl;
    this.storage = getStorage();
    this.timestamps = new Map();
    this.persistTimer = null;
    this.beforeUnloadHandler = () => this.persistImmediate();
    this.visibilityHandler = () => {
      if (document.visibilityState === "hidden") {
        this.persistImmediate();
      }
    };

    if (this.storage) {
      this.loadFromStorage();
      window.addEventListener("beforeunload", this.beforeUnloadHandler);
      window.addEventListener("pagehide", this.beforeUnloadHandler);
      if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", this.visibilityHandler);
      }
    }
  }

  loadFromStorage() {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(this.storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const now = Date.now();
      for (const entry of parsed) {
        if (!entry || typeof entry !== "object") continue;
        const { key, value, timestamp } = entry;
        if (typeof key !== "string") continue;
        const storedAt = typeof timestamp === "number" ? timestamp : now;
        const ttl = this.resolveTtl(key, value);
        if (ttl > 0 && now - storedAt > ttl) {
          continue;
        }
        super.set(key, value);
        this.timestamps.set(key, storedAt);
      }
    } catch (error) {
      console.warn("SWR persistent cache: kunde inte läsa från storage", error);
    }
  }

  schedulePersist() {
    if (!this.storage) return;
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persistImmediate();
    }, 100);
  }

  persistImmediate() {
    if (!this.storage) return;
    const entries = [];
    for (const [key, value] of super.entries()) {
      const timestamp = this.timestamps.get(key) ?? Date.now();
      entries.push({ key, value, timestamp });
    }
    try {
      this.storage.setItem(this.storageKey, JSON.stringify(entries));
    } catch (error) {
      console.warn("SWR persistent cache: kunde inte skriva till storage", error);
    }
  }

  clearPersistTimer() {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
  }

  get(key) {
    const value = super.get(key);
    if (value === undefined) {
      return value;
    }
    const timestamp = this.timestamps.get(key);
    const ttl = this.resolveTtl(key, value);
    if (ttl > 0 && timestamp) {
      const age = Date.now() - timestamp;
      if (age > ttl) {
        super.delete(key);
        this.timestamps.delete(key);
        this.schedulePersist();
        return undefined;
      }
    }
    return value;
  }

  set(key, value) {
    const result = super.set(key, value);
    this.timestamps.set(key, Date.now());
    this.schedulePersist();
    return result;
  }

  delete(key) {
    const result = super.delete(key);
    this.timestamps.delete(key);
    this.schedulePersist();
    return result;
  }

  clear() {
    super.clear();
    this.timestamps.clear();
    this.schedulePersist();
  }
}

function resolveTtl(key) {
  if (typeof key !== "string") {
    return DEFAULT_TTL_MS;
  }
  if (key.startsWith("/api/match/") && key.endsWith("/lineups")) {
    return LINEUPS_TTL_MS;
  }
  if (key.startsWith("/api/matches/by-date")) {
    return MATCHES_TTL_MS;
  }
  if (key.startsWith("/api/teamprofiles")) {
    return TEAM_PROFILE_TTL_MS;
  }
  if (key.startsWith("/api/match/")) {
    return MATCHES_TTL_MS;
  }
  return DEFAULT_TTL_MS;
}

function createCache() {
  if (typeof window === "undefined") {
    return new Map();
  }
  return new PersistentCache("swr-persistent-cache:v1", resolveTtl);
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
