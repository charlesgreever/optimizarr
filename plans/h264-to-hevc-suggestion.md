# Plan: Suggest codecs below HEVC for HEVC (or AV1)

> Spec: `docs/prd.md` 72–77, 90–94, 54 (v2 Settings toggles).

## Outcome

A Settings checkbox **Transcode video below HEVC** puts H.264, MPEG-2, VC-1, and other pre-HEVC files on Suggestions even when they already meet the GB-per-hour cap. The encode target is **HEVC**, or **AV1** when Encode Target is AV1 and the GPU lists an AV1 encoder. Queue still writes a sidecar. Keep still replaces the library file.

## Today

Automatic transcode only runs when **Transcode files over their size cap** is on **and** the file is over the cap. Under-cap H.264/MPEG-2 is Healthy unless tracks or stereo need work. Force re-encodes one title. Encode already has a Target control (HEVC, plus AV1 when hardware lists it).

## Decisions

1. **New suggestion default, off.** `transcodeBelowHevc: false`. Label: **Transcode video below HEVC**.
2. **Below HEVC means not HEVC/H.265 and not AV1.** H.264/AVC, MPEG-2, VC-1, MPEG-4, VP8, VP9, and similar ffprobe names. Already-HEVC and already-AV1 are not nagged by this toggle.
3. **AV1 is the existing Encode Target.** No second checkbox. If Target is AV1 and `av1Available`, suggestions use AV1; otherwise HEVC. The title page already hides AV1 the same way.
4. **Exempt still skips transcode.**
5. **One transcode action.** Over-cap older video with both toggles on is one job with both reasons.
6. **Do not grow the file.** Codec-only encodes aim at min(current size, cap size).
7. **No auto-Keep.**

## Approach

Settings checkbox after size-cap. `buildSuggestion` ORs `transcodeBelowHevc && !codecIsAtLeastHevc`. Reasons name the source codec in everyday words. `planFromSuggestion` clamps `targetBytes` to current size. Saving Settings already recomputes suggestions.

## Out of scope

Re-encoding HEVC that is already under the cap. Software encode. Auto-Keep. Changing Force or size-exempt.
