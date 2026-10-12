# Issue conventions

Review rules for work on `@nera-static/validate` (the Nera site validator), run
through Snagio from `nera-validate/`. Its issues live on the shared **"Nera AI"**
board (spec `../nera-cli/ROADMAP-ai.md`) and carry the `[nera-validate]` title
prefix; the output-check rules have their own spec, `ROADMAP-compliance.md`, in
this repo. **Work an issue only from the repo it names.**

The workspace `../CLAUDE.md` holds the fleet-wide rules (semver, CHANGELOG,
releases); this file only adds what a reviewer checks per diff.

## Non-negotiables

- **The specs are the single source of truth:** `../nera-cli/ROADMAP-ai.md` for
  Nera AI issues, `ROADMAP-compliance.md` for the `a11y-*`/`privacy-*`/`legal-*`
  rules. A decision made while working an issue is written back into the spec in
  the same pass — never only into the issue.
- **Semver + `CHANGELOG.md` in the same commit as the change** (Keep a Changelog,
  four-space bullets, `**BREAKING**:` prefix). Bump with
  `npm version <bump> --no-git-tag-version`. The result shape
  `{ file, line, severity, rule, message }` and every `rule` id are a contract
  (the CLI, `nera check`, Nera Pro and `ignore:` in `config/validate.yaml` key on
  them): renaming or removing one is **major**, a new rule is minor, a reworded
  message is patch.
- **Never publish or push.** No `npm publish`, no `git push`, no tags pushed.
  Releases go out by the maintainer pushing a `v*` tag; hand over the commands.
- Paste-ready text for the maintainer goes in a fenced code block between
  `----- START: … -----` and `----- END -----` lines, never in a blockquote.

## Framework correctness

- ESM only, Node `^20.19.0 || >=22.0.0`; eslint style: 4-space indent, no
  semicolons, single quotes. No new runtime dependency without a stated reason —
  every site installs this package through `@nera-static/nera`.
- Resolution goes through `@nera-static/core`'s canonical resolver
  (`resolveSiteModel`, `resolveEntry`), never a local mirror — the CLI, the
  library and the platform must agree on "valid".
- Library functions return results; only `bin/nera-validate.js` prints and exits.
  `formatResults`/`formatOutputResults` return strings so they stay testable.
- Every message says **what** is wrong, **where** (file, line, the offending
  value) and **what to do** — actionable on its own for a human or an AI agent.
- Output checks are warnings by default; a clean run is never presented as proof
  of compliance (`OUTPUT_NOTE`).

## UI walkthrough

- No UI: this package is a library plus a CLI. Its output is checked through tests
  and, for a real site, `npx nera-validate` / `nera check` in a throwaway copy.

## Tests & hygiene

- `npx vitest run && npm run lint` must pass (`npm test` is watch mode — never use
  it here). Run from the package root.
- New behaviour has a test in `test/` in the style of the neighbouring file
  (temp-dir site fixtures, no network).

## Reconciliation steps (run when resolving an issue)

- Version bump + `CHANGELOG.md` entry in the change's commit if it ships in the
  tarball (`index.js`, `src/`, `bin/`); none for specs, tests, CI or `.claude/`.
- Update the spec the issue names (`../nera-cli/ROADMAP-ai.md`: mark the slice
  item done with the date and any choice made; `ROADMAP-compliance.md` for rules).
- README changes when the rule list, options or result shape changed.
- Hand over the release commands (`git push`, `git tag -a v<x.y.z> …`) — do not run
  them.
