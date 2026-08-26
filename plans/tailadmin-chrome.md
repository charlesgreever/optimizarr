# Plan: TailAdmin chrome on Polisharr

> Spec: `docs/prd.md` 165–181, 175–178 (Arr nav, phone Keep/Discard, help next to controls). Palette stays ice/navy. After approval, also save `plans/tailadmin-chrome.md`.

## Outcome

Polisharr uses the **same app chrome as [TailAdmin](https://demo.tailadmin.com/)**: full-height sidebar, sticky header with search, page body in a max-width well, content in rounded white cards. Routes, buttons, and copy stay Polisharr. No ecommerce charts, no TailAdmin npm package.

## What that demo is

TailAdmin’s layout (from their docs, not the sales widgets) is:

```
h-screen overflow-hidden flex
├─ Sidebar          w-72, static on lg, drawer on mobile
└─ flex-1 overflow-y-auto
   ├─ Header        sticky: hamburger, search, status
   └─ main          max-w-screen-2xl p-4 md:p-6
        cards / metric tiles / table
```

Desktop: sidebar always on. Phone: sidebar hidden; hamburger in the header slides it over a backdrop. Content scrolls; the header stays.

Home on the demo is metric cards + a “recent” table in a card. That maps to Polisharr Home (status, files optimized, space saved, work counts, recent activity) — not Customers/Orders/ApexCharts.

## Today

Polisharr already has a left nav and a header search, but the **frame is different**:

- CSS grid `235px + 1fr`, not `h-screen` + sticky header
- Under 900px the sidebar becomes icons; under 620px it becomes a **9-item bottom bar**
- Cards are 4px frames; TailAdmin uses large radius (`rounded-2xl`) white cards on a gray/ice field
- Tables sit on the page, not inside a card with a title row
- Report is a floating corner control

Keep: Arr destinations, Queue/Review badges, global search, inspect banner, on-page Help, ice `#E3F2FD` / navy `#0D47A1` / signal `#2196F3`.

## Decisions

1. **Match layout, do not vendor TailAdmin.** Recreate the chrome in `Shell.tsx` with Tailwind we already ship. Copying their React tree would pull ecommerce, ApexCharts, and a third-party license into an Arr app.
2. **Palette stays the Color Hunt set** applied as ice paper + navy ink. TailAdmin’s default gray-50 + brand-blue is the *shape*, not their hexes.
3. **Mobile is a TailAdmin drawer**, not the current bottom bar. Hamburger in the header; backdrop closes the menu. That is how the demo works and is easier on a phone than nine icons.
4. **No fake user menu or notification inbox.** Header right side is inspect/work status + Report (Bug / Change request). Those are the operator equivalents.
5. **PRD 175 “Vision glass”** is already superseded by the ice-navy pass. This plan continues that light admin look. Name it: TailAdmin structure, Polisharr colors.

## Approach

### 1. App shell (`Shell.tsx` + drop most of `.shell` in `index.css`)

Implement the TailAdmin wrapper:

- `flex h-screen overflow-hidden`
- Sidebar `w-72` (`290px`), `lg:static`, mobile `fixed` + `-translate-x-full` until open
- Backdrop when open on small screens
- Header `sticky top-0`: menu button (lg:hidden), existing search, status line, Report as header actions (not a FAB)
- Main scroller: `mx-auto max-w-screen-2xl p-4 md:p-6`

Nav list unchanged (Home … Settings) with TailAdmin item chrome: icon + label + pill count, active = ice fill + signal bar.

Brand: navy **P** + “Polisharr” at the top of the sidebar (demo logo slot).

Tests: Shell markup has a menu button that is hidden on large viewports (render + class assert). Search still has `aria-label`.

### 2. Cards and tables

A small `Card` helper (title + actions + body) used by Home, Review, Queue, Movies/Series/Suggestions/Errors/History.

- Home: two metric cards (files optimized, space saved) in a 2-col grid; four work-count cards; Status as a full-width card; Recent as a **card table** (title, outcome, saved) like TailAdmin “Recent Orders”
- Library/work tables: wrap in `Card`, keep dense columns and row actions
- Review contact sheet stays the signature inside each card

Existing Home tests that look for Status and `/queue` hrefs stay; update if the wrapper tag changes.

### 3. Login

Auth card centered on ice, white panel, signal primary button — same tokens, TailAdmin-like radius (`rounded-2xl`) so first-run matches the signed-in chrome.

### 4. Quality floor

- Focus rings on hamburger, nav, search
- Drawer: Escape and backdrop close; focus to menu button on close
- Phone: content padding-bottom not reserved for a bottom nav
- `prefers-reduced-motion` already exists; drawer translate can snap

### 5. Out of scope

- ApexCharts, maps, “Monthly Target”, customer demographics
- Dark-mode toggle (TailAdmin has one; we have one light palette)
- Nested sidebar groups
- Replacing Help copy or Arr routes
- Installing `@tailadmin/*` or copying their `AppSidebar.tsx`

## Done when

1. Desktop looks like TailAdmin’s frame: sidebar | sticky header | padded cards
2. Phone opens the sidebar from the header, not a 9-icon footer
3. Home still shows status, kept/saved, work counts, recent
4. Movies/Series/Queue/Review still work; Review still has Now | Sidecar
5. Ice/navy/signal tokens unchanged in meaning
6. Tests pass
