"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "./feature-page";

export type AsyncResource<T> = {
  data: T | null;
  busy: boolean;
  error: string;
  refresh: () => Promise<T | null>;
  replace: (value: T) => void;
};

export function useAsyncResource<T>(loader: () => Promise<T>, fallbackError: string): AsyncResource<T> {
  const [data, setData] = useState<T | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const requestSequence = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setBusy(true);
    setError("");
    try {
      const next = await loader();
      if (sequence !== requestSequence.current) return null;
      setData(next);
      return next;
    } catch (refreshError) {
      if (sequence === requestSequence.current) {
        setError(errorMessage(refreshError, fallbackError));
      }
      return null;
    } finally {
      if (sequence === requestSequence.current) setBusy(false);
    }
  }, [fallbackError, loader]);

  useEffect(() => {
    void refresh();
    return () => { requestSequence.current += 1; };
  }, [refresh]);

  const replace = useCallback((value: T) => {
    requestSequence.current += 1;
    setData(value);
    setError("");
    setBusy(false);
  }, []);

  return { data, busy, error, refresh, replace };
}
