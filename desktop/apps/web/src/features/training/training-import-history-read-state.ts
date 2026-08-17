export type TrainingHistoryReadState<T> = {
  scopeKey: string;
  status: "unknown" | "ready" | "stale";
  value: T;
};

export function unknownTrainingHistoryRead<T>(emptyValue: T): TrainingHistoryReadState<T> {
  return { scopeKey: "", status: "unknown", value: emptyValue };
}

export function resolveTrainingHistoryRead<T>(
  current: TrainingHistoryReadState<T>,
  scopeKey: string,
  result: PromiseSettledResult<T>,
  emptyValue: T,
): TrainingHistoryReadState<T> {
  if (result.status === "fulfilled") return { scopeKey, status: "ready", value: result.value };
  if (current.scopeKey === scopeKey && current.status !== "unknown") return { ...current, status: "stale" };
  return { scopeKey, status: "unknown", value: emptyValue };
}

export function scopedTrainingHistoryValue<T>(state: TrainingHistoryReadState<T>, scopeKey: string, emptyValue: T): T {
  return state.scopeKey === scopeKey ? state.value : emptyValue;
}

export function scopedTrainingHistoryKnown<T>(state: TrainingHistoryReadState<T>, scopeKey: string) {
  return state.scopeKey === scopeKey && state.status !== "unknown";
}
