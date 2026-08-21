export function mergePage<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const rows = new Map(current.map((row) => [row.id, row]));
  for (const row of incoming) rows.set(row.id, row);
  return [...rows.values()];
}

export function needsFocusedPage<T extends { id: string }>(
  focusId: string | null,
  rows: T[],
  nextOffset: number | null,
): boolean {
  return focusId !== null && nextOffset !== null && !rows.some((row) => row.id === focusId);
}
