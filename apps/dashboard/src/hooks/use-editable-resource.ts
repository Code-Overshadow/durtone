"use client";

import { useEffect, useRef, useState } from "react";

type EditableResourceOptions<T> = {
  fetcher: () => Promise<T>;
  saver: (value: T) => Promise<T>;
};

export function useEditableResource<T>({ fetcher, saver }: EditableResourceOptions<T>) {
  const [serverValue, setServerValue] = useState<T | null>(null);
  const [draft, setDraft] = useState<T | null>(null);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "saving" | "error">("loading");
  const [error, setError] = useState("");
  const dirtyRef = useRef(dirty);
  const fetcherRef = useRef(fetcher);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  async function refresh() {
    if (dirtyRef.current) return;
    setStatus("loading");
    try {
      const value = await fetcherRef.current();
      setServerValue(value);
      setDraft(value);
      setStatus("idle");
      setError("");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Falha ao carregar configuração");
    }
  }

  useEffect(() => {
    Promise.resolve().then(() => void refresh());
  }, []);

  function update(patch: Partial<T> | ((value: T) => T)) {
    setDraft((current) => {
      const base = current ?? serverValue;
      if (!base) return current;
      return typeof patch === "function" ? (patch as (value: T) => T)(base) : { ...base, ...patch };
    });
    setDirty(true);
  }

  function discard() {
    setDraft(serverValue);
    setDirty(false);
  }

  async function save() {
    if (!draft) return;
    setStatus("saving");
    try {
      const saved = await saver(draft);
      setServerValue(saved);
      setDraft(saved);
      setDirty(false);
      setStatus("idle");
      setError("");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Falha ao salvar");
    }
  }

  return { value: draft, dirty, status, error, update, discard, save, refresh };
}
