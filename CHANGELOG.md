# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.6.0] - 2026-10-17

### Changed

-   The output pass now reads `<embed src>`, `<object data>` and `<track src>`
    as resources, so `privacy-third-party` and `privacy-insecure` report them
    like an `<iframe>` or `<video>`. Sites with such elements may see new
    warnings.
-   `privacy-third-party` adds a consent hint when a host's first use in a
    file is an element `@nera-static/plugin-consent` can gate (`script`,
    `iframe`, `embed`, `object`, `video`, `audio`, and `source`/`track` inside
    `video`/`audio`): gate the element with `data-consent`. Images, `<link>`s,
    `picture > source` and CSS keep the previous message. A host whose first
    use differs between pages now collapses into two findings, one per
    message.

### Fixed

-   A `<script>` the browser never runs is no longer read as a resource:
    `privacy-third-party` and `privacy-insecure` skip a `src` on a script whose
    `type` is not JavaScript (`text/plain`, JSON-LD, an import map, a type with
    parameters), following the HTML spec's rules (case and surrounding
    whitespace ignored, legacy `language` honoured). The consent-gated markup
    of `@nera-static/plugin-consent` (`type="text/plain"` with `data-src`,
    `data-consent-*` attributes on gated `iframe`/`video`/`audio`/`embed`/
    `object`) therefore gives no `privacy-third-party` finding.
    `privacy-storage` uses the same rules for inline scripts.

## [1.5.0] - 2026-10-16

### Changed

-   `engines.node` is now `>=22.12.0` (was `^20.19.0 || >=22.0.0`), documenting
    the real floor. A site installs validate next to `@nera-static/nera`, which
    brings vite 8, and the npm 10.8.2 bundled with Node 20 crashes in arborist
    (`Cannot read properties of null (reading 'edgesOut')`) on the optional peer
    dependencies of current vite 8 releases, so a fresh site cannot be installed
    there. Node 22.12 bundles npm 10.9, which installs it, and Node 20 is past
    its end of life. Validation finds the same as before.

## [1.4.3] - 2026-10-14

### Changed

-   Updated `htmlparser2` to `^12.0.0` and `domutils` to `^4.0.2` (both now
    ESM-only, Node >= 20.19.0, which matches this package's own floor). The
    output pass parses and queries the built HTML the same way; findings are
    unchanged.

## [1.4.2] - 2026-10-12

### Changed

-   Every message now says what is wrong, where, and what to do, so a
    finding read on its own (`nera validate --json`, `nera check --json`) is
    actionable. `layout-missing` names an example `layout:` and the `ignore`
    entry; `layout-unresolved` and `include-unresolved` list the files looked
    for and the one to create; `yaml-parse` keeps only the parser's first line
    and names the usual fix (frontmatter positions are now file lines);
    `theme-unresolved` and `config-invalid` say how to fix the value; the
    output rules (`a11y-*`, `privacy-*`, `legal-*`) end with a short fix.
    Messages keep their opening words; rule ids, severities, levels, `file`
    and `line` are unchanged.

### Fixed

-   An extensionless `include`/`extends` target that only the theme has
    (`include ../partials/nav`) is no longer reported as `include-unresolved`:
    like Pug, validate now appends `.pug` before resolving it.
-   An extensionless `layout` (`layout: pages/default`) is now reported as
    `layout-unresolved`, with the missing `.pug` as the fix. The build passes
    the value to Pug as is and fails on it even when `pages/default.pug`
    exists; validate used to accept it.

## [1.4.1] - 2026-10-11

### Changed

-   README shows the Test workflow and npm version badges under the title, like every other Nera package.

## [1.4.0] - 2026-10-09

### Changed

-   **`engines.node` corrected from `>=20.0.0` to `^20.19.0 || >=22.0.0`**,
    matching `@nera-static/core` 4.14.0. Through core, validate pulls in
    `entities@8` (via markdown-it 15), which declares `>=20.19.0`, and
    `rimraf`/`glob` already excluded Node 21; the old range claimed support
    the dependency tree does not, and installing on an older Node 20 printed
    `EBADENGINE` warnings. This documents the real floor rather than removing
    working support; Node 20 itself reached end of life on 2026-04-30. If you
    are below 20.19, upgrade Node (22 LTS recommended).

## [1.3.0] - 2026-10-09

### Added

-   `ignore: { <rule-id>: [path, …] }` in `config/validate.yaml` silences a
    rule on the listed files and folders, in `validateSite` and
    `validateOutput` alike. Paths are relative to the site root, a folder
    covers everything below it, and `*` stands for one folder name
    (`pages/*/references`). Made for `layout-missing` on content fragments and
    drafts, which have no `layout` on purpose. Unusable values are reported as
    `config-invalid` and ignored.

### Changed

-   `validateSite` now reads `config/validate.yaml` (for `ignore`), so a file
    that does not parse is a `yaml-parse` error in `nera validate` too, not
    only in `nera check`. Without the file, results are unchanged.

## [1.2.0] - 2026-10-09

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
-   `nera-validate --output` runs `validateOutput` over the built `public/`
    (the pass `nera check` runs; this bin has no verbs). Same exit code: 1
    only when a finding has the level `error`.
-   `formatOutputResults(results)`: `formatResults` ending with `OUTPUT_NOTE`,
    the reminder that a clean run is not proof of compliance (automated checks
    find only part of the WCAG problems) and that the hints are not legal
    advice. Used by the bin's `--output` and by `nera check`.
-   README: the output pass — rule tables with default levels and the WCAG
    criterion or law, `config/validate.yaml`, `validate_ignore`, the site's own
    host and the German/English link-text heuristic.

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
