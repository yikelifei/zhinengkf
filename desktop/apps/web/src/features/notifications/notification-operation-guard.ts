export async function runLatestNotificationOperation<T>({
  begin,
  isCurrent,
  operation,
  onStart,
  onSuccess,
  onError,
  onFinally,
}: {
  begin: () => number;
  isCurrent: (sequence: number) => boolean;
  operation: () => Promise<T>;
  onStart: () => void;
  onSuccess: (value: T) => void;
  onError: (error: unknown) => void;
  onFinally: () => void;
}) {
  const sequence = begin();
  onStart();
  try {
    const value = await operation();
    if (!isCurrent(sequence)) return false;
    onSuccess(value);
    return true;
  } catch (error) {
    if (isCurrent(sequence)) onError(error);
    return false;
  } finally {
    if (isCurrent(sequence)) onFinally();
  }
}

export type NotificationConfirmationToken = {
  generation: number;
  scopeKey: string;
};

export function createNotificationConfirmationGuard(initialScopeKey: string) {
  let currentScopeKey = initialScopeKey;
  let generation = 0;

  function setScope(scopeKey: string) {
    if (scopeKey === currentScopeKey) return;
    currentScopeKey = scopeKey;
    generation += 1;
  }

  function isCurrent(token: NotificationConfirmationToken, scopeKey: string) {
    return token.generation === generation
      && token.scopeKey === currentScopeKey
      && scopeKey === currentScopeKey;
  }

  return {
    setScope,

    begin(scopeKey: string): NotificationConfirmationToken {
      setScope(scopeKey);
      return { generation, scopeKey };
    },

    isCurrent,

    consume(token: NotificationConfirmationToken, scopeKey: string) {
      if (!isCurrent(token, scopeKey)) return false;
      generation += 1;
      return true;
    },
  };
}

export function notificationScopeKey(
  unreadOnly: boolean,
  filters?: { wechatAccountId?: string; conversationId?: string; customerId?: string },
) {
  return JSON.stringify([
    unreadOnly,
    String(filters?.wechatAccountId || "").trim(),
    String(filters?.conversationId || "").trim(),
    String(filters?.customerId || "").trim(),
  ]);
}

export type NotificationReadState = "loading" | "ready" | "stale" | "unknown";

export function notificationReadState({
  busy,
  currentScopeKey,
  loadedScopeKey,
  staleScopeKey,
}: {
  busy: boolean;
  currentScopeKey: string;
  loadedScopeKey: string;
  staleScopeKey: string;
}): NotificationReadState {
  if (loadedScopeKey === currentScopeKey && currentScopeKey) {
    return staleScopeKey === currentScopeKey ? "stale" : "ready";
  }
  return busy ? "loading" : "unknown";
}
