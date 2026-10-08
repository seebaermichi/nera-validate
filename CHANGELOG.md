# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-10-08

### Added

-   `theme-shadowed` warning: a `nera new` starter template (marked with
    `//- nera:scaffold-default`) that hides the configured theme's file of the
    same name. Site views win over theme views file by file, so after
    installing a theme the starter layout kept the site looking unthemed with
    no hint why. Deliberate overrides — any same-named file without the marker
    — stay silent. `SCAFFOLD_MARKER` is exported.

## [1.0.0] - 2026-07-24

Initial release — Slice 3 of the core consolidation (`ROADMAP-core.md`) and the
Nera Pro platform's M1.2 prerequisite.

### Added

-   `validateSite({ cwd })` — validates a Nera site the way the build sees it and
    returns structured `{ file, line, severity, rule, message }` results. Pure and
    read-only. Resolves layouts and includes through the **canonical** layered
    resolver imported from `@nera-static/core` (`resolveSiteModel`, `resolveEntry`,
    `makeLayeredResolver`) — no forked copy, so the CLI and the platform agree on
    "valid."
-   Checks: `config/app.yaml` and page frontmatter parse (`yaml-parse`); a
    configured theme resolves (`theme-unresolved`); a page declares `layout`
    (`layout-missing`, a warning — the build skips such a page silently); the
    layout resolves in the theme-aware view chain (`layout-unresolved`); every
    `include`/`extends` in the reachable pug graph resolves (`include-unresolved`,
    reported once per template ref, cycle-safe). Pug's `.pug` auto-append is
    reproduced, so both extensioned and extensionless includes are judged as the
    build would.
-   `hasErrors(results)` — true if any result is an error (warnings do not fail).
-   `formatResults(results)` — grouped, colourised output shared by the bin and
    the `nera validate` subcommand.
-   `nera-validate` bin — validates the current directory and exits 1 on any
    error, so it is safe as a pre-publish or CI gate.
