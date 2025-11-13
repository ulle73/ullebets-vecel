"use client";

import useSWR from "swr";

const fetcher = async (input) => {
  if (!input) return null;
  const response = await fetch(input);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const message = payload?.message || `HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return response.json();
};

export function useMatchups(date) {
  const key = date ? `/api/matchups-score?date=${encodeURIComponent(date)}` : null;
  const swr = useSWR(key, fetcher, {
    revalidateOnFocus: false,
  });
  return {
    data: swr.data,
    error: swr.error,
    isLoading: swr.isLoading,
  };
}
