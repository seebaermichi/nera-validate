# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

-   `validateOutput({ cwd, dir = 'public' })` — a second pass over the **built**
    HTML (slice 1 of `ROADMAP-compliance.md`). Throws a "run `nera build` first"
    error when the folder is missing or holds no HTML. Results share
    `validateSite`'s shape plus `source` (the page behind an output file); an
    identical finding on two or more files is collapsed into one, with every
    occurrence under `files`. `validateSite` is unchanged.
-   `config/validate.yaml`: `rules: { <id>: error|warning|off }` sets a rule's
    level; frontmatter `validate_ignore: [<id>, …]` silences rules per page.
    An unknown level is reported as `config-invalid`.
-   First output rule, `a11y-html-lang` (warning): `<html>` without a non-empty
    `lang` (WCAG 3.1.1).
-   The rest of the accessibility rules (slice 2), all hints in English with
    the WCAG criterion: `a11y-title` (2.4.2), `a11y-h1` (1.3.1),
    `a11y-heading-skip` (1.3.1), `a11y-img-alt` (1.1.1), `a11y-form-label`
    (1.3.1, 4.1.2), `a11y-link-name` (2.4.4, 4.1.2), `a11y-main` (1.3.1),
    `a11y-skip-link` (2.4.1), `a11y-nav-name` (1.3.1), `a11y-duplicate-id`
    (4.1.2) and `a11y-viewport-zoom` (1.4.4) as warnings; `a11y-link-lang`
    (3.1.2), `a11y-target-blank` (3.2.5) and `a11y-reduced-motion` (2.3.3)
    opt-in (`off` until enabled in `config/validate.yaml`).
-   `validateOutput` also reads the output's CSS files, for
    `a11y-reduced-motion` (plain text matching, no CSS parser). CSS findings
    carry no `source`, and `validate_ignore` does not apply to them.
-   Privacy and legal-notice rules (slice 3), hints in English with the law in
    brackets, never a verdict: `privacy-third-party` (resources loaded from
    another host, in HTML and CSS; specific messages for Google Fonts, YouTube,
    Vimeo, Google Analytics / Tag Manager and maps), `privacy-insecure`
    (`http://` resources and form actions), `legal-imprint-link` (§ 5 DDG),
    `legal-privacy-link` (Art. 13 DSGVO) and `legal-outdated-law` (TMG, TTDSG,
    § 55 RStV on the legal pages only) as warnings; `privacy-storage`
    (`document.cookie`, `localStorage`, `sessionStorage`, `indexedDB` in inline
    scripts and `.js` files, § 25 TDDDG) opt-in.
-   `config/validate.yaml` also takes `legal.imprint` / `legal.privacy` (per
    language, the site path every page must link to) and
    `privacy.allowed_hosts`. Unusable values are reported as `config-invalid`
    and ignored.
-   The site's own host is `origin` in `config/app.yaml`, else `app_origin` in
    `config/canonical-links.yaml` — the same resolution as
    `plugin-canonical-links`. Without either, only relative URLs count as the
    site's own.
-   `validateOutput` also reads the output's `.js` files, for `privacy-storage`.
-   Dependencies `htmlparser2` ^10.1.0 and `domutils` ^3.2.2 — the last majors
    that keep the Node >= 20 floor (11+ require >= 20.19).

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
