# Plan: TailAdmin palette, dark mode, and look on Polisharr

> Brief pins [TailAdmin free](https://demo.tailadmin.com/) and the downloaded zip. frontend-design: **follow that direction exactly**. Spec: Arr nav, Keep/Review, phone (prd 165–181).

This agent cannot see `C:\Users\cgree\Downloads\tailadmin-free-tailwind-dashboard-template-main`. The official free template on GitHub is the same pack; tokens are from that `src/css/style.css`.

## Why it still does not look like TailAdmin

The last pass copied the **box diagram** (sidebar | sticky header | cards) and kept **our** ice/navy Color Hunt colors, Newsreader, and custom `.btn` recipes. TailAdmin’s identity is a different system. Layout without tokens still reads as Polisharr-on-ice.

Color Hunt ice/navy is **retired** by this plan.

## Outcome

Polisharr **looks like TailAdmin**: gray paper, indigo brand, Outfit, light and dark, same header/sidebar/card/button recipes. Polisharr **stays Polisharr**: Home/Movies/Series/Queue/Review, Keep/Discard, search, inspect banner. No ApexCharts, no fake user avatar, no notification inbox of strangers.

## Identity (frontend-design)

The brief chose TailAdmin. Do not invent a third palette. Spend the one signature on Review; keep everything else quiet TailAdmin.

- **Light:** page `#f9fafb`, cards `#ffffff`, ink `#1d2939`, muted `#667085`, line `#e4e7ec`, brand `#465fff`
- **Dark:** page `#101828`, cards `#1a2231`, text `white/90`, muted `#98a2b3`, line `#1d2939`, brand `#7592ff`
- **Type:** Outfit for UI and titles. Keep **IBM Plex Mono** only for sizes, GB/hr, clocks
- **Signature:** Review Now | Sidecar strip, restyled as a TailAdmin card (two cells, sidecar cell brand wash)
- **Toggle:** sun/moon in the header, same 11×11 rounded-full border slot as TailAdmin

## Approach

1. Port TailAdmin `@theme` into `src/web/index.css` (brand, gray, success, error, warning, shadows). `@custom-variant dark (&:is(.dark *))`. Alias `--color-ink` / `--color-canvas` / `--color-accent`.
2. Dark mode: `html.dark`, `localStorage.theme`, FOUC script, header sun/moon.
3. Restyle Shell, Card, buttons, tables, inputs to TailAdmin recipes.
4. Review contact sheet is the one Polisharr-specific card treatment.

## Out of scope

Copying TailAdmin HTML/React/Alpine, ApexCharts, user avatar dropdown, notification feed, replacing Arr routes or Help copy, re-introducing Color Hunt ice/navy.
