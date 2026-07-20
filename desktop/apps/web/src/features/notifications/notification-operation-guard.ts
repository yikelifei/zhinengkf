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
