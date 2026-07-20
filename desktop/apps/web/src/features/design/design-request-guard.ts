export type DesignRequestToken = {
  sequence: number;
  scopeKey: string;
};

export function createDesignRequestGuard(initialScopeKey: string) {
  let sequence = 0;
  let currentScopeKey = initialScopeKey;
  let active = true;

  return {
    activate() {
      if (active) return;
      active = true;
      sequence += 1;
    },

    dispose() {
      if (!active) return;
      active = false;
      sequence += 1;
    },

    setScope(scopeKey: string) {
      if (scopeKey === currentScopeKey) return;
      currentScopeKey = scopeKey;
      sequence += 1;
    },

    invalidate(scopeKey = currentScopeKey) {
      currentScopeKey = scopeKey;
      sequence += 1;
    },

    begin(scopeKey: string): DesignRequestToken {
      if (scopeKey !== currentScopeKey) return { sequence, scopeKey };
      sequence += 1;
      return { sequence, scopeKey };
    },

    isCurrent(token: DesignRequestToken) {
      return active && token.sequence === sequence && token.scopeKey === currentScopeKey;
    },
  };
}

type DesignRequestGuard = ReturnType<typeof createDesignRequestGuard>;

export async function runGuardedDesignRequest<T>({
  guard,
  scopeKey,
  load,
  onStart,
  onSuccess,
  onError,
  onFinally,
}: {
  guard: DesignRequestGuard;
  scopeKey: string;
  load: () => Promise<T>;
  onStart: () => void;
  onSuccess: (value: T) => void;
  onError: (error: unknown) => void;
  onFinally: () => void;
}) {
  const token = guard.begin(scopeKey);
  if (!guard.isCurrent(token)) return false;
  onStart();
  try {
    const value = await load();
    if (!guard.isCurrent(token)) return false;
    onSuccess(value);
    return true;
  } catch (error) {
    if (guard.isCurrent(token)) onError(error);
    return false;
  } finally {
    if (guard.isCurrent(token)) onFinally();
  }
}
