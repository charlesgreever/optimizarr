# Plan: Rename Optimizarr to Polisharr on GitHub and the live box

> Spec: product is already Polisharr (`package.json`, UI, `compose.example.yaml` service). Remaining uses are the GitHub slug, clone/bug-report URLs, household bind paths, and the Compose project prefix. After approval, also save `plans/rename-to-polisharr.md`.

## Outcome

GitHub is `charlesgreever/polisharr`. Report-a-bug and README clone that URL. On ubuntuserver the stack and config dirs say `polisharr`, and **`docker ps` shows `polisharr`**, not `polisharr-polisharr-1`. The database is moved, not wiped.

## Today

| Place | Still says Optimizarr |
| --- | --- |
| GitHub | `https://github.com/charlesgreever/optimizarr` (`origin`) |
| README clone | `git clone …/optimizarr.git polisharr` |
| Report a bug | `src/web/reportIssue.ts` → `/optimizarr/issues/new` |
| Issue table | `plans/open-issues.md` links |
| Household compose | `/home/cgreever/appdata/arr/optimizarr/config` in `compose.yaml`, `compose.nvidia.yaml`, `compose.intel.yaml` |
| Live stack | `/home/cgreever/stacks/optimizarr` → container `optimizarr-polisharr-1` (Compose `{project}-{service}-1`) |
| Agent checkout | `/home/cgree/optimizarr` |

Already Polisharr: package name, UI title, example compose service, `polisharr.db`, `POLISHARR_*` env, `PGS_OCR` / `WHISPER_LID`.

**Keep as compatibility (do not delete):**

- `optimizarr.db` → `polisharr.db` one-time rename (`src/server/env.ts`)
- `OPTIMIZARR_WIDGET_KEY` / `OPTIMIZARR_TRUST_PROXY` aliases
- Arr quality profiles still named `Optimizarr Movie 1080p` (`legacyProfileName`)

Those are old installs, not leftover branding. Historical `plans/optimizarr-rewrite.md` and the PRD line about retired `plans/optimizarr.md` stay; they name a past file.

## Decisions

1. **GitHub slug is `polisharr`.** `gh repo rename polisharr`. GitHub redirects `…/optimizarr` (issues, clones, stars).
2. **Live container name is `polisharr`.** Set `container_name: polisharr` so Compose does not emit `polisharr-polisharr-1` after the stack directory is renamed.
3. **Move household dirs; do not wipe.** `mv` stack and appdata. Bind the same files at the new path. No `docker volume prune`, no delete of `polisharr.db`.
4. **Public example compose** also sets `container_name: polisharr` so a clone-from-dir named `polisharr` does not create `polisharr-polisharr-1`.
5. **Agent workspace** `/home/cgree/optimizarr` is optional `mv` after `git remote set-url`; not required for the product.

## Approach

### 1. In-repo URLs and compose (`main`)

- README clone: `https://github.com/charlesgreever/polisharr.git`
- `reportIssue.ts` + test: issues URL under `/polisharr/`
- `plans/open-issues.md`: same host path (redirects work; update so copy is honest)
- Household compose files: bind `/home/cgreever/appdata/arr/polisharr/config:/config`
- All compose files (example + household):

```yaml
name: polisharr
services:
  polisharr:
    container_name: polisharr
```

`name:` is the Compose project. `container_name:` is the exact Docker name you asked for.

Tests: Report URL assertion. No live-box tests.

### 2. GitHub rename (after the URL commit is on `main`, or immediately before the push that contains it)

```bash
gh repo rename polisharr
git remote set-url origin https://github.com/charlesgreever/polisharr.git
git push origin main
```

Confirm `gh repo view charlesgreever/polisharr` and that `…/optimizarr` redirects.

### 3. ubuntuserver (operator, after compose on `main` has the new bind)

From the current stack directory:

1. `docker compose down` (container gone; bind data untouched)
2. `mv /home/cgreever/stacks/optimizarr /home/cgreever/stacks/polisharr`
3. `mv /home/cgreever/appdata/arr/optimizarr /home/cgreever/appdata/arr/polisharr`
4. Pull/sync compose so the bind is `…/arr/polisharr/config` and `container_name: polisharr`
5. `docker compose up -d --build` in the new stack dir
6. Check: container `polisharr`, `/config/polisharr.db` still present, UI on `:7373`, no second empty config dir

If the stack dir is a git checkout, `git remote set-url` + `git pull` there instead of copying compose by hand.

### 4. Outside this repo (checklist, not code)

- Homepage `services.yaml` if a tile still says Optimizarr (`docs/homepage.md` already says Polisharr)
- Local clone `git remote set-url`; optional rename of `/home/cgree/optimizarr`
- Bookmarks to `github.com/charlesgreever/optimizarr` keep working via redirect

## Out of scope

- Dropping `OPTIMIZARR_*` env aliases, `optimizarr.db` rename, or Optimizarr Arr profile matching
- GHCR / prebuilt image names (not shipped)
- Renaming historical plan filenames
- Wiping household config
