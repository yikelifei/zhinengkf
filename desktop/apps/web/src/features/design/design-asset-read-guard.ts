export type DesignAssetReadIdentity = {
  ownerId: string;
  wechatAccountId: string;
  conversationId: string;
  customerId: string;
};

export type DesignAssetReadRequest = {
  sequence: number;
  identityKey: string;
};

export function createDesignAssetOperationGuard(initialIdentity: DesignAssetReadIdentity) {
  let sequence = 0;
  let currentIdentityKey = identityKey(initialIdentity);
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

    setIdentity(identity: DesignAssetReadIdentity) {
      const nextIdentityKey = identityKey(identity);
      if (nextIdentityKey === currentIdentityKey) return;
      currentIdentityKey = nextIdentityKey;
      sequence += 1;
    },

    begin(identity: DesignAssetReadIdentity): DesignAssetReadRequest {
      const requestIdentityKey = identityKey(identity);
      if (requestIdentityKey !== currentIdentityKey) {
        return { sequence, identityKey: requestIdentityKey };
      }
      sequence += 1;
      return { sequence, identityKey: requestIdentityKey };
    },

    isCurrent(request: DesignAssetReadRequest) {
      return active && request.sequence === sequence && request.identityKey === currentIdentityKey;
    },
  };
}

export const createDesignAssetReadGuard = createDesignAssetOperationGuard;

type DesignAssetOperationGuard = ReturnType<typeof createDesignAssetOperationGuard>;

export async function runGuardedDesignAssetRead<T>({
  guard,
  identity,
  load,
  onStart,
  onSuccess,
  onError,
  onFinally,
}: {
  guard: DesignAssetOperationGuard;
  identity: DesignAssetReadIdentity;
  load: () => Promise<T>;
  onStart: () => void;
  onSuccess: (value: T) => void;
  onError: (error: unknown) => void;
  onFinally: () => void;
}) {
  const request = guard.begin(identity);
  if (!guard.isCurrent(request)) return;
  onStart();
  try {
    const value = await load();
    if (!guard.isCurrent(request)) return;
    onSuccess(value);
  } catch (error) {
    if (!guard.isCurrent(request)) return;
    onError(error);
  } finally {
    if (guard.isCurrent(request)) onFinally();
  }
}

export async function runGuardedDesignAssetMutation<TPrepared, TCreated, TRecords>({
  guard,
  identity,
  prepare,
  mutate,
  refresh,
  onStart,
  onMutationSuccess,
  onRefreshSuccess,
  onRefreshError,
  onSuccess,
  onError,
  onFinally,
}: {
  guard: DesignAssetOperationGuard;
  identity: DesignAssetReadIdentity;
  prepare: () => Promise<TPrepared>;
  mutate: (prepared: TPrepared) => Promise<TCreated>;
  refresh: () => Promise<TRecords>;
  onStart: () => void;
  onMutationSuccess: (created: TCreated) => void;
  onRefreshSuccess: (records: TRecords) => void;
  onRefreshError: (error: unknown) => void;
  onSuccess: (created: TCreated) => void;
  onError: (error: unknown) => void;
  onFinally: () => void;
}) {
  const operation = guard.begin(identity);
  if (!guard.isCurrent(operation)) return;
  onStart();
  try {
    const prepared = await prepare();
    if (!guard.isCurrent(operation)) return;

    const created = await mutate(prepared);
    if (!guard.isCurrent(operation)) return;
    onMutationSuccess(created);

    try {
      const records = await refresh();
      if (!guard.isCurrent(operation)) return;
      onRefreshSuccess(records);
    } catch (error) {
      if (!guard.isCurrent(operation)) return;
      onRefreshError(error);
    }

    if (!guard.isCurrent(operation)) return;
    onSuccess(created);
  } catch (error) {
    if (!guard.isCurrent(operation)) return;
    onError(error);
  } finally {
    if (guard.isCurrent(operation)) onFinally();
  }
}

function identityKey(identity: DesignAssetReadIdentity) {
  return JSON.stringify([
    identity.ownerId.trim(),
    identity.wechatAccountId.trim(),
    identity.conversationId.trim(),
    identity.customerId.trim(),
  ]);
}
