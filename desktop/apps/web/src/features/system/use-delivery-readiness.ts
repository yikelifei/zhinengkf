"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getDeliveryReadiness, type DeliveryReadiness } from "../../lib/api";

export type DeliveryReadState = "loading" | "ready" | "stale" | "unknown";

export function useDeliveryReadiness() {
  const [readiness, setReadiness] = useState<DeliveryReadiness | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [readState, setReadState] = useState<DeliveryReadState>("loading");
  const trustedReadinessRef = useRef<DeliveryReadiness | null>(null);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError("");
    if (!trustedReadinessRef.current) setReadState("loading");
    try {
      const nextReadiness = await getDeliveryReadiness();
      trustedReadinessRef.current = nextReadiness;
      setReadiness(nextReadiness);
      setReadState("ready");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "交付验收状态读取失败。");
      setReadState(trustedReadinessRef.current ? "stale" : "unknown");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { readiness, busy, error, readState, refresh };
}
