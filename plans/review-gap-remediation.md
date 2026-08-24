# Plan: Full-main review gap remediation

> Source: code review of `HEAD` `c89ff7e` against `ENGINEERING_STANDARDS.md`, `docs/prd.md`, and `docs/v2 prd.md`.
> Home **Status** is specified product, not creep. Document it, then close the remaining findings.

## Architectural decisions

- **Auth:** Every `/api/integrations` route, including the collection path, requires a session (or the documented local-address bypass).
- **Home Status:** A one-line sentence: running title, how many jobs are waiting, or Idle.
- **Job logs:** One bounded `log` column per job (last 32 KiB). `GET /api/jobs/:id/logs` returns it.
- **Flagged size:** Custom size-mode jobs miss when output is larger than source or more than 5% over `targetBytes`. Bulk jobs still use the category GB/hour cap.
- **Re-queue flagged:** Discard the sidecar, then enqueue a size-mode job at 80% of the previous target (or 80% of the sidecar size).
- **AV1:** Offer AV1 only when hardware lists an AV1 encoder.
- **Named breaks:** Keep `?apikey=` on Arr webhooks (ENG-06) because Radarr/Sonarr Connect often has only a URL field. Do not split `createApp` (ENG-01) — it is the HTTP module. Web and server types stay duplicated (two bundles, ENG-10). Legacy settings tests still insert raw JSON because that is the public migration behavior (ENG-04).

---

## Phase 1: Auth and fail-closed encode

**User stories:** v1 #7, #13; ENG-05, ENG-07

### What to build

Unauthenticated `GET`/`POST /api/integrations` is 401. A muxed file that ffprobe cannot read fails the job instead of copying the source duration into encode args.

### Acceptance criteria

- [x] `POST /api/integrations` without a session is 401
- [x] Encode does not use the source inspection as the muxed-file probe result

---

## Phase 2: Settings and first-run gaps

**User stories:** v1 #9, #18, #77, #182; v2 #42

### What to build

Settings can change username and password, pause an Arr with enabled, mint a widget key (shown once), and hide AV1 when hardware cannot encode it.

### Acceptance criteria

- [x] Password change uses `POST /api/auth/password`
- [x] An Arr row can be enabled or paused
- [x] Settings mints a widget key the same way as the webhook token
- [x] Encode and title codec pickers omit AV1 when `hardware.av1` is false

---

## Phase 3: Queue, logs, Review, Home, Title

**User stories:** v1 #20, #56, #108, #124, #143, #146, #158, #161, #165; v2 #38, #44, #47, #50, #65, #72, #73

### What to build

Opening the signed-in app refreshes the library. After inspect ends, a dismissible Errors link remains if files failed. Queue can pause, resume, and reorder. Job rows show write mode and size vs quality. Operators can open bounded per-job logs. Review shows duration and GB/hour, reports skipped Keep counts, and can re-queue a flagged sidecar more aggressively. Title Queue stays off until a previewed plan differs from the source; unreadable titles disable optimize. Home help counts Keep and direct write. Status stays on Home.

### Acceptance criteria

- [x] Signed-in shell refresh runs once on open
- [x] Failed-inspect banner links to Errors and can be dismissed
- [x] Pause/resume/reorder work from Queue
- [x] `GET /api/jobs/:id/logs` returns a bounded log
- [x] Review cards show duration and GB/hour; Keep copy includes skipped
- [x] Flagged cards expose Encode smaller
- [x] Title Queue is disabled until preview succeeds with a real plan
- [x] Home help mentions direct write; Status remains

---

## Phase 4: Types, copy, and tests

**User stories:** ENG-02, ENG-03, ENG-11; v1 #47 Errors empty copy

### What to build

Closed unions on public web types. Settings write-mode select does not use `as`. Errors empty copy says unreadable. Dead `publicSecretFlag` and unused `planHasVideoTranscode` in promote go away.

### Acceptance criteria

- [x] `npm test` and `npm run typecheck` pass
