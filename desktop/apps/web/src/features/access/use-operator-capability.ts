"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getOperatorAccessStatus, type OperatorCapability } from "../../lib/api";

export function useOperatorCapability(capability: OperatorCapability) {
  const [busy, setBusy] = useState(false);
  const [readState, setReadState] = useState<"loading" | "ready" | "unknown">("loading");
  const [allowed, setAllowed] = useState(false);
  const [error, setError] = useState("");
  const sequenceRef = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = ++sequenceRef.current;
    setBusy(true);
    setError("");
    try {
      const status = await getOperatorAccessStatus();
      if (sequence !== sequenceRef.current) return;
      setAllowed(status.enforcementReady && status.capabilities.includes(capability));
      setReadState("ready");
    } catch (reason) {
      if (sequence !== sequenceRef.current) return;
      setAllowed(false);
      setReadState("unknown");
      setError(reason instanceof Error ? reason.message : "操作权限读取失败。");
    } finally {
      if (sequence === sequenceRef.current) setBusy(false);
    }
  }, [capability]);

  useEffect(() => {
    void refresh();
    return () => { sequenceRef.current += 1; };
  }, [refresh]);

  return { busy, readState, allowed, error, refresh };
}
