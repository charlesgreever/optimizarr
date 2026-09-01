# Plan: Dark-Mode Dropdowns, Kind-Scoped Profile Sync, and Encode Target Sweep

> Source: [#44](https://github.com/charlesgreever/polisharr/issues/44), [#45](https://github.com/charlesgreever/polisharr/issues/45), [#46](https://github.com/charlesgreever/polisharr/issues/46). v2 stories 74–77 and 81 for Arr quality profiles. v1 stories 74–77 and 91 for HEVC/AV1 targets.

Three independent bugs. Each phase can ship alone.

## Architectural Decisions

- **Theme:** Class-based dark mode on `html.dark`. Keep native `<select>` controls. Do not introduce a custom menu component.
- **Select contrast:** Closed and open lists use the same panel and text tokens as other form fields. Option rows must stay readable without hover.
- **Size categories:** Unchanged set: Movie 1080p, Movie 4K SDR, Movie 4K HDR, TV 1080p, TV 4K.
- **Sync routing:** Movie categories go only to Radarr. TV categories go only to Sonarr. Settings still previews all five caps; that preview is not an Arr write.
- **Keep auto-assign:** Already picks the matching profile name for the title. Do not change assign-on-Keep in this work.
- **Leftovers:** Do not delete Polisharr-named profiles that an earlier unscoped sync already created on the wrong Arr. The operator removes those in Radarr or Sonarr.
- **Encode Target sweep:** The stored suggestion-default key stays `transcodeBelowHevc`. The checkbox copy and the suggestion predicate follow Encode Target: HEVC flags pre-HEVC codecs; AV1 also flags HEVC. Already-AV1 files are never suggested back to HEVC or re-encoded. Library refresh and GPU detection recompute every inspected title, including files that were healthy under the previous rule.
- **AV1 size encodes:** CUDA size-mode uses explicit VBR so AV1 honors the same bitrate cap as HEVC. Do not pass HEVC `main10` to AV1.
- **Tests:** Fake Arr HTTP and encode argument arrays. No live Radarr, Sonarr, or GPU. Assert which profile names are POSTed or PUT, not private SQL.

---

## Phase 1: Dark-Mode Dropdown Contrast

**Issues:** #44

**User stories:** Settings form controls stay usable in dark mode (v1 Settings; v2 write-mode and encode target).

### What to Build

Open native dropdowns in dark mode use a dark panel background and light text for every option, not only the highlighted row. Light mode stays as it is. The same global select/option treatment covers Settings, Setup, Suggestions filters, and title custom-plan controls.

The closed select already uses light text on a dark-tinted field. The open list is the gap: the popup keeps a light background while option labels inherit light text.

### Acceptance Criteria

- [ ] In dark mode, every option in a Settings dropdown is readable without hovering or highlighting it.
- [ ] Light mode dropdowns stay readable.
- [x] Closed selects keep the existing field height and dark-panel look.
- [x] Suggestions filters and title-page selects pick up the same contrast.
- [x] Existing Settings and theme tests still pass.
- [ ] Recheck Settings, Suggestions, and a title page in the browser, dark and light.

---

## Phase 2: Kind-Scoped Quality Profile Sync

**Issues:** #45

**User stories:** v2 74 (preview all categories), 75 (explicit sync creates named profiles without touching other profiles), 81 (sync is the only Arr write for those names). Keep assign stories 76–77 stay as they are.

### What to Build

The Settings **Sync quality profiles** action still walks every enabled Radarr and Sonarr. For each instance it creates or repairs only the profiles that belong to that Arr:

- Radarr: Polisharr Movie 1080p, Polisharr Movie 4K SDR, Polisharr Movie 4K HDR
- Sonarr: Polisharr TV 1080p, Polisharr TV 4K

It still does not rename, delete, or rewrite the operator’s other profiles. It still does not start a search. Settings still lists all five suggested names and GB/hr (and MB/min) figures.

Keep of a transcode continues to assign the matching profile for that title. This phase only changes the bulk sync.

The current test that expects five created profiles on a Radarr-shaped fake must expect the three movie names. Add a Sonarr-shaped fake that expects the two TV names and no movie POSTs.

### Acceptance Criteria

- [x] Syncing to an enabled Radarr creates or updates only the three movie Polisharr profiles.
- [x] Syncing to an enabled Sonarr creates or updates only the two TV Polisharr profiles.
- [x] Fake HTTP shows no POST or PUT of a TV profile name to Radarr, and no movie profile name to Sonarr.
- [x] Operator profiles (TRaSH, Ultra-HD, and similar) stay untouched.
- [x] Settings preview still shows all five size categories and MB/min figures.
- [x] Keep auto-assign tests still pass without change.
- [x] `npm test` and `npm run typecheck` pass.

---

## Phase 3: Transcode Below Encode Target, and Align AV1 Size Encodes

**Issues:** #46

**User stories:** v1 74 (older codecs to HEVC), 75–77 (HEVC default, optional AV1), 91 (do not downgrade AV1). The existing below-HEVC checkbox (plan `h264-to-hevc-suggestion.md`) grows to follow Encode Target.

### What to Build

The Settings checkbox reads **Transcode video below Target Encode (HEVC)** or **Transcode video below Target Encode (AV1)** from the current Encode Target. The stored key does not change.

With the box on:

- Target HEVC: suggest a transcode for H.264, MPEG-2, VC-1, and similar, even under the size cap. Skip HEVC and AV1.
- Target AV1 (GPU lists an AV1 encoder): also suggest HEVC files for AV1. Skip already-AV1.
- Size-exempt titles still skip the transcode.

CUDA size-mode encode arguments set VBR rate control for both HEVC and AV1 so the bitrate cap is the same. 10-bit AV1 uses the 10-bit pixel format and does not pass HEVC `main10`.

### Acceptance Criteria

- [x] The Settings checkbox names the current Encode Target (HEVC or AV1).
- [x] With the box on and target HEVC, under-cap H.264 is suggested for HEVC; under-cap HEVC is not.
- [x] With the box on and target AV1, under-cap HEVC is suggested for AV1; already-AV1 is not.
- [x] Size-exempt titles still skip this transcode.
- [x] Library refresh and GPU detection recompute already-inspected titles, so under-cap HEVC can become an AV1 suggestion without a new probe.
- [x] CUDA size-mode AV1 arguments include VBR and the same `-b:v` as HEVC for the same target bytes.
- [x] 10-bit AV1 arguments do not include `main10`.
- [x] `npm test` and `npm run typecheck` pass.

---

## Out of Scope

- Custom dropdown widgets.
- Deleting leftover wrong-kind Polisharr profiles from earlier syncs.
- Changing global Arr quality size limits (MB/min).
- Recyclarr / TRaSH guide runs.
- Per-episode Sonarr quality profiles (Sonarr cannot).
- Renaming the stored `transcodeBelowHevc` JSON key.
- Software AV1 or HEVC encode.
