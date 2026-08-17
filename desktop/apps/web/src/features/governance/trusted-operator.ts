"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getOperatorAccessStatus, isTrustedDesktopSessionError, type OperatorAccessStatus } from "../../lib/api";

export type TrustedOperatorState = {
  status: OperatorAccessStatus | null;
  loaded: boolean;
  busy: boolean;
  error: string;
  sessionBlocked: boolean;
  reviewer: string;
  displayName: string;
  refresh: () => Promise<void>;
};

export function resolveTrustedOperator(reviewer?: string, status?: OperatorAccessStatus | null) {
  const directReviewer = reviewer?.trim();
  if (directReviewer) return directReviewer;
  if (status?.trustedPrincipal && status.enforcementReady && status.principal?.id) return status.principal.id;
  return "";
}

export function resolveTrustedOperatorLabel(reviewer?: string, status?: OperatorAccessStatus | null) {
  const directReviewer = reviewer?.trim();
  if (directReviewer) return directReviewer;
  if (status?.trustedPrincipal && status.enforcementReady && status.principal?.displayName) {
    return status.principal.displayName;
  }
  return resolveTrustedOperator(reviewer, status);
}

export function useTrustedOperator(reviewer?: string): TrustedOperatorState {
  const [status, setStatus] = useState<OperatorAccessStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sessionBlocked, setSessionBlocked] = useState(false);
  const refreshSequence = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    setBusy(true);
    setLoaded(false);
    setError("");
    setSessionBlocked(false);
    try {
      const nextStatus = await getOperatorAccessStatus();
      if (sequence !== refreshSequence.current) return;
      setStatus(nextStatus);
      setLoaded(true);
    } catch (caught) {
      if (sequence !== refreshSequence.current) return;
      setStatus(null);
      setError(caught instanceof Error ? caught.message : "operator access status failed");
      setSessionBlocked(isTrustedDesktopSessionError(caught));
      setLoaded(true);
    } finally {
      if (sequence === refreshSequence.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => {
      refreshSequence.current += 1;
    };
  }, [refresh]);

  return {
    status,
    loaded,
    busy,
    error,
    sessionBlocked,
    reviewer: resolveTrustedOperator(reviewer, status),
    displayName: resolveTrustedOperatorLabel(reviewer, status),
    refresh,
  };
}
