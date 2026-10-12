# Work log — 01a1260d-8eb2-71a9-8688-5a7ff8f4b449-nera-validate-review-all-messages-what-where-what-to-do

- **Issue:** `01a1260d-8eb2-71a9-8688-5a7ff8f4b449`

## Issue snapshot (2026-10-12)

- **Id:** `01a1260d-8eb2-71a9-8688-5a7ff8f4b449`
- **Type:** improvement
- **Group:** S3 JSON output
- **Status:** in_progress
- **Title:** [nera-validate] Review all messages: what, where, what to do

Spec: `nera-cli/ROADMAP-ai.md` — L3.

Every validate/check message must be actionable on its own for an agent. Patch release of `@nera-static/validate` if text changes.

## Cloud launch (2026-10-12)

- **Worked in a Claude Code cloud session**, outside the local plan → implement → review → approve loop (to use the cloud credit). The gate was not armed.
- **Brief:** `plans/cloud/01a1260d-8eb2-71a9-8688-5a7ff8f4b449-brief.md` · **Branch:** `issue/01a1260d-message-review` · **Session:** launched by the user (`! claude --cloud`), URL to be recorded
- **On return:** `/work-issue-cloud 01a1260d-8eb2-71a9-8688-5a7ff8f4b449` — verify locally, triage, merge, reconcile (ROADMAP-ai.md slice 3 note, validate 1.4.2 release), resolve.

## Cloud result (2026-10-12)

- **Branch:** `issue/01a1260d-message-review` · 9 commits · result file `plans/cloud/01a1260d-8eb2-71a9-8688-5a7ff8f4b449-result.md`
- **Summary:** every source- and output-pass message now reads `<what> — <why>; <what to do> (<ref>)`; openings, rule ids, severities, levels, `file`, `line` unchanged. `layout-missing` names the most-used layout + the exact `ignore` entry; `*-unresolved` list the files looked for and the one to create; `yaml-parse` one shared fix, frontmatter positions as file lines. Tests 106 → 155.
- **Verified locally:** `npm ci && npm run lint && npx vitest run` on Node 22.22.0 → lint clean, 155/155; `npx vitest run` on Node 20.20.0 → 155/155.
- **Verified locally:** contract grep (`git diff main -- src index.js bin | grep -E "rule:|severity|level:"`) → empty; `include-unresolved` still contains `does not resolve`.
- **Verified locally:** broken demo site (no layout, unknown layout, missing include, bad frontmatter, bad validate.yaml) → every line names value, place and fix; the suggested `ignore: { layout-missing: [pages/nolayout.md] }` silences the warning; theme mode (`theme: ./mytheme`) lists site + theme paths and names the site copy to create.
- **Review findings:** `src/pug-refs.js` `unresolvedMessage` and `index.js` `layoutUnresolvedMessage` list the same path twice when the theme root equals the site's views root (`theme: ./theme` with a `theme/` folder, which core makes the site views); confirmed carry-forward 1 live (`include ../partials/x`, theme-only `x.pug` → false `include-unresolved`). Display-only path re-derivation accepted under the "no local mirror" rule (verdict still from core's resolver).

### Decisions
- Message form `<what> — <why>; <what to do> (<law/WCAG ref>)`; fix starts with an imperative after the first ` — ` or a later `; `; a deliberate opt-out joins with `, or …`.
- Table test pins that form for every source-pass rule (imperative verb list), one line, lower-case/backtick start, no trailing period.
- `yaml-parse`: parser's first line without trailing `:`, one shared fix; frontmatter `at line N` rewritten to the file line.
- `layout-missing`: example = most-used resolving layout (first on tie), else "a `layout:` key"; names views folders and the exact `ignore` entry. `validate.yaml` now read before the page walk.
- "looked for" lists exactly the files checked, site-relative, in order; "create" names the site's own copy.
- `theme-unresolved`: fix added only to core's "does not exist" variant.
- `config-invalid` shows the correct YAML (`— write it as …; ignoring it`).
- Output-pass fixes use only element values or static text (collapsing unchanged); legal/privacy stay hints.
- `privacy-third-party`: real fix plus `privacy.allowed_hosts` opt-out; GA/GTM note adds "load it only after the visitor agrees".

### Carry forward
- `src/pug-refs.js:12-19` `resolveTarget`: theme-only extensionless include reported unresolved (confirmed locally).
- `index.js` `resolveLayout`: extensionless `layout` — unverified whether the build (`render.js:492` → `resolveEntry` → compile) accepts it at all; validate may disagree in either direction.
- `index.js` `yaml-parse` on `config/app.yaml` has `line: null`; needs core's `resolveSiteModel` to expose the line.
- `README.md` (Checking the built output) and `ROADMAP-compliance.md:65` quote a Google Fonts message that does not exist.
- `@nera-static/core` `src/theme.js:51,150,241`: suggested wording (site-relative paths, fix after ` — `); validate's variant-1 suffix to be dropped together.
- Review: duplicate path in "looked for" when the theme root equals the site views root.

## Triage (2026-10-12)

| # | Item | Decision |
|---|---|---|
| 1 | Duplicate path in "looked for" when theme root = site views root | fix |
| 2 | README + ROADMAP-compliance.md:65 quote a non-existent Google Fonts message | fix |
| 3 | Extensionless theme-only include false positive (+ extensionless `layout` question) | fix (user's choice: in this release, after testing the real build) |
| 4 | `yaml-parse` on app.yaml has `line: null` (needs core) | file |
| 5 | Core theme-error wording (`theme.js:51,150,241`) | file |

## Resolved (2026-10-12)

- Fixed on the branch before the merge: extensionless include/layout now match the build (`6c83907`), dedupe of "looked for", real Google Fonts quote in README + ROADMAP-compliance.md (`7bfed4a`). 158/158 on Node 20 and 22.
- Merged fast-forward into `main`; release commit `chore(release): 1.4.2`; spec note in `nera-cli/ROADMAP-ai.md` (`006997e`).
- Filed separately (offered as /issue): `app.yaml` `yaml-parse` line via core; core theme-error wording.
- Resolved with target version 1.4.2. Push + tag handed to the user.
