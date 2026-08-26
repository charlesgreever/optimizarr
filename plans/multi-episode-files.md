# Plan: Treat multi-episode files as one file

> Spec: `docs/prd.md` 16, 31, 31b, 32, 119, 163. Screenshots: Queue has S08E35 and S08E36 as two succeeded size jobs; Finder shows one MKV `Paw Patrol - S08E35-E36 - …`. Review has two cards and the review folder has one sidecar.

## Outcome

A Sonarr “two episodes, one file” title (Paw Patrol S08E35-E36) is still two rows on Series, but Polisharr treats the **path** as one media file: one inspect, one suggestion, **one queue job**, **one Review card**, one sidecar. Keep replaces that file once. The second episode is labeled as sharing the file, not encoded again.

The live Paw Patrol pair (two Review cards, one file in the review path) must become one Keepable sidecar without a second encode, and Discard of either card must not delete that file while the other card still needs it.

## Today

Library identity is `(instance_id, type, arr_id)`. Sonarr gives two episode ids and the same `episodeFile.path` (and usually the same `episodeFileId`). We upsert two `library_items` with the same `path`.

Jobs and Review lock **per item id** (`activeJobForItem`, `pendingReviewForItem`). Auto-queue after inspect therefore enqueues **both**. Sidecar name is `join(reviewDir, basename(source).replace(ext, .mkv))` (`optimize.ts`), so both jobs write the **same** `.mkv`. Confirmed on disk: two Review entries, one file in the review path.

That pair is already unsafe:

- **Discard** (`jobs.discard`) always `unlink`s `sidecarPath`, then deletes only that review row. Discarding E35 would delete the shared MKV while E36’s card still points at it; Keep then reports the sidecar gone (`SIDECAR_GONE`).
- **Keep** replaces `item.path` for one episode, then `deleteReview` for that card only. Keep All walks every pending review (`keepPending`), so the second card would try to promote a sidecar that the first Keep already moved, or race two promotes of the same file.
- `recoverInterruptedKeeps` also unlinks on `discarding` with no sibling check.

Inspect also probes the same path twice.

## Decisions

1. **Do not collapse Series rows.** Sonarr still has two episodes. Show both, with a pill that they share a file (e.g. **Same file as S08E36**).
2. **File key is the path** (same instance). `episodeFileId` is extra signal when present, but ffmpeg/Keep use the path. Normalize with the existing path string we already store (no new path-mapping layer).
3. **One inspect per path+size.** After a successful inspect, copy the report onto sibling items with the same path (or skip ffprobe when another item already has that `sourceSig`).
4. **One open suggestion per path.** `recomputeSuggestion` still runs per item, but enqueue and auto-queue use path locks. Suggestions list can keep both rows or show the sibling pill; **Queue from either row starts at most one job**.
5. **Path lock on enqueue and Review.** `activeJobForPath(path)` and `pendingReviewForPath(path)` — any sibling item. Second enqueue returns the same kind of 409 as “already has a job/sidecar” (copy: *This file is already in the queue or Review because another episode uses it.*). Auto-queue treats 409 as skip (already does).
6. **One Review card going forward.** `insertReview` is unique per job today; with one job, one card. The **existing Paw Patrol pair is in scope**, not a later cleanup: Keep and Discard must be safe for two review rows that share `sidecar_path` (see Shared-sidecar Keep/Discard). No one-shot DB migrator that deletes a card.
7. **Display on Queue/Review.** If siblings share the path, `displayTitle` for the job/review becomes `Paw Patrol S08E35–E36 · Rescue Knights…` (sorted episode numbers, first episode title or both if short). Series table stays per-episode titles plus the pill.
8. **Keep.** Still replaces `item.path` once. `RefreshSeries` already uses `seriesId` — both episodes update. After Keep, reinspect **every item with that path** (not only the job’s itemId).
9. **Optimize all episodes.** Uses per-episode enqueue; path lock skips the twin. Counts: queued 1, skipped 1 is correct.

## Approach

### 1. Spec

Add **31b**: When two Sonarr episodes share one file, I want one optimize job and one Review sidecar, and I want both episode rows to say they share that file.

### 2. Store helpers (`store.ts`)

```ts
itemsForPath(path: string): LibraryItem[]  // same instance+path
activeJobForPath(path: string): Job | undefined
pendingReviewForPath(path: string): ReviewItem | undefined
reviewsForSidecarPath(sidecarPath: string): ReviewItem[]
```

SQL: `library_items.path = ?` (and instance if we pass it). Jobs join `library_items` on `item_id` where sibling paths match.

Tests: two episodes, same path, different `arr_id` → `itemsForPath` length 2; enqueue lock sees the other’s job.

### 3. Enqueue (`jobs.ts`)

In `enqueue` and `enqueueCustom`, after item lookup:

- if `activeJobForPath(item.path)` and that job is not this item’s, 409 with the copy above
- if `pendingReviewForPath(item.path)` similarly

Keep existing per-item checks.

Test: queue E35, queue E36 → 409; auto-queue path covered by 409 skip.

### 4. Inspect (`inspection-runner.ts`)

Before ffprobe, if another item has an inspection whose `sourceSig` is `path|sizeBytes`, `saveInspection` that report onto this item and `recomputeSuggestion` — no second probe.

After a real probe, `saveInspection` for all `itemsForPath` with the same size.

Test: two items, one probe mock call.

### 5. Titles

`displayTitleForFile(items: LibraryItem[]): string` — if one item, existing `displayTitle`; if several episodes same season, `Show S08E35–E36 · {first episodeTitle}` (or E35 & E36 if not contiguous).

Use for job `displayTitle` at insert time **or** at read (join siblings by path). Prefer **at read** so Queue/Review update if Sonarr adds a third episode later.

`titles.test.ts` table for E35+E36.

### 6. Series UI

On each episode row, if `itemsForPath` in the loaded page (or a `sharedFileWith: string[]` field on the read model) show a muted pill **Same file as E36**. No extra API if the expanded episode page already loaded both rows — compute in the page from `episodes.filter(e => e.path === item.path).length > 1`.

`LibraryRow` already has `path`. Series `LibraryMediaCells` / title cell: pill only, no new route.

### 7. Keep / Discard / reinspect

`reinspectChangedItem` today is one id. After Keep, call it for every `itemsForPath(newPath)` (or old path). Same for size/path update.

Keep of one review that shares a sidecar:

- promote once
- drop **every** pending review row whose `sidecar_path` matches (not only `reviewId`)
- reinspect every `itemsForPath`
- Keep All then has nothing left for the twin

Discard of one review that shares a sidecar:

- delete that review row
- `unlink` the sidecar **only if** no other review still has that `sidecar_path` (`reviewsForSidecarPath` count === 1 before delete)
- `recoverInterruptedKeeps` uses the same rule when status is `discarding`

Tests: two reviews, same sidecar; discard one → file remains, one card left; discard last → file gone. Keep one → library replaced once, both review rows gone, both episode items reinspected.

### 8. Copy

409: **This file is already in the queue or Review. Another episode uses the same file.**
Pill: **Same file as E36** (use the other episode numbers, not a filename).

## Out of scope

- Splitting a multi-episode MKV into two files.
- Merging two Series rows into one.
- A one-shot SQL migrator that deletes the extra Paw Patrol Review row. Behavior change on Keep/Discard is enough for that live pair.

## Shared-sidecar Keep/Discard (required)

Two review rows already share one file. That is the current Paw Patrol state, so Keep/Discard must be correct **in this change**, not a follow-up.

- Discard unlinks only when this is the last review with that `sidecar_path`.
- Keep promotes once, then deletes every review with that `sidecar_path`.
- Keep All must not start a second promote of the same sidecar (path lock or sibling delete after the first Keep).

Copy already in task 8. Tests in task 7.
