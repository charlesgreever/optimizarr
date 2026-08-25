# Plan: Keep loaded Series episode pages after a row action

> Spec: `docs/prd.md` stories 26, 26b, 30, 31.

## Outcome

I expand a long show, click **Load more episodes** twice (three pages, ~150 rows), queue one episode, and I still see those three pages. **Load more episodes** is still there if the show has more. Scroll can stay put. The queued row’s Plan/Actions update.

## Today

`SeriesGroup.loadEpisodes(true)` always fetches offset `0` with the default page size **50** and **replaces** `episodes`. Row actions call that reset via `LibraryMediaCells onDone`. That matches the report: scroll Y is unchanged, but pages 2 and 3 vanish.

## Decisions

- Row action and Optimize all refresh the already-loaded window; they do not reset to page 1.
- Do not raise the HTTP limit cap (stays 100). Reload in existing 50-row pages.
- Library Refresh still resets. First expand, Retry, and `?focus=` still reset.
- Same helper on Movies (twin `onDone={() => load(true)}` after Load more movies).

## Approach

1. `loadRetainedPages` in `src/web/library-pages.ts` with tests in `src/web/library-pages.test.ts`.
2. Series `refreshLoaded` vs `reset`; wire row `onDone` and Optimize all to retain.
3. Movies `refreshLoaded` for row `onDone`; sort and Refresh still reset.
4. PRD **26b**.
