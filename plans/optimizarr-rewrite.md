# Plan: Optimizarr Rewrite

> Source PRD: `docs/prd.md` on `main` at commit `81f2f72`

## How to use this plan

Implement the phases in order. Each phase is a thin, testable increment and must leave the application runnable. Write tests against public behavior in the same phase as the behavior. Apply `ENGINEERING_STANDARDS.md` and `CODING_STANDARDS.md` throughout; user story 185 therefore applies to every phase. Do not import code, tests, images, containers, or plans from the retired Optimizarr implementation.

## Architectural decisions

- **Application**: Build a greenfield, single-process TypeScript companion service with a web UI and persistent state. Package it as one portable container.
- **Library ownership**: Radarr and Sonarr remain the systems of record. Treat their reported network paths as authoritative. Do not add path translation in v1.
- **Integrations**: Support multiple independently enabled Radarr and Sonarr instances. Support explicitly configured Plex and Jellyfin players.
- **Persistence**: Persist settings, normalized library records, inspection results, suggestions, jobs, reviews, and activity beneath the configured data volume. Keep persistence behind domain-facing interfaces; do not make callers depend on table layouts.
- **Boundaries**: Keep Auth, Settings and first-run, Library sync, Media inspector, Suggestion engine, Job queue and scheduler, Optimize runner, Review and promote, Player notifier, Activity and savings, and Web UI as modules with small public interfaces.
- **External data**: Accept Arr JSON, player responses, `ffprobe` output, and `mkvmerge` identification as `unknown`; validate and convert them into domain values once at the boundary.
- **Sync and inspect**: Store Arr library rows immediately, return refresh without waiting for probes, and inspect changed files in the background with bounded concurrency and retries.
- **Policy**: Compute suggestions from persisted inspection reports and settings. The inspector does not decide policy, and the runner does not create or reinterpret suggestions.
- **Video policy**: Use GB per hour caps. Default to HEVC. Offer AV1 only when selected and supported by detected hardware. Preserve source bit depth and warn about Dolby Vision or HDR10+ metadata loss.
- **Track policy**: Keep all preferred-language audio and subtitles, drop other languages and untagged tracks except a lone untagged dialogue track, retain original surround, and add AAC 2.0 when requested.
- **Media tools**: Use `ffprobe` for inspection, ffmpeg for hardware video encoding and AAC creation, and `mkvmerge` for track selection and muxing. Invoke tools with argument arrays, never a shell.
- **Execution**: Run jobs asynchronously. Default to one concurrent job, honor configured concurrency exactly, support off-peak holds and run-now, and persist phase and progress.
- **File safety**: Write temporary and finished output only under the review path. Never alter the library original before Keep. Cancel, failure, and restart must leave the original intact.
- **Review**: A successful job creates one sidecar for review. Keep promotes it asynchronously; Discard removes it. A pending sidecar locks further work for that title.
- **Authentication**: Use one local administrator, a modern password hash, server-side sessions, and an optional local-address bypass. Enforce authorization and first-run gates on the server.
- **Secrets**: Encrypt integration secrets at rest or use an equivalently protected store. Never return saved secrets, hashes, session identifiers, or tokens through JSON or logs.
- **Testing**: Test module behavior through public interfaces with recorded documents, small media fixtures, fake clocks, fake child processes, fake filesystems, and fake HTTP services. Do not require a live NAS, Arr, player, or GPU.
- **Routes**: Reserve `/api/auth/*`, `/api/settings`, `/api/integrations/*`, `/api/library/*`, `/api/inspect/*`, `/api/suggestions`, `/api/jobs`, `/api/review`, `/api/errors`, `/api/history`, `/api/home`, `/api/search`, `/api/widget`, and `/api/homepage`. Keep precise subroutes consistent once introduced.
- **Primary navigation**: Home, Movies, Series, Suggestions, Queue, Review, Errors, History, and Settings.

---

## Phase 1: Bootable application skeleton

**User stories**: 1, 2, 11, 12, 185

### What to build

Create the new TypeScript service, web application, test harness, and development commands. Expose one page and one health endpoint while establishing strict types and the module boundaries named above.

### Acceptance criteria

- [ ] A clean checkout installs, type-checks, tests, builds, and starts with documented commands.
- [ ] The browser renders an Optimizarr placeholder and the health endpoint returns a typed success payload.
- [ ] Strict TypeScript is enabled, no `any` is introduced, and tests observe only public behavior.

---

## Phase 2: Persistent health and runtime configuration

**User stories**: 11, 12, 13, 185

### What to build

Load runtime settings from environment variables, initialize persistent application storage, and report safe readiness information without exposing secrets.

### Acceptance criteria

- [ ] Restarting with the same configuration volume preserves a probe record written through the public store interface.
- [ ] PUID, PGID, timezone, port, configuration directory, and tool locations come from environment configuration.
- [ ] Health and readiness responses contain no environment secrets or filesystem contents.

---

## Phase 3: Hardware capability discovery

**User stories**: 3, 76, 77, 142, 185

### What to build

Detect CUDA, VAAPI, and hardware AV1 encoding through an injectable capability probe and expose the result through an authenticated status API.

### Acceptance criteria

- [ ] Recorded tool responses produce correct CUDA, VAAPI, and AV1 capability values.
- [ ] Missing devices or tools produce an unavailable result with a useful reason rather than crashing startup.
- [ ] The API never advertises AV1 when the selected backend cannot encode it.

---

## Phase 4: Administrator creation and login

**User stories**: 4, 7, 10, 191

### What to build

Create the first administrator account and implement login with a modern password hash and a generic invalid-credentials response.

### Acceptance criteria

- [ ] First-run accepts one username and password and stores no plaintext password.
- [ ] Correct credentials create an authenticated session; either wrong field returns the same rejection.
- [ ] Protected API routes reject unauthenticated public-address requests.

---

## Phase 5: Sessions, logout, and expiry

**User stories**: 7, 11, 191

### What to build

Persist server-side sessions, issue secure cookies, expire sessions, and support logout.

### Acceptance criteria

- [ ] A valid cookie survives an application restart until its stored expiry.
- [ ] Logout invalidates the server-side session immediately.
- [ ] An expired or unknown session cannot access a protected endpoint.

---

## Phase 6: Credential rotation and local-address bypass

**User stories**: 8, 9, 191

### What to build

Allow an authenticated administrator to rotate credentials and optionally bypass login for correctly identified local addresses.

### Acceptance criteria

- [ ] Changing the username or password invalidates obsolete credentials and existing sessions as defined by the API contract.
- [ ] Local bypass works only when enabled and the trusted request address is local.
- [ ] Forwarded headers from an untrusted peer cannot manufacture local status.

---

## Phase 7: Secure settings storage

**User stories**: 4, 6, 13, 18, 172, 185

### What to build

Persist non-secret application settings and protected Arr/player credentials behind a settings API that returns only presence flags for saved secrets.

### Acceptance criteria

- [ ] Saving and reloading a secret works through the integration client without returning it to the browser.
- [ ] Settings JSON reports `hasApiKey` or `hasToken` instead of the stored value.
- [ ] Logs and validation errors contain no passwords, API keys, tokens, or encryption material.

---

## Phase 8: Radarr connection management

**User stories**: 14, 15, 17, 18, 48

### What to build

Add, edit, enable, disable, remove, and test named Radarr connections independently.

### Acceptance criteria

- [ ] Two Radarr instances retain independent URLs, keys, names, and enabled states.
- [ ] Test connection distinguishes authentication, connectivity, and incompatible-response failures in plain language.
- [ ] Removing or disabling one instance does not alter another instance.

---

## Phase 9: Sonarr connection management

**User stories**: 14, 16, 17, 18, 48

### What to build

Add the equivalent independent lifecycle and test behavior for Sonarr connections.

### Acceptance criteria

- [ ] Two Sonarr instances retain independent URLs, keys, names, and enabled states.
- [ ] The test action validates a Sonarr-shaped response rather than accepting any HTTP success.
- [ ] A bad URL or key produces an actionable error and never leaks the key.

---

## Phase 10: Plex and Jellyfin connection management

**User stories**: 14, 149, 172, 189

### What to build

Manage and test multiple explicitly typed Plex and Jellyfin player connections.

### Acceptance criteria

- [ ] Plex and Jellyfin test actions use their correct authentication and success semantics.
- [ ] Saved tokens return only presence flags.
- [ ] A failing player does not prevent testing or saving another player.

---

## Phase 11: First-run completion and language confirmation

**User stories**: 4, 5, 6

### What to build

Finish onboarding only after required settings exist, including review path, at least one enabled Arr, and explicit preferred-language confirmation.

### Acceptance criteria

- [ ] The UI shows incomplete steps and cannot claim completion while a required value is missing.
- [ ] The chosen language persists and requires one explicit confirmation before optimization.
- [ ] Editing the preferred language later does not silently reset unrelated settings.

---

## Phase 12: Server-side optimize gating

**User stories**: 4, 5, 7, 13

### What to build

Centralize authorization and first-run checks for every mutation that can queue, optimize, Keep, or otherwise change media state.

### Acceptance criteria

- [ ] Direct API calls cannot bypass missing authentication or incomplete first-run state.
- [ ] Rejections identify the missing setup step without exposing a secret.
- [ ] Read-only setup endpoints remain available where needed to finish onboarding.

---

## Phase 13: Single-Radarr movie synchronization

**User stories**: 15, 19, 20, 21, 36, 48, 49

### What to build

Fetch one enabled Radarr library, validate its responses, normalize movies and files, persist instance provenance, and return before inspection starts.

### Acceptance criteria

- [ ] A fake Radarr response produces movie rows with authoritative paths, file sizes, quality, and instance identity.
- [ ] Refresh returns after rows are stored without waiting for a fake slow inspector.
- [ ] Authentication, connectivity, and unreadable-path failures remain distinguishable.

---

## Phase 14: Multiple-Radarr aggregation

**User stories**: 15, 17, 18, 36

### What to build

Synchronize all enabled Radarr instances into one library without conflating copies of the same title.

### Acceptance criteria

- [ ] A 1080p and 4K copy from different instances remain distinct rows with provenance.
- [ ] A failed instance is reported while successful instances still refresh.
- [ ] Disabled instances receive no requests and retain a well-defined stale/removal policy.

---

## Phase 15: Single-Sonarr series and episode synchronization

**User stories**: 16, 19, 20, 21, 36, 37, 48, 49, 164

### What to build

Fetch one Sonarr library and normalize series, seasons, episodes, episode files, authoritative paths, and display identity.

### Acceptance criteria

- [ ] Episode records preserve show title, season and episode numbers, episode title, file metadata, path, and instance.
- [ ] Episode rows are typed as TV media regardless of duration.
- [ ] Sync returns before inspection and reports connection versus path failures clearly.

---

## Phase 16: Multiple-Sonarr aggregation

**User stories**: 16, 17, 18, 36

### What to build

Synchronize all enabled Sonarr instances into a unified series library while preserving each copy's origin.

### Acceptance criteria

- [ ] Same-named series from separate instances never overwrite each other's episodes.
- [ ] Partial instance failure leaves successful results available and visible.
- [ ] Enable, pause, and removal behavior matches Radarr behavior.

---

## Phase 17: Artwork proxy and placeholders

**User stories**: 34, 35, 36

### What to build

Persist Arr artwork references and serve poster bytes through authenticated Optimizarr routes with a neutral fallback.

### Acceptance criteria

- [ ] Browser poster requests never contain an Arr API key.
- [ ] Valid artwork is streamed with safe content headers and cache behavior.
- [ ] Missing or failed artwork renders a neutral placeholder without breaking a row.

---

## Phase 18: Useful pre-inspection library metadata

**User stories**: 28, 36, 58, 59

### What to build

Expose available Arr media metadata immediately while marking it clearly as provisional and preventing suggestion or queue creation from it.

### Acceptance criteria

- [ ] Newly synced rows display available codec, resolution, quality, HDR, and size before inspection.
- [ ] Provisional rows cannot produce a plan or optimize job.
- [ ] Real inspection data replaces provisional display fields without changing title identity.

---

## Phase 19: Background inspection scheduling

**User stories**: 20, 21, 22, 23, 24, 55, 57

### What to build

Schedule bounded background inspection after sync, detect new or upgraded files, and skip unchanged path-and-size records.

### Acceptance criteria

- [ ] A new import queues one inspection automatically and no optimization job.
- [ ] A changed path or size queues reinspection; unchanged path and size do not call the probe.
- [ ] Inspection concurrency stays within its configured small cap.

---

## Phase 20: Typed ffprobe document parsing

**User stories**: 28, 37, 81, 82, 83, 187

### What to build

Convert recorded `ffprobe` documents into inspection reports containing duration, playable video, bit depth, HDR, codec, audio, subtitles, and size per hour.

### Acceptance criteria

- [ ] Cover-art streams never determine playable resolution.
- [ ] Coded dimensions provide a fallback when display dimensions are missing.
- [ ] Recorded fixtures cover 1080p, 2160p, HDR, Dolby Vision, audio layout, languages, and malformed documents.

---

## Phase 21: Inspection retry and distinct-error accounting

**User stories**: 49, 50, 51, 52, 53, 54, 56, 187

### What to build

Retry transient probe failures a bounded number of times, then persist one current error per distinct file.

### Acceptance criteria

- [ ] A permanently failing path ends after the configured retry limit.
- [ ] Retry attempts do not inflate the distinct failed-file count.
- [ ] A later successful inspection clears or resolves that file's active error.

---

## Phase 22: Inspection progress and completion state

**User stories**: 47, 55, 56, 57

### What to build

Publish sync-ready and inspection-progress state with accurate remaining counts and a terminal success or failure summary.

### Acceptance criteria

- [ ] The API distinguishes Arr list readiness from files still awaiting probe.
- [ ] Remaining count reaches zero even when bounded failures occur.
- [ ] The banner disappears on success or changes to a dismissible Errors link on failure.

---

## Phase 23: Errors API and actionable Errors page

**User stories**: 47, 49, 50, 51, 52, 53, 54, 56, 164

### What to build

List each currently unreadable file with its filename, full path, known Arr title, episode identity, and concrete reason.

### Acceptance criteria

- [ ] Error count equals distinct active file errors.
- [ ] Movie and episode errors include enough identity and path information to fix mounts, permissions, or corruption.
- [ ] Unreadable rows disable optimize actions and the empty state explains that nothing needs attention.

---

## Phase 24: Configurable size-cap policy

**User stories**: 68, 69, 70, 71, 72, 73, 186

### What to build

Implement persisted GB-per-hour caps for the five PRD categories and calculate target size or bitrate from actual duration.

### Acceptance criteria

- [ ] Defaults are 2.5, 6, 8, 1.0, and 4.0 GB/hour for the specified categories.
- [ ] Changing one cap affects subsequent policy evaluation without altering other caps.
- [ ] Table-driven fixtures prove short TV and long movie files use duration fairly.

---

## Phase 25: Reliable resolution and HDR classification

**User stories**: 37, 68, 69, 79, 80, 81, 82, 83, 84, 187

### What to build

Classify movie versus TV, 1080p versus 4K, and SDR versus HDR from Arr identity, Arr quality labels, and the largest playable video stream.

### Acceptance criteria

- [ ] Sonarr files always use TV policy and Radarr files always use movie policy.
- [ ] `2160p`, `4K`, or `UHD` Arr labels select 4K even when probe metadata is misleading.
- [ ] Suggestions and enqueue recompute the current category instead of trusting stale stored cap text.

---

## Phase 26: HEVC suggestion policy

**User stories**: 72, 73, 74, 75, 78, 91, 174, 186

### What to build

Suggest an HEVC hardware encode for over-cap or explicitly forced inefficient video while preserving source bit depth and never downgrading AV1.

### Acceptance criteria

- [ ] Over-cap H.264 produces an HEVC plan aimed at its category target.
- [ ] Under-cap video receives no size suggestion unless explicitly forced.
- [ ] Existing AV1 never receives an HEVC conversion suggestion.

---

## Phase 27: Hardware-gated AV1 suggestion policy

**User stories**: 76, 77, 78, 91, 142, 186

### What to build

Allow AV1 as an opt-in target only when the selected detected backend supports it.

### Acceptance criteria

- [ ] AV1 settings and actions are hidden or disabled without capability.
- [ ] A capability change invalidates an impossible AV1 enqueue rather than inventing success.
- [ ] AV1 source files remain healthy when no other work applies.

---

## Phase 28: Preferred-language track policy

**User stories**: 6, 85, 86, 87, 88, 89, 90, 186

### What to build

Produce tracks-only work that keeps all preferred-language audio and subtitles, drops other languages and untagged tracks, and protects a lone untagged dialogue track.

### Acceptance criteria

- [ ] Preferred SDH, forced, commentary, audio, and subtitle tracks all remain selected.
- [ ] A lone untagged dialogue track is kept; removable untagged or other-language tracks are identified.
- [ ] Already-efficient under-cap video with messy tracks receives tracks-only work, not a transcode.

---

## Phase 29: Stereo suggestion policy

**User stories**: 61, 67, 98, 99, 100, 173, 186

### What to build

Auto-suggest AAC stereo for Atmos or layouts above 5.1 and allow manual stereo for any inspected file without an existing stereo track.

### Acceptance criteria

- [ ] Atmos and 7.1 fixtures receive stereo work while original surround remains selected.
- [ ] A file with stereo receives no auto suggestion and manual Add stereo reports no change.
- [ ] A 5.1-or-lower file can still receive stereo through an explicit manual action.

---

## Phase 30: Honest suggestion explanations

**User stories**: 29, 62, 63, 64, 65, 66, 67

### What to build

Describe why work exists and provide accurate Now and After comparisons in everyday language.

### Acceptance criteria

- [ ] Reasons name concrete conditions such as too large, extra languages, or no TV-friendly stereo.
- [ ] Tracks-only work leaves target size and GB/hour blank.
- [ ] Estimated savings appear only for size-related work backed by a real estimate.

---

## Phase 31: Suggestion lifecycle and dismissal

**User stories**: 23, 38, 39, 40, 59

### What to build

Persist open and dismissed suggestions generated only from completed inspections and expose individual approval and dismissal.

### Acceptance criteria

- [ ] Healthy and provisional files do not appear in the open suggestion list.
- [ ] Dismissal removes the suggestion and survives refresh without deleting inspection data.
- [ ] Approving a suggestion creates queue intent exactly once.

---

## Phase 32: Force-transcode and manual-stereo actions

**User stories**: 30, 60, 61, 92, 99

### What to build

Turn explicit Force and Add stereo actions into real persisted suggestion work and reject unreadable or no-op requests.

### Acceptance criteria

- [ ] Successful Force immediately makes the inspected title appear in Suggestions.
- [ ] Successful Add stereo does the same and never claims unrelated tracks will be removed.
- [ ] Unreadable and already-stereo requests return non-success responses with useful messages.

---

## Phase 33: Sticky per-title size exemptions

**User stories**: 30, 42, 67, 93, 94, 95, 96, 97

### What to build

Persist a size-cap exemption on exactly one movie or episode while continuing to evaluate track cleanup and stereo.

### Acceptance criteria

- [ ] Exemption removes size/transcode work but retains applicable track and stereo work.
- [ ] Exempting one episode does not affect its series, season, or neighboring episodes.
- [ ] Clearing the exemption recomputes and restores eligible size work.

---

## Phase 34: Path, profile, tag, and title exclusions

**User stories**: 42, 171

### What to build

Allow independent exclusion rules that hide matching titles from suggestions entirely.

### Acceptance criteria

- [ ] Path, quality profile, tag, and individual-title rules each match normalized library data.
- [ ] Exclusions differ from size exemptions by suppressing all suggestion work.
- [ ] Removing a rule recomputes eligible suggestions without reprobing unchanged files.

---

## Phase 35: Movies table

**User stories**: 25, 27, 28, 29, 34, 35, 36, 47, 50

### What to build

Render a sortable Arr-like movie table with poster, provenance, media facts, inspection state, health, errors, and a plain-language plan.

### Acceptance criteria

- [ ] Every required movie column can be read and relevant columns can be sorted.
- [ ] Duplicate titles from separate Arrs remain distinguishable.
- [ ] Unsynced, inspecting, healthy, and unreadable states each provide an appropriate next step.

---

## Phase 36: Movie row actions

**User stories**: 30, 60, 61, 92, 93, 97, 99

### What to build

Add queue, stereo, force, exempt, and clear-exemption actions directly to movie rows with truthful feedback.

### Acceptance criteria

- [ ] Each enabled action changes the same domain state as its API counterpart.
- [ ] Active, unreadable, provisional, and pending-review rows disable conflicting actions.
- [ ] No-op and failed actions display the server's concrete reason.

---

## Phase 37: Series and episode table

**User stories**: 26, 27, 28, 29, 31, 34, 35, 36, 47, 50, 164

### What to build

Render expandable series with sortable episode rows that match movie information and identify show, season, episode number, and episode title.

### Acceptance criteria

- [ ] Episode rows expose the same media facts, plan, health, and provenance as movies.
- [ ] Repeated episode titles remain unambiguous through show and season identity.
- [ ] Empty, inspecting, healthy, and unreadable states behave consistently with Movies.

---

## Phase 38: Episode row actions

**User stories**: 30, 31, 60, 61, 92, 93, 97, 99

### What to build

Provide every movie row action on individual episode rows with per-episode state and gates.

### Acceptance criteria

- [ ] Queue, stereo, force, exemption, and clear-exemption target only the selected episode.
- [ ] Episode actions use the same truthful no-op and failure responses as movie actions.
- [ ] A pending job or sidecar prevents duplicate episode work.

---

## Phase 39: Optimize-all-series action

**User stories**: 32, 33

### What to build

Queue all existing open episode work for a series and return accepted and skipped counts with reasons.

### Acceptance criteria

- [ ] Healthy, unreadable, dismissed, active, and pending-review episodes are skipped.
- [ ] Eligible open episode work is queued once per episode.
- [ ] The response and UI report queued and skipped totals without inventing new suggestions.

---

## Phase 40: Suggestions table and individual approval

**User stories**: 38, 39, 47, 62, 63, 64, 65, 66, 164

### What to build

Create the Suggestions view as the filtered work backlog with honest comparisons, episode identity, and individual plan or item approval.

### Acceptance criteria

- [ ] Only open recommended work appears.
- [ ] Now, After, reason, warnings, and estimated savings follow the suggestion truth rules.
- [ ] Approval returns immediately and updates visible queue state.

---

## Phase 41: Suggestion filters

**User stories**: 41, 42

### What to build

Filter suggestions by media type, resolution, HDR, codec, cap status, extra tracks, exemptions, and hardware warnings.

### Acceptance criteria

- [ ] Each filter works alone and in combination against server-defined fields.
- [ ] Counts and bulk selection operate on the filtered result set.
- [ ] Clearing filters restores the complete open-work list.

---

## Phase 42: Suggestion search and persistent query

**User stories**: 43, 44

### What to build

Add debounced, all-token suggestion search with episode notation parsing and URL persistence.

### Acceptance criteria

- [ ] Search matches all tokens across title, show, and episode identity.
- [ ] `S01E01` and `1x01` find the same episode.
- [ ] Search avoids a request per keystroke and survives refresh through `?q=`.

---

## Phase 43: Bulk suggestion approval

**User stories**: 39, 41

### What to build

Approve eligible work for one movie, one series, or the current filtered list as independent queue requests.

### Acceptance criteria

- [ ] Bulk approval queues every eligible selected title exactly once.
- [ ] Ineligible rows are skipped and reported without rolling back accepted rows.
- [ ] Series bulk identity cannot capture episodes from a same-named series in another instance.

---

## Phase 44: Global title search

**User stories**: 43, 45, 46

### What to build

Search movies, shows, and episodes from the application header and navigate to the actionable library row.

### Acceptance criteria

- [ ] Global search is available from every primary page.
- [ ] Results identify media type and Arr provenance where titles collide.
- [ ] Choosing a result opens and focuses the matching Movies or Series row.

---

## Phase 45: Persistent queue and immediate enqueue

**User stories**: 39, 107, 120, 137, 145, 188

### What to build

Persist approved work as jobs and return enqueue responses before any slow runner begins.

### Acceptance criteria

- [ ] Enqueue returns while a fake runner remains blocked.
- [ ] Queue status distinguishes waiting, running, completed, and failed work after restart.
- [ ] Duplicate active work or a pending sidecar for the title is rejected.

---

## Phase 46: Queue reorder, pause, and removal

**User stories**: 107, 108

### What to build

Allow waiting jobs to be reordered, paused, resumed, or removed without affecting running or finished work.

### Acceptance criteria

- [ ] Reordering changes the next eligible job deterministically.
- [ ] Paused work remains persisted and cannot start until resumed.
- [ ] Removal applies only to waiting work and returns a conflict for invalid states.

---

## Phase 47: Concurrency controls

**User stories**: 109, 110, 111, 125, 188

### What to build

Run one job by default, expose explicit higher concurrency, and add a conservative performance setting that does not silently alter job count.

### Acceptance criteria

- [ ] A fake runner proves default concurrency never exceeds one.
- [ ] Configured concurrency N permits at most N jobs and is honored exactly when work exists.
- [ ] Conservative mode changes only documented resource behavior, not configured concurrency.

---

## Phase 48: Off-peak scheduling and run-now

**User stories**: 112, 113, 114, 128, 188

### What to build

Hold jobs outside an optional local-time window and allow an explicit run-now override.

### Acceptance criteria

- [ ] Fake-clock tests cover entering, leaving, and crossing midnight in the configured timezone.
- [ ] A missed window remains held until the next window.
- [ ] Run-now makes one chosen job eligible without disabling the schedule globally.

---

## Phase 49: Queued and held cancellation

**User stories**: 130, 131, 133, 134, 135, 136, 188

### What to build

Cancel waiting and held work immediately while preserving the original and allowing later requeue.

### Acceptance criteria

- [ ] Cancelled waiting work never reaches the runner.
- [ ] Cancel is idempotently refused for already-cancelled or terminal jobs as specified.
- [ ] The title can receive a new job after cancellation.

---

## Phase 50: Running-job cancellation

**User stories**: 130, 132, 133, 134, 135, 136, 188

### What to build

Mark running work cancelled immediately, abort the runner when possible, clean partial output, and ignore late success.

### Acceptance criteria

- [ ] Cancellation response returns before a fake long-running process exits.
- [ ] Partial temp or sidecar files disappear and no Review item is created.
- [ ] A process that reports success after cancellation cannot change the cancelled terminal state.

---

## Phase 51: Restart-safe unfinished work

**User stories**: 11, 133, 134, 137, 144, 188

### What to build

Recover queued and interrupted jobs after process restart without treating partial output as success.

### Acceptance criteria

- [ ] Queued work remains queued across restart.
- [ ] Interrupted running work follows a documented requeue or failure policy and cleans its partial output.
- [ ] Recovery never changes or deletes the library original.

---

## Phase 52: Review-path validation and disk preflight

**User stories**: 115, 116, 117, 118, 119, 138, 139

### What to build

Validate that the configurable review path is writable and outside every known library root, then check free space before starting work.

### Acceptance criteria

- [ ] Equal, parent/child, normalized, and symlink-resolved unsafe path cases are rejected.
- [ ] Insufficient free space fails before media tools start and leaves the original untouched.
- [ ] Success and failure clean job-owned temporary files only.

---

## Phase 53: Tracks-only Matroska runner

**User stories**: 85–90, 101, 102, 106, 115, 116, 119, 139, 163, 190

### What to build

Execute a tracks-only plan with `mkvmerge`, preserving selected tracks, chapters, attachments, and the original library file while producing an MKV review sidecar.

### Acceptance criteria

- [ ] Fake `mkvmerge` receives operands as an argument array and applies the approved track plan.
- [ ] MP4 input produces an MKV sidecar beneath the review path.
- [ ] Tool failure cleans temporary output and preserves the original bytes.

---

## Phase 54: Stereo-only runner

**User stories**: 99, 100, 101, 102, 103, 115, 116, 119, 139, 163, 173, 190

### What to build

Create AAC 2.0 with ffmpeg and attach it with `mkvmerge` while retaining original surround, chapters, attachments, and all approved tracks.

### Acceptance criteria

- [ ] Fake ffmpeg creates only the stereo stream and fake `mkvmerge` creates the final sidecar.
- [ ] The final inspection contains stereo and the original surround track.
- [ ] Failure in either stage cleans job-owned files and leaves the original unchanged.

---

## Phase 55: CUDA HEVC runner

**User stories**: 2, 3, 73, 75, 78, 104, 115, 116, 119, 140, 141, 144, 174, 190

### What to build

Execute an approved HEVC plan through the detected CUDA encoder at the computed category target.

### Acceptance criteria

- [ ] The runner uses an argument-array process boundary and the approved target and bit depth.
- [ ] Missing or failing CUDA produces a failed job with no software fallback.
- [ ] Failure leaves the original intact and no successful Review item.

---

## Phase 56: VAAPI HEVC runner

**User stories**: 3, 73, 75, 78, 104, 115, 116, 119, 140, 141, 144, 174, 190

### What to build

Execute the same approved HEVC behavior through a passed VAAPI device without changing policy semantics.

### Acceptance criteria

- [ ] Selected VAAPI hardware produces a sidecar using the same target calculation as CUDA.
- [ ] Device or driver failure becomes a visible job failure with no CPU fallback.
- [ ] Backend-specific mechanics stay behind the runner's public contract.

---

## Phase 57: Hardware AV1 runner

**User stories**: 3, 76, 77, 78, 104, 140, 141, 142, 190

### What to build

Execute approved AV1 work only on a detected, selected hardware backend that advertises AV1 encode.

### Acceptance criteria

- [ ] Enqueue and execution both reject stale or absent AV1 capability.
- [ ] A supported fake backend receives an AV1 plan with preserved bit depth.
- [ ] Hardware failure cannot fall back to HEVC or software encode silently.

---

## Phase 58: HDR warning and preservation behavior

**User stories**: 78, 79, 80, 83, 140

### What to build

Carry HDR classification and warnings from policy through queue, execution, and review while preserving HDR10 when supported.

### Acceptance criteria

- [ ] Dolby Vision and HDR10+ remain eligible and show the metadata-loss warning before approval.
- [ ] Supported HDR10 behavior is represented in the executed plan and output inspection.
- [ ] Unsupported preservation fails or warns according to the approved plan rather than claiming success.

---

## Phase 59: Combined mux-then-transcode jobs

**User stories**: 85, 89, 90, 101, 104, 105, 106, 163, 190

### What to build

For work requiring cleanup and video encode, produce a `mkvmerge` working file first and pass that file to ffmpeg as one job.

### Acceptance criteria

- [ ] Observable fake-process events prove mux completes before transcode begins.
- [ ] The final output reflects both the approved track selection and video target.
- [ ] Failure at either stage cleans working files and preserves the original.

---

## Phase 60: Output integrity and duration validation

**User stories**: 127, 139, 144, 160, 162

### What to build

Probe completed output and require readable structure, plausible duration, and basic integrity before creating Review state.

### Acceptance criteria

- [ ] Missing, unreadable, empty, or materially truncated output fails the job.
- [ ] Output duration comes from its own probe and is never copied from the source.
- [ ] A valid output that misses its size target still reaches Review as flagged.

---

## Phase 61: Bounded per-job logs

**User stories**: 124, 140, 143

### What to build

Capture named probe, plan, ffmpeg, `mkvmerge`, and promote events per job with bounded storage and secret redaction.

### Acceptance criteria

- [ ] Large fake stdout and stderr streams cannot grow memory or persisted logs without bound.
- [ ] The job log identifies the failing phase and useful hardware error.
- [ ] Secrets and complete sensitive request bodies never appear.

---

## Phase 62: Persisted phases and real progress

**User stories**: 107, 121, 126, 127, 128, 129, 143, 188

### What to build

Publish durable plain-language phases and measured progress from copied bytes or ffmpeg time against inspected duration.

### Acceptance criteria

- [ ] Waiting and held jobs show no fake encode percentage.
- [ ] Copy/move and encode progress derive from actual byte and time observations.
- [ ] Refreshing or opening another client shows the same persisted phase and progress.

---

## Phase 63: Responsive status and non-overlapping polling

**User stories**: 120, 121, 122, 123, 188

### What to build

Keep navigation and authenticated status endpoints responsive during fake long work, and prevent duplicate in-flight browser polls.

### Acceptance criteria

- [ ] Enqueue, Queue, Review, Settings, Home, and Cancel respond while the runner is blocked.
- [ ] Status endpoints meet the PRD's p95 target on the designated test-host procedure.
- [ ] The browser starts no second poll for an endpoint while its prior request remains in flight.

---

## Phase 64: Pending-sidecar lock

**User stories**: 119, 145

### What to build

Prevent additional work for a title from successful job completion until its sidecar is kept, discarded, or otherwise resolved.

### Acceptance criteria

- [ ] Every queue entry point rejects a title with pending Review state.
- [ ] Discard or successful Keep releases the lock.
- [ ] Concurrent enqueue attempts cannot create competing outputs.

---

## Phase 65: Review comparison page

**User stories**: 47, 146, 160, 163, 164

### What to build

Compare source and sidecar size, codec, duration, tracks, and GB/hour for every successful job type, including flagged results.

### Acceptance criteria

- [ ] Tracks-only, stereo-only, HEVC, and AV1 outputs use one Review workflow.
- [ ] Larger or over-cap output is visibly flagged but still actionable.
- [ ] Episode cards show show, season, episode number, and episode title.

---

## Phase 66: Asynchronous Discard

**User stories**: 119, 152, 153, 163, 189

### What to build

Mark a Review item busy immediately, delete its sidecar asynchronously, retain the original, and publish success or failure.

### Acceptance criteria

- [ ] HTTP returns before a fake slow delete completes and the row shows busy.
- [ ] Successful Discard removes only the sidecar and Review item.
- [ ] Delete failure remains visible and never affects the library original.

---

## Phase 67: Asynchronous Keep and safe replacement

**User stories**: 119, 147, 153, 154, 155, 156, 189

### What to build

Accept Keep immediately and safely replace the original in the background, including cross-device behavior and extension changes.

### Acceptance criteria

- [ ] A fake slow move proves HTTP returns and Review reports keeping in progress.
- [ ] A second Keep is rejected while promotion is active.
- [ ] Permission or move failure leaves both original and sidecar intact with a visible error.

---

## Phase 68: Arr rename and media refresh after Keep

**User stories**: 106, 148, 151, 189

### What to build

After file replacement, request the originating Radarr or Sonarr to rescan, rename, and refresh media information.

### Acceptance criteria

- [ ] Movie and episode Keeps call the correct originating instance and media identity.
- [ ] An extension change to MKV is represented in the refreshed library path.
- [ ] Arr failure leaves the successfully promoted file in place and reports follow-up failure.

---

## Phase 69: Plex and Jellyfin notification after Keep

**User stories**: 149, 150, 172, 189

### What to build

Notify every enabled configured player after successful promotion and report failures independently.

### Acceptance criteria

- [ ] Successful Keep invokes all enabled fake Plex and Jellyfin clients.
- [ ] One player outage does not block another notifier or roll back the promoted file.
- [ ] Notification outcome appears in the job or activity result without exposing tokens.

---

## Phase 70: Bulk Keep

**User stories**: 157, 158, 159, 189

### What to build

Select completed Review items and start independent asynchronous Keeps with accepted and skipped totals.

### Acceptance criteria

- [ ] Pending selected items begin Keep while already-keeping or ineligible items are skipped.
- [ ] The response reports accepted and skipped counts immediately.
- [ ] Failure of one Keep does not undo or block another successful Keep.

---

## Phase 71: Flagged results and aggressive retry

**User stories**: 160, 161, 162

### What to build

Allow a valid over-cap or larger-than-source sidecar to remain flagged and create a more aggressive follow-up plan after resolution.

### Acceptance criteria

- [ ] Integrity-valid missed targets reach Review instead of being discarded automatically.
- [ ] Flag details show source size, output size, target, and why review is needed.
- [ ] Aggressive retry uses an explicit new target and respects pending-sidecar locking.

---

## Phase 72: Activity history

**User stories**: 143, 164, 170

### What to build

Record and browse finished, flagged, discarded, kept, failed, and cancelled activity with useful media identity.

### Acceptance criteria

- [ ] Each terminal workflow produces one clear activity outcome.
- [ ] Episode history uses show, season, episode number, and episode title.
- [ ] History links to bounded per-job diagnostics without leaking paths where not required.

---

## Phase 73: Trustworthy savings accounting

**User stories**: 147, 152, 155, 159, 167, 168

### What to build

Calculate files optimized and space saved only from successful Keep outcomes and actual source and sidecar sizes.

### Acceptance criteria

- [ ] Keeping 10 GB as 4 GB adds one optimized file and 6 GB saved.
- [ ] Discard, failed Keep, cancelled work, and unkept Review items add nothing.
- [ ] Independent bulk Keeps update totals only for their successful members.

---

## Phase 74: Home dashboard

**User stories**: 47, 165, 166, 167, 168, 169

### What to build

Make Home the post-login landing page with trusted totals, open workload counts, recent activity, and actionable empty-state guidance.

### Acceptance criteria

- [ ] Home shows optimized files, saved space, suggestions, queued work, Review, and Errors from authoritative state.
- [ ] Recent kept, flagged, failed, and discarded work is visible.
- [ ] A fresh install explains how to connect an Arr and wait for inspection.

---

## Phase 75: Arr-style application shell

**User stories**: 47, 175, 176, 177

### What to build

Create the final dark-glass shell, primary navigation, distinct icons, favicon, header mark, and page-specific empty states without copying template code.

### Acceptance criteria

- [ ] All nine primary views are reachable and clearly identified.
- [ ] Navigation, row actions, queue phases, Keep, Discard, and help use distinct readable iconography.
- [ ] Empty states explain the next action instead of rendering blank panels.

---

## Phase 76: Responsive mobile workflows

**User stories**: 153, 157, 175, 176, 177, 178

### What to build

Adapt navigation, tables, controls, Review actions, and bulk Keep for practical phone use on the LAN.

### Acceptance criteria

- [ ] Movies, Series, Queue, and Review remain readable without hiding required identity or state.
- [ ] Keep, Discard, Cancel, and selection controls have usable touch targets.
- [ ] The mobile header carries the Optimizarr mark and provides access to every primary view.

---

## Phase 77: Contextual help

**User stories**: 62, 175, 179, 180, 181

### What to build

Place concise, non-blocking help beside important controls on every primary page and define the workflow's unfamiliar terms.

### Acceptance criteria

- [ ] Help explains inspect, suggest, queue, review, and Keep where users encounter them.
- [ ] Sidecar, Keep, size cap, exemption, and tracks-only are defined in everyday words.
- [ ] Help never blocks or obscures the action it explains.

---

## Phase 78: Homepage widget API

**User stories**: 13, 165, 182, 183

### What to build

Expose identical stats-only payloads at `GET /api/widget` and `GET /api/homepage`, protected by widget key or local-address bypass.

### Acceptance criteria

- [ ] The payload includes running title, queued, Review, Suggestions, and Errors counts.
- [ ] A valid widget key works; a public request without it receives 401.
- [ ] Response fields contain no Arr keys, player tokens, passwords, session data, or file paths.

---

## Phase 79: Homepage configuration documentation

**User stories**: 180, 182, 183, 184

### What to build

Document widget authentication, payload meaning, endpoint aliases, and copyable Homepage YAML without modifying the household Homepage host.

### Acceptance criteria

- [ ] Example YAML points at the supported endpoint and uses a placeholder widget key.
- [ ] Documentation defines every displayed count in plain language.
- [ ] Documentation explicitly excludes editing the household `services.yaml` from this repository.

---

## Phase 80: Portable production container

**User stories**: 1, 2, 3, 11, 12, 13, 102, 104, 115, 116, 173, 174

### What to build

Package the production application with ffmpeg, `ffprobe`, and MKVtoolnix; document persistent volumes, NAS mounts, PUID/PGID, timezone, CUDA, VAAPI, and network configuration.

### Acceptance criteria

- [ ] The built image starts as one application process and persists state through container recreation.
- [ ] CUDA and VAAPI devices can be passed without producing different application images.
- [ ] The documented configuration mounts authoritative Arr paths and a separate review path without hard-coded host paths.

---

## Phase 81: Ubuntuserver acceptance pass

**User stories**: 2, 3, 12, 19, 49, 115–125, 138–150, 173, 174

### What to build

Run the documented first-target acceptance procedure on ubuntuserver with the shared Arr network, `/mnt/nas` paths, NVIDIA device, and non-library review path. Record results and fix only spec failures uncovered by the pass.

### Acceptance criteria

- [ ] Radarr and Sonarr sync titles quickly, then inspection continues in the background against their reported paths.
- [ ] A representative tracks-only, stereo, and CUDA HEVC job produces review sidecars while the UI and status endpoints remain responsive.
- [ ] Cancel preserves the original; Keep promotes safely, refreshes the originating Arr, notifies configured players, and updates trusted savings.
- [ ] The final review explicitly records a Spec-axis result and a Standards-axis result using the repository rule identifiers.
