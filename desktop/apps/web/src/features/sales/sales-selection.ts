export type SalesEntity = {
  id: string;
};

export function resolveSalesSelection<T extends SalesEntity>(
  rows: T[],
  currentId: string,
  routeEntityId: string,
) {
  if (routeEntityId) {
    return rows.some((row) => row.id === routeEntityId) ? routeEntityId : "";
  }
  if (currentId && rows.some((row) => row.id === currentId)) return currentId;
  return rows[0]?.id || "";
}
