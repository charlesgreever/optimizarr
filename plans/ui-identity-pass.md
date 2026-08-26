# Plan: Polisharr visual identity and UI quality pass

> Skill: `frontend-design` (distinctive identity, type, restraint, quality floor). Spec: `docs/prd.md` 165–181, 175–178. Copy: `CODING_STANDARDS.md`. After approval, also save `plans/ui-identity-pass.md`.

## Outcome

Same app, same routes, same buttons. A visual identity that reads as a **film-restoration bench** next to Radarr and Sonarr, not a generic dark mint dashboard. Keyboard, contrast, and phone layout meet the skill’s quality floor. Copy stays everyday words.

## Today

The PRD asked for Arr information architecture and a Vision-inspired dark glass look. What shipped is Inter, navy-black `#070a12`, mint `#72efd9`, glass panels, and large Home numbers. That is the frontend-design skill’s **default #2** (near-black + acid accent). You asked to treat this as a distinctive redesign, not a polish of that default.

Known quality gaps (not a full audit yet):

- Sidebar collapses to icons at 900px and a 9-item bottom bar at 620px; Queue/Review counts and labels hide; tap targets on the bar are likely under 48px
- Global search `outline: 0` with no visible `:focus-visible` on the field
- No `prefers-reduced-motion`
- Review compare is two text lines, not a scannable Now vs sidecar
- Keep-all “dialog” is an inline panel (`aria-modal` without focus trap)
- Icon-only row actions are 32px (`h-8 w-8`)
- Report sits over the mobile nav

Workflows, Arr IA (Home → Settings), and help copy stay.

## Subject (frontend-design)

- **Subject:** a household library being restored: inspect, queue, Keep the new file
- **Audience:** one operator on the LAN, sometimes a phone on the couch
- **Job of the UI:** show what needs work and make Keep/Discard unmistakable
- **Materials:** film leader, contact sheets, tungsten work light, densitometer numbers — not neon GPU chrome

## Identity

Spend boldness in **one** place: Review’s Now vs sidecar strip. Everything else is quieter.

### Color (named hex)

| Token | Hex | Role |
| --- | --- | --- |
| Bench | `#161310` | canvas (warm charcoal, not navy) |
| Paper | `#f2ebe2` | primary text |
| Tungsten | `#d4a45a` | accent / focus / in-progress (work light) |
| Oxide | `#6fad7c` | good / Keep / healthy |
| Emulsion | `#d36b5c` | bad / Discard / errors |
| Frame | `#ffffff14` | rules, not glowing mint inset |

Warn stays a separate amber only if Oxide/Tungsten would collide on flagged Review cards.

**Not used:** mint cyan, Inter-on-navy, cream+terracotta, broadsheet hairlines.

### Type

- **Display (page titles only):** [Newsreader](https://fonts.google.com/specimen/Newsreader) — restoration/print, used with restraint
- **Body / UI:** [IBM Plex Sans](https://fonts.google.com/specimen/IBM+Plex+Sans) — Arr-adjacent, not Inter
- **Data:** [IBM Plex Mono](https://fonts.google.com/specimen/IBM+Plex+Mono) — sizes, GB/hr, clocks, counts

Scale: one display size for `h1`, one section `h2`, body 15–16px, captions 12–13px. Tabular nums on every size/count.

### Layout

Keep the Arr shell (sidebar + header search + page). Replace “glass gradient cards everywhere” with **framed panels**: 1px Frame, almost-flat fill, little blur. Home Status is a single live line (running title / waiting / Idle), not a hero metric tile. Files optimized and space saved stay (PRD 165) but as densitometer readouts in Plex Mono, not oversized gradient numbers.

ASCII:

```
[ P  Polisharr ]                 [ search .............. ]  Working · Title
  Home
  Movies
  ...
                 Status  Working · Cars 3
                 128 kept     1.42 TB saved
                 Suggestions  Queue  Review  Errors
                 Recent …
```

### Signature

**Review contact sheet:** each waiting sidecar is a two-frame strip — **Now | Sidecar** — codec, size, duration, GB/hr, tracks as labeled cells, Keep/Discard on the Sidecar frame. That is the one memorable object. Queue progress can reuse a thin tungsten fill; no extra animation language.

### Critique vs defaults

| Default the skill forbids as unchosen | This plan |
| --- | --- |
| Navy + mint + Inter | Warm bench + tungsten + Newsreader/Plex |
| Big number + small label as the whole hero | Status line first; numbers are instruments |
| Scattered hover sparkle | Motion only on real progress; `prefers-reduced-motion` |

If Login + Shell still feel like “dark SaaS,” revise tokens before painting every page.

## Approach

### 1. Tokens and shell (tracer)

`src/web/index.css` `@theme` + `:root`. Swap Google fonts in `index.html`. Restyle Login, Shell, buttons, inputs, nav active (tungsten rule, not mint inset). Update favicon/`P` mark to Paper-on-Tungsten (PRD 177).

Stop and look: Login + Home chrome in the browser at desktop and 390px. If the identity is wrong, change tokens here, not after tables.

### 2. Signature: Review

Rebuild the Review card as the contact sheet. Keep all copy and actions (Keep, Discard, Encode smaller, Keep selected, Keep all). Fix Keep-all: real modal (focus in, Escape already exists, restore focus). Tests that assert copy (`keepAllConfirmCopy`) stay; add markup tests only for the Now/Sidecar labels.

### 3. Home, Queue, library tables, Title, Settings, Errors

Same components, new tokens. Dense tables stay tables (PRD 27). Help blocks stay next to controls (PRD 179–181). Title Identify language layout unchanged in behavior.

### 4. Quality floor (frontend-design + a11y-debugging)

On the live UI (`http://192.168.1.10:7373`) with Chrome DevTools:

- Visible `:focus-visible` on search, nav, buttons, inputs (search currently `outline: 0`)
- Contrast Paper/Bench and Tungsten/Bench (web.dev contrast)
- Tap targets ≥ 48px on the phone nav and row actions (or a 44px floor with spacing if 48 fights the dense table — name the break)
- Keyboard: Tab through Shell → page; Keep-all trap
- `prefers-reduced-motion`: no decorative transition; progress width can stay
- Reduced-motion and focus checked at 1280 and 390 widths (PRD 178)

### 5. Copy

No marketing rewrite. CODING_STANDARDS: active verbs, sentence case, empty states that say the next action. Only change strings that the new chrome would make unclear.

## Out of scope

- Changing Keep/Queue/inspect behavior
- Collapsing Arr nav or inventing new pages
- Light mode
- Rewriting help into a wiki
- Homepage widget chrome (separate surface)

## Done when

1. Login and Shell are obviously not mint-on-navy
2. Review compare is a two-frame strip a couch operator can scan
3. Phone can Keep/Discard without fighting the Report control
4. Focus rings and contrast pass a DevTools pass on Home, Review, Movies, Title, Settings
5. Tests still pass; no new `any`
