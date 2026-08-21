"use client";

import { useEffect, useRef, useState } from "react";

type PollingOptions = {
  intervalMs?: number;
  enabled?: boolean;
};

export function usePollingResource<T>(fetcher: () => Promise<T>, options: PollingOptions = {}) {
  const { intervalMs = 15000, enabled = true } = options;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const lastPayloadRef = useRef("");
  const activeRef = useRef(true);
  const fetcherRef = useRef(fetcher);

  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  async function refresh() {
    setLoading(true);
    try {
      const next = await fetcherRef.current();
      if (!activeRef.current) return;
      const serialized = JSON.stringify(next);
      if (serialized !== lastPayloadRef.current) {
        lastPayloadRef.current = serialized;
        setData(next);
      }
      setError("");
    } catch (err) {
      if (!activeRef.current) return;
      setError(err instanceof Error ? err.message : "Falha ao carregar dados");
    } finally {
      if (activeRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    if (!enabled) return;
    activeRef.current = true;
    Promise.resolve().then(() => {
      if (activeRef.current) void refresh();
    });
    const timer = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void refresh();
    }, intervalMs);
    return () => {
      activeRef.current = false;
      window.clearInterval(timer);
    };
  }, [enabled, intervalMs]);

  return { data, loading, error, refresh };
}
