# Polisharr v2 Verification

Verification date: 2026-08-21. This matrix closes the evidence gate in GitHub issue #26 and uses the revised progressive-Series behavior in the v2 PRD.

## Evidence Map

- **List HTTP:** `src/server/app.test.ts` bounds Movies, Suggestions, Queue, Review, Errors, History, and Series pages; returns summary-first Series data; fetches one show's episodes; preserves global movie sorting; and verifies dense public labels and reasons.
- **List UI:** `src/web/library-row.test.ts`, `src/web/library-pages.test.ts`, `use-paged-list.ts`, the primary list pages, and `LibraryMediaCells.tsx` cover shared row semantics, page merging, one-request guards, retained polled pages, retained expansions, refresh invalidation, retry, and legacy-focus paging. The production build verifies the routed React surface.
- **Plan:** `src/server/custom-plan.test.ts` and the custom-plan HTTP tests in `src/server/app.test.ts` cover validation, estimates, write mode, and queue locks. Suggestion negation after a custom queue is still a remaining gap (stories 45 and 61).
- **Runner:** `src/server/optimize.test.ts` covers safe operands, ISO remux, size and quality modes, downscale, AAC replacement/downmix, output duration, and progress.
- **Inspect/Suggest:** `src/server/inspect.test.ts`, `inspection-runner.test.ts`, `suggest.test.ts`, and the ISO HTTP tests in `app.test.ts` cover ISO/non-ISO inspection, automatic-operation settings, and post-promote inspection.
- **Promote/Profile:** `src/server/promote.test.ts`, `jobs.test.ts`, `arr-profiles.test.ts`, `types.test.ts`, and `store.test.ts` cover sidecar/direct promotion, follow-up warnings, eligibility, explicit profile sync, settings migration, and fake Radarr/Sonarr traffic.
- **Title/UI:** `src/server/titles.test.ts`, title HTTP tests in `app.test.ts`, the routed page implementation, responsive CSS, and the production build cover stable routes, search destinations, missing/unready states, help, navigation, and responsive layout.

## Story-to-Evidence Matrix

| Story | Passing evidence |
| ---: | --- |
| 1 | Library HTTP + Library UI: Movies exposes and renders every dense media field and plan line. |
| 2 | Library HTTP + Library UI: expanded Series uses the same shared cells. |
| 3 | `library-row.test.ts` verifies every reason; shared cells render each on its own line. |
| 4 | `library-row.test.ts` verifies inspected/no-plan renders `Healthy`. |
| 5 | `library-row.test.ts` verifies waiting rows use stream dashes and waiting copy. |
| 6 | Library HTTP + `library-row.test.ts` verify unreadable error copy without invented streams. |
| 7 | `library-row.test.ts` verifies inspected/no-subtitles renders `None`. |
| 8 | Shared dense cells, compact poster classes, responsive CSS, and production build. |
| 9 | Movies and Series render the Arr instance under the title/header. |
| 10 | Library HTTP verifies codec, audio, subtitle, state, and the full reasons array. |
| 11 | Series header toggle owns an independently expandable episode table. |
| 12 | Summary HTTP and Series header retain title, instance, count, and Optimize all. |
| 13 | Optimize all is a separate button from the expansion toggle. |
| 14 | Summary-first HTTP plus expansion-only episode requests implement the revised progressive default. |
| 15 | Series refresh preserves each mounted header's open state while invalidating and reloading its retained rows. |
| 16 | Shared row actions retain Queue, Force, Stereo, and Exempt. |
| 17 | Title/UI verifies stable movie title routes. |
| 18 | Title/UI verifies stable episode title routes. |
| 19 | `titles.test.ts` and title HTTP search results point to title routes. |
| 20 | Plan's empty draft/do-nothing tests and title-page initial state. |
| 21 | Title detail HTTP returns the inspection report; routed title UI renders the requested facts. |
| 22 | Plan verifies removal of an individual audio track. |
| 23 | Plan verifies removal of an individual subtitle track. |
| 24 | Plan verifies same-layout AAC replacement. |
| 25 | Plan verifies replacement removes the source rather than adding a duplicate. |
| 26 | Plan verifies 7.1-to-5.1/stereo downmix choices. |
| 27 | Plan verifies downmix add and replace modes. |
| 28 | Plan rejects missing source streams; Runner maps generated audio from the selected input stream. |
| 29 | Inspect and Plan verify listed ISO tracks use the normal editing model. |
| 30 | Plan verifies unlisted ISO hides track edits but permits remux. |
| 31 | Plan + Runner verify ISO video-copy remux to Matroska. |
| 32 | Plan and title HTTP reject a do-nothing MKV plan. |
| 33 | Plan verifies optional 4K-to-1080p. |
| 34 | Plan rejects downscale without a transcode. |
| 35 | Plan + Runner verify source bit depth is retained in the encode plan. |
| 36 | Plan verifies size/quality XOR. |
| 37 | Routed title editor clears the alternate encode aim; Plan enforces the invariant at the boundary. |
| 38 | Plan reasons and persisted job details identify size vs quality mode. |
| 39 | Plan verifies the quick output estimate. |
| 40 | Plan verifies size mode uses the typed file size. |
| 41 | Plan verifies quality estimates vary monotonically with quality inputs. |
| 42 | Plan + hardware tests verify HEVC default and AV1 capability gating. |
| 43 | Plan verifies HDR metadata warning retention. |
| 44 | Empty-plan validation and routed title button state prevent blank Queue work. |
| 45 | Custom-queue HTTP and job tests dismiss the automatic suggestion. See [review-follow-up.md](../plans/review-follow-up.md) phase 2. |
| 46 | App HTTP verifies a second active job/Keep is rejected. |
| 47 | Title HTTP state and routed title controls surface unreadable/uninspected reasons. |
| 48 | Plan accepts intentional custom work independently of bulk size exemption. |
| 49 | Title lookup is independent of Suggestions exclusion filtering. |
| 50 | Routed title help defines the custom-work and write-mode terms. |
| 51 | Responsive title CSS and production build verify the phone layout implementation. |
| 52 | Routed title navigation retains a Back destination for Movies or Series. |
| 53 | Suggestion tests retain the automatic work-list path. |
| 54 | Suggest tests and Settings HTTP verify all four independent automatic-operation toggles. |
| 55 | Inspect unit and HTTP tests verify `.iso` never invokes ffprobe. |
| 56 | Inspect parses the recorded ffmpeg listing into the shared inspection shape. |
| 57 | Suggest verifies listed ISO reports receive bulk rules. |
| 58 | Inspect + Plan verify listing failure is distinct and still custom-queueable. |
| 59 | Inspect verifies ordinary containers retain ffprobe behavior. |
| 60 | Runner/Promote and ISO Keep HTTP verify the finished normal video receives an integrity probe. |
| 61 | Custom queue dismisses the open suggestion immediately. See [review-follow-up.md](../plans/review-follow-up.md) phase 2. |
| 62 | Plan and Store verify custom jobs default to sidecar. |
| 63 | Store migration and Settings HTTP verify the global direct-write switch. |
| 64 | Plan verifies a per-title write-mode override. |
| 65 | Plan reasons, job persistence, and routed title UI expose the effective write mode. |
| 66 | Jobs/Promote verify direct write probes, replaces, and skips Review. |
| 67 | Failed direct write leaves the original and deletes the review-path sidecar. Cancel before replace does not promote. See [review-follow-up.md](../plans/review-follow-up.md) phase 1. |
| 68 | Promote + inspection-runner verify Keep refreshes integrations and reinspects before completion. |
| 69 | Jobs verifies direct write uses the same post-promote reinspection path. |
| 70 | Jobs/Promote verify follow-up failures remain visible without rolling back the replacement. |
| 71 | Shared JobService HTTP behavior retains cancel, scheduling, concurrency, and run-now for custom jobs. |
| 72 | Promote verifies successful replacement updates saved-file counters. |
| 73 | Review/Promote leaves flagged sidecars Keepable; replacement is not gated by estimate variance. |
| 74 | Arr profile tests verify category previews with GB/hour and MB/min values. |
| 75 | Fake Arr sync tests create/repair only Polisharr-named profiles. |
| 76 | Profile eligibility + fake Radarr tests verify enabled movie assignment with no search. |
| 77 | Fake Sonarr tests verify whole-series assignment and warning copy. |
| 78 | Profile eligibility tests reject copy, tracks-only, stereo-only, and audio-only work. |
| 79 | Profile eligibility tests reject size-exempt titles. |
| 80 | Jobs verifies profile HTTP failure preserves replacement success and appends a visible warning. |
| 81 | Arr profile tests verify preview is local and only explicit sync issues repair PUTs. |
| 82 | Store migration, Settings API/UI, and profile tests verify auto-assign opt-out without disabling preview/sync. |
| 83 | Hardware + Plan tests retain CUDA/VAAPI-only video capability gating. |
| 84 | Plan + Runner verify AAC-only work does not require a video encoder. |
| 85 | Movies and Series retain the v1 empty-state copy and Refresh action. |
| 86 | Title HTTP and routed missing-title state show a not-in-library message. |
| 87 | `custom-plan.test.ts` exercises fixture reports plus drafts without a browser. |
| 88 | `inspect.test.ts` and ISO HTTP tests cover listing success/failure and the no-ffprobe invariant. |
| 89 | `optimize.test.ts` uses fake processes for replace, downmix, remux, size, quality, and downscale. |
| 90 | `promote.test.ts`, `jobs.test.ts`, and profile eligibility tests cover both write modes, failure preservation, and skips. |
| 91 | `arr-profiles.test.ts` verifies fake Radarr and Sonarr GET/POST/PUT behavior. |
| 92 | Library HTTP verifies codec/tracks/two reasons; `library-row.test.ts` verifies their presentation. |

## Large-Library Evidence

The authenticated HTTP regression test seeds multiple pages and asserts bounded cardinality, continuation metadata, summary-only Series responses, one-show episode expansion, and a server maximum page size. A local server read benchmark used the same in-memory fixture for the former all-episode presentation path and the progressive read model:

| Fixture/result | Rows | JSON bytes | Read/presentation time |
| --- | ---: | ---: | ---: |
| Fixture | 100 shows / 5,000 episodes / 1,200 inspections / 700 suggestions / 100 errors | N/A | N/A |
| Former all-episode response shape | 5,000 | 3,787,645 | 145.23 ms |
| Progressive first Series summary page | 50 | 7,023 | 2.25 ms |
| Progressive one-show episode page | 50 | 37,496 | 1.85 ms |

Times are a single local run and are diagnostic, not a timing assertion. Cardinality and continuation fields are the durable regression gate. The first Series response contains no episode paths or episode rows.

## Remaining gaps (2026-08-29)

The 2026-08-21 gate closed issue #26 against the code at that date. The 2026-08-29 follow-up in [review-follow-up.md](../plans/review-follow-up.md) is implemented in the working tree: stories 45, 61, 54j, and 67, v1 story 4 (`/setup`), and GitHub issues #42 and #43. Re-run `gh issue list --state open` before closing #42 and #43.

## Integrated Gate

- `npm test`: 20 files, 115 tests passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- Standards/spec review: passed against the repository's engineering rules and the v2 PRD as of 2026-08-21. The review corrected Queue removal retaining Review promotion data, global Movies sorting across pages, legacy Series focus paging, and Series refresh collapse retention. The 2026-08-29 review listed remaining stories in the section above.
