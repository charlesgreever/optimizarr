# Plan: Auto-queue new Arr imports to Review

> Spec: `docs/prd.md` (today: 22, 206–208, Implementation Decisions “no auto-optimize”). After approval, also save `plans/auto-queue-new-imports.md`.

## Outcome

When Radarr or Sonarr imports or upgrades a file, Polisharr inspects it, and if there is a suggestion I already allow (size, tracks, stereo, ISO/MP4 remux), it **queues a sidecar** without me clicking Queue. I still **Keep or Discard** in Review. The library file is not replaced until Keep.

## Named PRD break

v1 currently forbids auto-optimize: *“The hook never enqueues optimize”* and *“Auto-optimize of new imports”* is out of scope. This plan **opts in** to enqueue for **new or changed Arr files only**, always as a **sidecar**. Keep stays the approval that touches the library file (ENG-09). Direct write is not used for this path.

## Today

Already automatic:

- Interval library sync (~15 min) and Settings Refresh upsert Arr titles, then `inspectPending`.
- Arr Connect `POST /api/hooks/arr` (token in Settings) does a targeted movie/series refresh, then inspect. **Download/Upgrade/Rename do not enqueue** (`app.test.ts`: jobs stay empty).
- Inspect writes a report, `recomputeSuggestion` uses **Default suggestion operations**, Suggestions lights up.
- Queue is a click (or Optimize all on a show). Jobs honor off-peak and concurrency. Sidecar lands in Review.

Not automatic: enqueue. New imports sit on Suggestions until I queue them.

## Decisions

1. **Opt-in, default off.** New suggestion default `queueNewImports` (false). Label: **Queue new Arr imports automatically**. Help: *Polisharr inspects a new or upgraded file and queues its suggestion as a sidecar. Keep still replaces the library file. Direct write is not used for these jobs.*
2. **Only new or changed files after the setting is turned on.** Persist `queueNewImportsSince` (ms) when the checkbox goes from off → on. Auto-queue only if `firstSeenAt >= since` **or** `fileChangedAt >= since`. Existing unread library leftovers that inspect later do **not** dump hundreds of jobs.
3. **Sidecar only.** `jobs.enqueue(..., { writeMode: "sidecar", runNow: false })`. House Direct write does not apply. Off-peak still holds. No software encode fallback.
4. **Same skip rules as a manual Queue.** No suggestion; excluded; search-language-only (title confirm); already queued; sidecar already in Review; hardware-unavailable transcode that `buildSuggestion` already omits.
5. **Webhook still does not enqueue in the HTTP handler.** Inspect finishes, then auto-queue. A Connect Test stays 200 with no job.
6. **No auto Identify language / Whisper.** Untagged `any`/`und` stay on the suggestion rules you already have. Out of scope for this plan.
7. **No auto-Keep.** Review is the gate.

## Approach

### 1. Spec

- PRD 22 stays (inspect automatically).
- Add **22b**: I want an optional setting that queues a sidecar for a new or upgraded Arr file when inspect produces a suggestion, so I only Keep or Discard.
- Rewrite 207 / Implementation Decisions: the hook still does not enqueue in the request; when `queueNewImports` is on, inspect of a new/changed file may enqueue a **sidecar**. Keep is still required. Direct write is not used here.
- Strike “Auto-optimize of new imports” from the out-of-scope list; replace with “Auto-Keep of new imports” and “Auto-queue of the existing library when the setting is first enabled.”

### 2. Store timestamps

`library_items`: `first_seen_at INTEGER NOT NULL DEFAULT 0`, `file_changed_at INTEGER NOT NULL DEFAULT 0`.

- Insert (new Arr id): set both to `now`.
- Path or size change on upsert: set `file_changed_at = now`.
- Existing rows: leave `0` so they never qualify until a real file change.

Settings: `queueNewImports` on `suggestionDefaults`; `queueNewImportsSince` in settings JSON (0 if never enabled). Turning the checkbox **on** sets `since = now` if it was off. Turning it **off** does not clear `since` (turning it back on without a new timestamp would surprise-queue; **always refresh `since` when transitioning off → on**).

Tests in `store.test.ts` / `settings.test.ts`: insert vs path change; enabling the flag stamps `since`.

### 3. `maybeQueueNewImport(itemId)` 

Small function next to `recomputeSuggestion` in `app.ts` (or `jobs.ts` if enqueue options live there):

```
if !settings.suggestionDefaults.queueNewImports: return
if since == 0: return
item = getItem
if item.firstSeenAt < since && item.fileChangedAt < since: return
suggestion = getSuggestion(itemId)
if !suggestion: return
enqueue(itemId, suggestion, { writeMode: "sidecar", runNow: false })
```

409 (already queued / Review) is ignored. `search_language`-only stays a 400 and is ignored (no Arr delete).

Call **after** `recomputeSuggestion` from `inspectItem` success (the runner already calls `recomputeSuggestion`). Pass a single `onInspected(itemId)` from `createApp` so the runner does not import jobs.

`jobs.enqueue` grows an optional `{ writeMode?: WriteMode; runNow?: boolean }`. Default remains settings.writeMode for **manual** Queue.

### 4. Tests (ENG-04)

- **Inspection:** new item + suggestion + setting on → one queued job, `writeMode: "sidecar"` even if settings are `direct`.
- **Old leftover:** `firstSeenAt = 0`, setting on → inspect, suggestion saved, **jobs empty**.
- **Upgrade:** existing item, `fileChangedAt >= since`, new inspection → queued.
- **Setting off:** new item inspect → no job (today’s webhook test still passes).
- **Setting on + webhook Download:** after inspect, job exists; Test event still no job.
- **search_language-only:** no job.
- **UI:** Settings checkbox + help string in `SuggestionDefaultsSettings.test.ts`.

### 5. Copy (CODING_STANDARDS)

- Checkbox: **Queue new Arr imports automatically**
- Help: **A new or upgraded file is inspected, then queued as a sidecar if it has a suggestion. Keep still replaces the library file. This does not queue your existing library when you turn the setting on.**
- Settings webhook help (existing paragraph): add that Connect is how imports arrive quickly; the 15-minute sync still inspects.

### 6. Operator setup (not code)

Arr Connect on Radarr/Sonarr: On Grab is unnecessary; **On Import** / **On Upgrade** / **On Rename** → `http://polisharr:7373/api/hooks/arr` with the token. Document in README next to the webhook section, not a new wiki.

## Out of scope

- Auto-Keep, auto Direct write, auto Whisper language ID.
- Queueing the whole existing library when the box is checked.
- Changing suggestion rules (ISO/MP4/stereo/size still come from the existing defaults).
- Raising inspect concurrency as part of this change.
- CPU encode fallback (still ENG forbidden).
