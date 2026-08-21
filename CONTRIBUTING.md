# Contributing

## What to read

1. [docs/prd.md](docs/prd.md) — what the product is allowed to do
2. [ENGINEERING_STANDARDS.md](ENGINEERING_STANDARDS.md) — how the TypeScript is allowed to look (`ENG-01` … `ENG-14`)
3. [CODING_STANDARDS.md](CODING_STANDARDS.md) — how comments, README, and UI copy are allowed to read

Cite an id (`ENG-09`) or a RULE (`RULE-04`) in findings.

Agents start at [AGENTS.md](AGENTS.md).

## Filing a bug from the running app

Operators use **Report** on any signed-in page. That control opens a GitHub issue with the current route and job context. Attach a screenshot on GitHub if one would help. Do not put library paths or secrets in the issue body.

## Before you open a change

```bash
npm test
```

Add or update tests next to the module you touched. Assert HTTP or exported behavior, not private store SQL.

## Review

Reviewers check the [ENG-14 checklist](ENGINEERING_STANDARDS.md#eng-14-reviewer-checklist). Spec findings and standards findings stay in separate lists.
