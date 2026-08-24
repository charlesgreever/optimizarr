# Plan: Home, Settings, and title audio controls

> Visual cleanup only. Product behavior stays (Home Status, Settings saves, title audio actions). Source: Tailwind v4 utilities on the existing dark-glass theme (`ink`, `accent`, `muted`, `glass`).

The live title URL `http://192.168.1.10:7373/movies/57dd87f5-b705-43b2-9757-e59f341d17fb:movie:123` is an SPA route. The shell loads; audio rows are React. The mis-sized control is in `Title.tsx`: a native `<select>` with no min-width, options from "Keep" to "Replace with downmix", plus an extra channel select that appears for downmix. Global `select { padding: 10px 11px }` with `flex-wrap` + `justify-between` makes the row jump when the selected label or second dropdown changes.

## Architectural decisions

- **Theme:** Keep Arr-style dark glass. Use Tailwind utilities on Home, Settings, and title audio; do not restyle the shell, Movies table, or Review in this pass.
- **Forms:** One stacked field pattern: label above, control `w-full` (or a fixed width for numbers). No inline label + `ml-2` select.
- **Selects:** Shared height (`h-10`) and a min-width that fits the longest visible option so native selects do not shrink to "Keep".
- **Copy:** Size-cap keys on Settings become everyday labels (Movie 1080p, not `movie1080p`).
- **Scope:** No API or settings-schema changes.

---

## Phase 1: Title audio dropdowns

**User stories:** v2 title page audio controls (keep, remove, replace, downmix)

### What to build

Audio rows stay on one line at desktop: pills on the left (`min-w-0`), actions on the right (`shrink-0`). The action select uses a min-width that fits "Replace with downmix". The channel select (5.1 / stereo) is a fixed narrower width and does not shove the action select. Both selects share `h-10`. No wrap that drops the control under the pills except on a phone (`flex-col` below `sm`).

### Acceptance criteria

- [x] Action select width does not change when switching Keep → Replace with downmix → Keep
- [x] Channel select does not change the action select width
- [x] Desktop audio row does not wrap pills above the dropdown
- [x] Phone stacks facts then actions
- [ ] Recheck `/movies/57dd87f5-b705-43b2-9757-e59f341d17fb:movie:123` in the browser, desktop and a ~390px viewport

---

## Phase 2: Home dashboard

**User stories:** v1 #165, #166, #169 (Status, tallies, recent, empty state)

### What to build

Stop forcing seven tiles into a four-column grid.

- **Status** is a full-width glass strip under the heading (running title, waiting count, or Idle), not a cramped 28px metric.
- **Files optimized** and **Space saved** are two larger tiles.
- **Suggestions, Queue, Review, Errors** are four equal linked tiles (2×2 on a phone, 4-across on desktop) with hover `accent`.
- **Recent activity** rows use the same glass card as library tables: title, outcome pill, optional space saved.
- Empty copy stays; it does not sit inside a giant empty box when recent rows exist.

### Acceptance criteria

- [x] Status is readable as a sentence, not truncated in a small tile
- [x] Seven numbers are not squeezed into a 4+3 leftover grid
- [x] Linked tiles still go to Suggestions, Queue, Review, Errors
- [x] Phone: two columns for work tiles; Status full width

---

## Phase 3: Settings forms

**User stories:** v1 #9, #18, #68–71, #182; v2 write mode and suggestion defaults

### What to build

Each Settings card uses stacked labels and full-width controls. Size caps sit in a two-column grid with human names (Movie 1080p, Movie 4K SDR, Movie 4K HDR, TV 1080p, TV 4K). Connection rows: identity on the first line, Pause / Test / Remove on a second line so buttons do not wrap into the URL. Encode off-peak times are two labeled fields, not unlabeled inline inputs. Webhook token and widget key stay shown-once; add a Copy control next to the value. Keep per-section Save actions (language, encode, suggestion defaults, account).

### Acceptance criteria

- [x] Labels sit above inputs; selects share `h-10` with text fields
- [x] Size cap labels are everyday words
- [x] Connection actions stay usable on a phone
- [x] Copy on a shown-once token or widget key
- [x] No change to what each Save or Pause actually does

---

## Phase 4: Verify

- [ ] Desktop and ~390px: Home, Settings, the movie title URL above
- [x] Existing EncodeSettings / Review copy tests still pass
- [x] `npm test` and `npm run typecheck`
