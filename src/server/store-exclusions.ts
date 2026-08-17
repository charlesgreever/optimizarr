import type { DatabaseSync } from "node:sqlite";
import type { ExclusionKind, LibraryItem } from "./models.ts";

export type Exclusion = { id: number; kind: ExclusionKind; value: string };

export class ExclusionStore {
  constructor(private db: DatabaseSync) {}

  add(kind: ExclusionKind, value: string): void {
    this.db.prepare("INSERT INTO exclusions (kind, value) VALUES (?, ?)").run(kind, value.trim());
  }

  list(): Exclusion[] {
    return this.db.prepare("SELECT id, kind, value FROM exclusions ORDER BY id").all() as Exclusion[];
  }

  matches(item: Pick<LibraryItem, "title" | "path" | "quality" | "tags">): boolean {
    return this.list().some((exclusion) => matchesExclusion(exclusion, item));
  }
}

function matchesExclusion(
  exclusion: Exclusion,
  item: Pick<LibraryItem, "title" | "path" | "quality" | "tags">,
): boolean {
  const value = exclusion.value.toLowerCase();
  if (exclusion.kind === "title") return item.title.toLowerCase().includes(value);
  if (exclusion.kind === "path") return item.path.toLowerCase().includes(value);
  if (exclusion.kind === "profile") return (item.quality ?? "").toLowerCase().includes(value);
  return item.tags.some((tag) => tag.toLowerCase() === value);
}
