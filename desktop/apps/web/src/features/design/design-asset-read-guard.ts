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

export function createDesignAssetReadGuard(initialIdentity: DesignAssetReadIdentity) {
  let sequence = 0;
  let currentIdentityKey = identityKey(initialIdentity);

  return {
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
      return request.sequence === sequence && request.identityKey === currentIdentityKey;
    },
  };
}

type DesignAssetReadGuard = ReturnType<typeof createDesignAssetReadGuard>;

export async function runGuardedDesignAssetRead<T>({
  guard,
  identity,
  load,
  onStart,
  onSuccess,
  onError,
  onFinally,
}: {
  guard: DesignAssetReadGuard;
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

function identityKey(identity: DesignAssetReadIdentity) {
  return JSON.stringify([
    identity.ownerId.trim(),
    identity.wechatAccountId.trim(),
    identity.conversationId.trim(),
    identity.customerId.trim(),
  ]);
}
