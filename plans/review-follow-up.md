# Plan: Review follow-up and open issues

> Source: code review of `main` `5545611` against [docs/prd.md](../docs/prd.md) (v1), [docs/v2 prd.md](../docs/v2%20prd.md) (v2), [ENGINEERING_STANDARDS.md](../ENGINEERING_STANDARDS.md), and [CODING_STANDARDS.md](../CODING_STANDARDS.md).
> Open GitHub issues: [#42](https://github.com/charlesgreever/polisharr/issues/42), [#43](https://github.com/charlesgreever/polisharr/issues/43).
> [open-issues.md](open-issues.md) issues #22–#40 are already implemented. This plan does not reopen them.

## Finding map

| Axis | Item | Phase |
| --- | --- | --- |
| Standards hard | ENG-09 Keep crash deletes `.opt-old` original | 1 |
| Spec wrong | v1 #133 / v2 #67 cancel or failed direct write can replace or leave leftovers | 1 |
| Spec missing | v2 #45 / #61 custom queue does not negate the bulk suggestion | 2 |
| Spec missing | v1 #4 first-run is a Settings banner, not a collection flow | 3 |
| Spec missing | v2 #54j title page hides Identify instead of saying the tool is missing | 4 |
| Spec missing | v1 #180 exemption is an unlabeled icon | 4 |
| Standards judgement | RULE-01 “from the Arr yet” | 4 |
| Standards judgement | ENG-03 `as never` in custom-plan tests | 5 |
| Standards judgement | ENG-11 `ArrEpisode = ArrMovie` | 5 |
| Standards judgement | Data clump `url` + `apiKey` | 5 |
| Open issue | #42 running version in chrome, health, Report | 6 |
| Open issue | #43 mobile login does not advertise username/password | 6 |

Out of scope for this plan: light-theme toggle (review called it creep, not a defect), software encode fallback, auto-Keep, Discard selected/all.

## Architectural decisions

- **Staged replace:** Keep and direct write copy the finished sidecar (the Review copy) to `destPath` plus a unique `.opt-new` suffix, then rename the library file to `destPath.opt-old`, then rename the staged file onto `destPath`. Recovery is restore-first: if `destPath` is missing and `destPath.opt-old` exists, rename the backup back. Delete `.opt-old` only after `destPath` exists and matches the sidecar. Never glob-unlink every `.opt-old` / `.opt-new` in the folder.
- **Cancel vs Keep:** Cancel before replace starts unlinks the review-path temp and leaves the library file. Cancel during replace uses the same restore. Cancel after a finished replace is too late; the job is kept (do not rewind a completed promote).
- **Custom queue:** Queueing a custom plan dismisses that title’s open automatic suggestion (and any sibling suggestion that shares the same file). Suggestions no longer lists it. The library row Plan column shows the custom plan reasons.
- **First-run:** After the admin account exists, signed-in users stay on `/setup` until `firstRun.complete`. Required: preferred language confirmed, review folder (where finished copies wait for Keep), at least one enabled Radarr or Sonarr. Players (Plex/Jellyfin) are an optional step with Skip. Existing `gateOptimize()` stays as the server gate. `/settings` remains the later editor.
- **Version:** The public label is `package.json` `version` (for example `0.2.1`). `/api/health` includes it without a session. No git SHA or Docker digest as the primary label.
- **Named break:** Keep accepting `?apikey=` on `/api/hooks/arr` after header/Basic (ENG-06 prefer, issue #41). Radarr/Sonarr Connect often has only a URL field.

---

## Phase 1: Sacred original on Keep and direct write

**User stories:** v1 #119, #133, #137, #144, #154a–c; v2 #67; ENG-05, ENG-09

### What to build

Interrupted Keep and failed or cancelled direct write leave the original library bytes in place. Recovery restores `destPath.opt-old` when the library path is empty, then returns the Review card to pending. A failed direct write deletes the review-path sidecar. Cancel during the library copy restores and stays cancelled; a replace that already finished counts as kept.

### Acceptance criteria

- [x] Crash after the original has been renamed to `.opt-old` and before the new file lands: startup restores the original at the library path; Review is pending with the interrupted message; Discard still has the original
- [x] Recovery never deletes `.opt-old` unless the library path already holds the sidecar
- [x] Recovery only touches staged files for that destination, not every `.opt-*` in the folder
- [x] Cancel after encode but before replace: job stays cancelled, original untouched, review-path output gone
- [x] Cancel after replace finished: job is kept (not rewound)
- [x] Failed direct write: original untouched, review-path sidecar deleted, job failed with the replace error
- [x] Existing 154a–c tests still pass (sidecar+original → pending; already-replaced → kept; sidecar gone → not 200)

---

## Phase 2: Custom plan negates the bulk suggestion

**User stories:** v2 #45, #61

### What to build

Queueing a title-page plan dismisses the automatic suggestion for that title (and siblings that share the file). Suggestions no longer lists the old card, so bulk-approve cannot start the leftover plan. The Movies/Series Plan column shows the custom plan reasons while that job is active.

### Acceptance criteria

- [x] `POST` custom queue returns 2xx and that item is absent from `GET /api/suggestions`
- [x] Library row `reasons` match the custom plan, not the dismissed bulk card
- [x] A second job on the same title or shared file is still 409
- [x] Bulk Queue of a dismissed suggestion is 404/409, not a new encode
- [x] Fixture test: validate-and-enqueue custom plan without a browser (v2 #87)

---

## Phase 3: First-run collection flow

**User stories:** v1 #4, #5, #14; ENG-07

### What to build

Create admin still happens on login. After that, `/setup` collects preferred language (with the confirm checkbox), review folder, at least one enabled Radarr or Sonarr (URL, API key, test-connection), then optional Plex/Jellyfin. Until `firstRun.complete`, the signed-in app does not render Home/Movies/Series. Optimize, queue, and Keep remain 403 if someone calls the API anyway. Players can be skipped.

### Acceptance criteria

- [x] Signed-in, incomplete first-run: UI is `/setup`, not the library shell
- [x] Completing language + review folder + one enabled Radarr or Sonarr sets `firstRun.complete` and opens Home
- [x] Skip players does not block complete
- [x] Queue/Keep/Force still 403 until complete (existing gate)
- [x] Test-connection failures stay on the Arr step with the connection error
- [x] Copy names Radarr and Sonarr; review folder is defined as the place finished copies wait for Keep

---

## Phase 4: Identify-language, exemption, and Arr jargon

**User stories:** v2 #54j, #54m; v1 #93, #97, #180; RULE-01, RULE-03

### What to build

When language identification is not installed, an untagged audio track shows a sentence that Identify language needs `WHISPER_LID` and does not show a listen button. PGS already explains image subs; keep that. Size exemption on movie/episode rows gets visible text (`Exempt` / `Clear exemption`) plus Movies/Series help that defines it in everyday words. Title facts say Radarr or Sonarr, not “the Arr.”

### Acceptance criteria

- [x] Title payload `languageId.available: false` plus an untagged audio track: page text names the missing tool; no Identify button
- [x] Same page with `available: true` still shows Identify language
- [x] Row action shows Exempt / Clear exemption (not icon-only)
- [x] Movies and Series help mention size exemption once
- [x] Title facts empty path: “No file name from Radarr or Sonarr yet.” (and the path line the same way)

---

## Phase 5: Types and test fixtures

**User stories:** ENG-02, ENG-03, ENG-11; v2 #87

### What to build

Episode rows are not typed as movies: shared media fields live on a base title type; episodes add series/season/episode fields. Arr HTTP takes one `{ url, apiKey }` value instead of two loose strings. Custom-plan tests reject “downscale on copy” through a real draft or JSON body, not `as never`. Copy-mode draft may include `downscale1080p` so the validator can reject it.

### Acceptance criteria

- [x] No `ArrEpisode = ArrMovie` (ENG-11)
- [x] `fetchJson` / Radarr and Sonarr tests / profile assign share one connection object
- [x] `custom-plan.test.ts` has no `as never` / `as any`
- [x] JSON `{ video: { mode: "copy", downscale1080p: true } }` is a field error, not a transcode

---

## Phase 6: Running version and mobile login

**User stories:** GitHub #42, #43; v1 #7, #192, #195

### What to build

The running `package.json` version appears under the sidebar Polisharr wordmark (small, muted), on Settings if convenient, on unauthenticated `GET /api/health` next to `service`, and in Report’s Context line. A container from tag `v0.2.1` still shows `0.2.1` when the image tag is `latest`. Login and first-run account fields use `name`, `id`, and autocomplete tokens (`username` / `current-password` or `new-password`) plus `method="post"` so iOS/Android password managers treat them as a login form.

### Acceptance criteria

- [x] `GET /api/health` includes `version` matching `package.json`; no session required
- [x] Signed-in chrome shows that same string; tests assert chrome string equals health
- [x] Report GitHub prefill includes `Version: 0.2.1` (or current); no paths or secrets
- [x] Login username field: `name="username"` `autoComplete="username"`; password: `name="password"` `autoComplete="current-password"` (setup uses `new-password`)
- [x] Form `method="post"`; username is not autocapitalized

---

## Verification gate (every phase)

- `npm test`, `npm run typecheck`, `npm run build`
- Tests assert HTTP, file bytes, and visible copy (ENG-04). Do not assert SQL or private `store.db` calls.
- Hardware miss still fails the job (ENG-05). ffmpeg / `mkvmerge` stay argument arrays (ENG-08).
