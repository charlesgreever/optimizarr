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

export function refreshFirstPage<T extends { id: string }>(
  current: T[],
  incoming: T[],
  pageSize: number,
  total: number,
): T[] {
  return refreshFirstPageByKey(current, incoming, pageSize, total, (row) => row.id);
}

export function refreshFirstPageByKey<T>(
  current: T[],
  incoming: T[],
  pageSize: number,
  total: number,
  keyOf: (row: T) => string,
): T[] {
  const firstIds = new Set(current.slice(0, pageSize).map(keyOf));
  const incomingIds = new Set(incoming.map(keyOf));
  const tail = current.filter((row) => !firstIds.has(keyOf(row)) && !incomingIds.has(keyOf(row)));
  return [...incoming, ...tail].slice(0, total);
}

export function retainedNextOffset(loaded: number, total: number): number | null {
  return loaded < total ? loaded : null;
}

export async function loadRetainedPages<T extends { id: string }>(
  loadPage: (offset: number) => Promise<{ items: T[]; nextOffset: number | null }>,
  loadedCount: number,
): Promise<{ items: T[]; nextOffset: number | null }> {
  let items: T[] = [];
  let nextOffset: number | null = 0;
  const want = Math.max(loadedCount, 1);
  while (nextOffset != null && items.length < want) {
    const page = await loadPage(nextOffset);
    items = mergePage(items, page.items);
    nextOffset = page.nextOffset;
    if (page.items.length === 0) break;
  }
  return { items, nextOffset };
}
