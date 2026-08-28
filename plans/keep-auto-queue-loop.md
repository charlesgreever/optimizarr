# Plan: Do not auto-queue a file Polisharr just Kept

> Spec: `docs/prd.md` 22b, 24, 160, 161, 206–207. Related: `plans/auto-queue-new-imports.md`.

## Outcome

Keep means I accepted the library file that is now on disk. **Queue new Arr imports automatically** still queues a sidecar for a Radarr/Sonarr import or upgrade. It does **not** queue another sidecar because Keep replaced the library file, even when that file is still over the GB/hour cap. A later Arr upgrade that actually changes the file still auto-queues. Another pass on a missed target stays the explicit **Encode smaller** action on the flagged Review card (PRD 161), not an automatic job after Keep.

## Today

Keep already:

1. Replaces the library file (`promote` / `replaceLibraryFile`).
2. Asks Radarr or Sonarr to `RefreshMovie` / `RefreshSeries` **inside** `promote`, before Polisharr updates its own path and size.
3. Optionally assigns a Polisharr quality profile (which can make the Arr rename the file).
4. Updates `library_items.path` and `size_bytes` (`updateItemFile`; this does **not** stamp `file_changed_at`).
5. Deletes the inspection and re-probes the promoted file (`reinspectChangedItem`).
6. Runs `afterInspect` → `buildSuggestion` → `shouldQueueNewImport` → `jobs.enqueue(..., { writeMode: "sidecar" })`.

`shouldQueueNewImport` is true when the setting is on and **`firstSeenAt >= queueNewImportsSince` OR `fileChangedAt >= queueNewImportsSince`**. A title that was auto-queued as a new import keeps a qualifying `firstSeenAt` forever. Re-inspect after Keep therefore auto-queues again if `buildSuggestion` still sees work.

Avatar-class 4K HDR often still exceeds the 8 GB/hr cap after one encode (PRD 160 flags that sidecar). Keep of that flagged card is exactly “I’ll take this.” The next inspect treats it as a new over-cap file and queues another transcode.

The Arr webhook is a **second** on-ramp, not the only one:

- Connect `Download` / `Upgrade` / `Rename` → targeted Arr refresh → `upsertItem`. Path or size change stamps `file_changed_at = now`.
- `inspectAfterSync` then hits the same `afterInspect` predicate.
- Because `refreshArr` runs before local size is stored, the webhook can stamp `fileChangedAt` on the Keep itself.
- The 15-minute library sync can do the same upsert without a webhook.

Webhook Test events still do not enqueue. Manual Queue and Encode smaller stay available.

## Decisions

1. **Keep is operator approval of the current bytes.** Auto-queue is for Arr-originated new or changed files only (PRD 22b, 24). Polisharr’s own promotion is not an Arr upgrade.

2. **Record the kept size on the library row.** `library_items.kept_size_bytes INTEGER NOT NULL DEFAULT 0`. Set it in `syncLibraryFile` to the promoted size **before** reinspect. Direct-write success uses the same helper. `0` means never kept.

3. **`shouldQueueNewImport` skips the current kept file.** After the existing setting / suggestion / `since` checks:

   ```
   if (item.keptSizeBytes > 0 && item.sizeBytes === item.keptSizeBytes) return false
   ```

   An Arr upgrade that changes size clears the match and may auto-queue again. A rename that keeps the same size does not.

4. **Drop `firstSeenAt` from the auto-queue OR.** New inserts already set `file_changed_at = now`, so a genuine first import still qualifies. Re-inspect of the same bytes no longer qualifies just because the title was first seen after the setting was turned on.

5. **Refresh the Arr after local bookkeeping.** Move `refreshArr` (and profile assign can stay after replace) so `updateItemFile` + `keptSizeBytes` land **before** Radarr/Sonarr are asked to rescan. Same-size upsert then does not stamp `file_changed_at`. Notify players can stay after replace.

6. **Suggestions may still list an over-cap kept file.** That is honest (the cap was missed). Auto-queue must not start the next encode. Queue on the row and Encode smaller on a flagged Review card remain the next-pass paths. Do not auto-set size-exempt on Keep.

7. **No auto-Keep.** Unchanged.

## Approach

### 1. Spec

PRD 207 / Implementation Decisions: after Keep, inspect of the promoted file must not enqueue. Auto-queue remains for an Arr import or upgrade whose size is not the size Polisharr just kept. PRD 24 still applies to a later remux.

### 2. Store

`ensureColumn("library_items", "kept_size_bytes", "INTEGER NOT NULL DEFAULT 0")`. Map `keptSizeBytes` on `LibraryItem`. `updateItemFile` stays path+size only; a dedicated `markKeptSize(id, sizeBytes)` (or an extra argument on `updateItemFile`) writes `kept_size_bytes`. Existing rows stay `0` (never kept in this schema) so they still auto-queue on a real Arr file change.

### 3. Predicate

`shouldQueueNewImport` takes `keptSizeBytes` and `sizeBytes`. Unit table: setting off; `since = 0`; no suggestion; search-language-only; first import (`fileChangedAt >= since`, `keptSizeBytes = 0`) queues; kept size match does not; kept then upgraded size does.

### 4. Keep / promote order

`promote` replaces the file, then returns. `JobService.syncLibraryFile` writes path, size, and kept size, then reinspects, then `refreshArr`. Player notify can remain in `promote` or move with Arr refresh; replace-then-notify failures still must not roll back the file (existing Keep contract).

`reinspectChangedItem` still clears the old inspection and suggestion so Movies shows the new probe. `afterInspect` still saves a suggestion when the kept file is over cap. `jobs.enqueue` is not called for that inspect.

### 5. Tests (ENG-04)

Public behavior, no SQL assertions:

- **Keep of an over-cap sidecar with auto-queue on:** Review card gone, history `kept`, **jobs empty**. Probe of the promoted file still runs.
- **Webhook Download after that Keep, Arr reports the kept size (path may change):** still no job.
- **Webhook / upsert with a different larger size (Arr upgrade):** one sidecar job.
- **New import (never kept, `fileChangedAt >= since`):** still one sidecar job (today’s intended behavior).
- **Connect Test:** 200, no job (existing).
- **firstSeenAt recent, fileChangedAt old, same size:** inspect does not enqueue.
- **Direct write** of an over-cap result: `kept_size_bytes` set, no follow-up auto-queue.

Wire this through `createApp` HTTP where Keep and `/api/hooks/arr` already have coverage (`app.test.ts`, `jobs-keep.test.ts`, `auto-queue.test.ts`).

### 6. Copy

Settings help for **Queue new Arr imports automatically**: add that Keep does not queue the file you just accepted. A new Arr upgrade still can.

## Out of scope

- Auto-exempt on Keep, auto-Keep, changing size caps or encoder targets.
- Stopping inspect after Keep (Movies still needs a fresh probe).
- Changing webhook auth or Connect event types.
- Queueing the existing library when the setting is turned on (already forbidden).
