# Plan: Errors, ISO suggestions, disc languages, and Arr language search

> Spec: `docs/prd.md` (Errors, inspect) and `docs/v2 prd.md` (ISO inspect, suggestion defaults).

See the approved session plan for the full phase breakdown. Summary:

1. **Errors are real failures only.** Skip Arr rows with no media file. Prune folder-only rows on sync. Missing paths are not volume-mount errors. ISO listing failure stays off Errors.
2. **Convert ISO to MKV** is a Settings suggestion toggle, default off, same shape as Convert MP4 to MKV.
3. **Disc languages** come from the ffmpeg/libbluray playlist listing and are written onto the remuxed MKV. There is no ISO track database.
4. **Preferred-language search** is a confirmed title-page action (delete file through Radarr/Sonarr, then search). Optional Suggestions card, default off. Polisharr does not unlink library files.

Implementation order is 1 → 2 → 3 → 4.
