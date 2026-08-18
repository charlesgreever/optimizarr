# Agents

Optimizarr has three sources of truth. Read the file that matches the work. Do not copy their rules into this file.

## Steps

1. **Spec.** Open `docs/prd.md`. Done when you can name the user-facing outcome the change is allowed to produce.

2. **Code.** Before you edit TypeScript, tests, Docker, or compose, read `ENGINEERING_STANDARDS.md` and apply every `ENG` rule the diff can touch. Done when each applicable item on the ENG-14 checklist is satisfied.

3. **Prose.** Before you edit README, CONTRIBUTING, comments, UI copy, or a commit subject, read `CODING_STANDARDS.md` and write to those RULE ids. Done when a junior engineer can read the new strings without inferring *arr jargon.

4. **Review.** Treat spec (step 1) and standards (steps 2–3) as separate axes. Cite `ENG-04` or `RULE-02` in findings. Done when both axes have an explicit pass or a named break.

## Breaks

Name the rule id and why when you break it.
