# ROADMAP — output checks: accessibility, privacy and legal hints

> **Status: spec, decisions settled 2026-10-09. Slice 1 (infrastructure +
> `a11y-html-lang`), slice 2 (the rest of the `a11y-*` table), slice 3 (the
> `privacy-*` and `legal-*` tables) and slice 4 (`nera check`, `nera build
> --check`, `--output`, READMEs, CLI docs) implemented 2026-10-09; slice 5
> (field test, then release) done 2026-10-09 — validate 1.2.0, then nera with
> `nera check`.**
>
> This document is the single source of truth for teaching `@nera-static/validate`
> to check the **built HTML** of a Nera site for accessibility (WCAG / BITV /
> BFSG), privacy (DSGVO, TDDDG) and legal-notice (DDG) problems that a machine can
> find. Extend this file rather than starting a parallel one, as
> `generator/ROADMAP-core.md` and `generator/ROADMAP-themes.md` anchor their work.

## Why

The idea started as a plugin. A plugin is the wrong place:

- Plugin hooks see `pagesData[].content` — the markdown-it HTML of the page body
  — but **not the page the visitor gets**. Everything the layout adds is missing:
  `<html lang>`, `<title>`, `<main>`, navigation, the footer with the imprint
  link, and every script, stylesheet and font the theme loads. Most of the
  findings below live exactly there.
- A plugin has no channel for findings except `console.warn`, on every build.

`@nera-static/validate` already has the channel: a structured result shape
(`{file, line, severity, rule, message}`), a shared formatter, an exit code for
CI, and two consumers — `nera validate` and the Nera Pro platform. What it lacks
is a pass over the rendered output.

The motivating case is `michael-becker-berlin.de`, audited by hand on
2026-10-09. Three of its fix commits are the test bed (see "Acceptance criteria"):

| Commit | Fix | Machine-checkable? |
|---|---|---|
| `d2b7b2a` | skip link, named navs, one `h1`, no heading jumps, `aria-current`, `lang` on the language link, form-field contrast 3:1, focus outline, `prefers-reduced-motion`, no `target=_blank` | mostly — not contrast or focus visibility |
| `dff457d` | imprint cites the DDG/MStV instead of the TMG | yes (text) |
| `98f49c1` | privacy policy describes the processing that actually happens | **no** |

## Scope

**In:** structural checks on the HTML and CSS in the output folder that a parser
can decide without rendering — the rule catalogue below.

**Out, deliberately:**

- **Anything that needs layout or computed styles** — colour contrast, visible
  focus, target size, reflow at 320px. That needs a real browser (axe-core +
  Playwright + Chromium), far too heavy a dependency for a validator that every
  site installs. A separate, optional package is a possible later step (see
  "Later").
- **Whether legal texts are correct or complete.** The validator can say "this
  page has no link to an imprint" or "the imprint cites the TMG". It cannot say
  "the privacy policy matches what the site does" — that was `98f49c1`.
- **Whether a law applies at all** (e.g. whether the BFSG covers a given site).
- **Consent banners.** A static scan can see that a third-party script is
  loaded; it cannot see whether a banner gates it.

Automated accessibility testing catches only a minority of WCAG failures (around
a third is the usual estimate). The output must say so rather than suggest that
a clean run means a compliant site.

**Tone of every message:** a hint, not legal advice. Messages name the rule and
what was found ("loads fonts.googleapis.com — a third-party request that sends
the visitor's IP address"), never a verdict ("violates the DSGVO").

## Design

### API — a second, separate entry point

```js
import { validateSite, validateOutput } from '@nera-static/validate'

validateSite({ cwd })                    // unchanged: sources only, renders nothing
validateOutput({ cwd, dir = 'public' })  // new: reads the built HTML and CSS
```

`validateSite` stays pure and read-only over the sources; its meaning ("will
build there") does not change. `validateOutput` is the new pass and **requires a
build first** — it reads `public/` (or `dir`) and throws a clear error if the
folder is missing or holds no HTML. Both return the same result shape, so
`formatResults` and `hasErrors` work unchanged.

### Result shape and source mapping

`file` is the output file (`public/de/impressum.html`), `line` the 1-based line
in it (core runs the output through `pretty`, so lines are meaningful). Where an
output file has a source page — the inverse of core's `meta.href` derivation,
`public/de/impressum.html` ← `pages/de/impressum.md` — the result also carries
`source: 'pages/de/impressum.md'`. This is an additive field; existing consumers
ignore it. The platform needs it to point an editor at the page to fix.

### Collapsing template findings

A problem in a layout repeats on every page: a missing skip link on a 32-page
site is 32 identical findings. Findings with the same `rule` and `message` on
more than one file are **collapsed into one**, listing the count and the first
few files ("on 32 pages, e.g. public/index.html, …"). The fix is one template,
so the report should read as one problem.

### Severity and configuration

Every new rule is a **warning by default**. The existing rule set means "the
build is broken"; heuristics about law and accessibility must not fail a CI gate
unless the site owner asks for it.

Configuration lives in `config/validate.yaml`, following the plugin convention
(`config/<name>.yaml`, missing file = defaults):

```yaml
rules:
  a11y-img-alt: error        # promote to error: fails `nera validate`
  a11y-target-blank: off     # disable
legal:
  imprint:                   # per language, the page every page must link to
    de: /de/impressum.html
    en: /en/imprint.html
  privacy:
    de: /de/datenschutz.html
    en: /en/data-protection.html
privacy:
  allowed_hosts:             # third-party hosts the owner has accounted for
    - cdn.example.org
```

Per page, frontmatter `validate_ignore: [rule-id, …]` silences rules for that
page's output file (it is mapped back through `source`).

### Parser

Use **htmlparser2** (with `domutils`/`css-select`) directly, not cheerio. Cheerio
pulls in undici, which is why `plugin-link-attributes` and `plugin-one-page`
need Node ≥ 20.18.1; validate requires only Node ≥ 20, and raising that floor
would be a breaking change for a package every site installs. htmlparser2's
`withStartIndices` gives the offsets needed for line numbers. CSS is scanned
with plain text matching (two heuristic rules only); no CSS parser.

## Rule catalogue

Rule ids are stable once released — the platform keys on them (and may
translate messages by id). `opt-in` rules are `off` until enabled in
`config/validate.yaml`.

### Accessibility (`a11y-*`) — WCAG 2.2 AA where machine-decidable

| rule | finds | WCAG | default |
|---|---|---|---|
| `a11y-html-lang` | `<html>` without a non-empty `lang` | 3.1.1 | warning |
| `a11y-title` | missing or empty `<title>` | 2.4.2 | warning |
| `a11y-h1` | not exactly one `<h1>` | 1.3.1 (best practice) | warning |
| `a11y-heading-skip` | a heading level jump (`h2` → `h4`) | 1.3.1 | warning |
| `a11y-img-alt` | `<img>` without an `alt` attribute (`alt=""` is valid: decorative) | 1.1.1 | warning |
| `a11y-form-label` | `input`/`select`/`textarea` (not `hidden`/`submit`/`button`) with no `<label for>`, wrapping label, `aria-label` or `aria-labelledby` | 1.3.1, 4.1.2 | warning |
| `a11y-link-name` | `<a href>` with no text, no `aria-label` and no `img[alt]` inside | 2.4.4, 4.1.2 | warning |
| `a11y-main` | no `<main>`, or more than one | 1.3.1 | warning |
| `a11y-skip-link` | the first focusable element is not a same-page link to an existing `id` | 2.4.1 | warning |
| `a11y-nav-name` | more than one `<nav>`, and one lacks `aria-label`/`aria-labelledby` | 1.3.1 | warning |
| `a11y-duplicate-id` | an `id` used twice in one page (breaks `for`, skip links, ARIA references) | 4.1.2 | warning |
| `a11y-viewport-zoom` | `<meta name=viewport>` with `user-scalable=no` or `maximum-scale` < 2 | 1.4.4 | warning |
| `a11y-link-lang` | a link with `hreflang` but no `lang` matching it (e.g. the language switch) | 3.1.2 | opt-in |
| `a11y-target-blank` | `target="_blank"` links (unannounced context change) | 3.2.5 (AAA) | opt-in |
| `a11y-reduced-motion` | a CSS file with `scroll-behavior: smooth` or `animation` but no `prefers-reduced-motion` query anywhere in it | 2.3.3 (AAA) | opt-in |

### Privacy (`privacy-*`) — DSGVO, TDDDG

| rule | finds | default |
|---|---|---|
| `privacy-third-party` | a resource loaded from a host other than the site's own (`origin` in `app.yaml`, else `app_origin` in `canonical-links.yaml` — decision 6) or a relative URL: `script[src]`, `link[rel=stylesheet\|preload\|icon\|modulepreload]`, `img`, `iframe`, `video`, `audio`, `source`, and `@import`/`url()`/`@font-face` in CSS. Plain `<a href>` links are not resources and are ignored. Hosts in `privacy.allowed_hosts` are skipped. Known hosts get a specific message (Google Fonts → IP transfer, cf. LG München I, 3 O 17493/20; YouTube/Vimeo embeds; Google Analytics/Tag Manager; maps) | warning |
| `privacy-insecure` | an `http://` resource or a `<form action="http://…">` | warning |
| `privacy-storage` | a site-owned script (inline or under `public/`) touching `document.cookie`, `localStorage`, `sessionStorage` or `indexedDB` — § 25 TDDDG: storage on the device needs consent unless strictly necessary. A heuristic: the hint asks the owner to confirm it is necessary | opt-in |

### Legal notice (`legal-*`) — DDG, MStV

| rule | finds | default |
|---|---|---|
| `legal-imprint-link` | a page with no link to the imprint (§ 5 DDG: "easily recognisable, directly reachable"). Uses `legal.imprint` for the page's `lang`; without config, falls back to link text matching `Impressum`, `Imprint` or `Legal notice` — on `de`/`en` pages only (decision 7) | warning |
| `legal-privacy-link` | the same for the privacy policy (`Datenschutz`, `Privacy`, `Data protection`) | warning |
| `legal-outdated-law` | the imprint or privacy page cites a superseded law: `TMG`/`Telemediengesetz` (→ DDG since 2024-05-14), `TTDSG` (→ TDDDG), `§ 55 RStV` (→ § 18 MStV) | warning |

`legal-outdated-law` checks **only the configured legal pages**, never the whole
site. `michael-becker-berlin.de` shows why: its cookie-banner blog draft mentions
the TTDSG on purpose, to explain the renaming. Without `legal.*` config the rule
falls back to pages the link-text heuristic identified as the imprint and privacy
pages.

## CLI

In `@nera-static/nera` (`nera-cli/src/commands/validate.js`):

```bash
nera validate        # unchanged: sources only
nera check           # the built output in public/ only (build first)
nera build --check   # build, then `nera check` — one command for CI
```

`validate` means the sources, `check` means the output: two verbs keep the two
passes apart. `nera check` fails with "run `nera build` first" when `public/` is
missing. The standalone `nera-validate` bin gets an `--output` flag for the same
pass, since it has no verbs. The summary line ends with the reminder that a clean
run is not proof of compliance.

## Semver

- `@nera-static/validate`: `validateOutput`, the new rules, the `source` field and
  `config/validate.yaml` are all additive → **minor** (1.2.0). No engine change
  (the parser choice keeps Node ≥ 20).
- `@nera-static/nera`: the `check` command and the `--check` flag are additive →
  **minor**. It needs the new
  validate range.
- No change to `@nera-static/core` or any plugin.

## Slice plan

1. **Infrastructure.** `validateOutput`, output walking, htmlparser2 + line
   numbers, source mapping, collapsing, `config/validate.yaml` (rule levels,
   `off`, `validate_ignore`), and one rule end to end (`a11y-html-lang`), with
   temp-dir tests in the style of `test/validate.test.js` (write HTML into
   `public/`, assert findings).
   **Done 2026-10-09** (`src/output.js`, `src/output-rules.js`,
   `test/output.test.js`). Choices made on the way: htmlparser2 is pinned to
   **^10** (11+ requires Node ≥ 20.19, which would raise the floor); a collapsed
   finding keeps the first file as `file`/`line`, appends "(on N pages, e.g. …)"
   to the message and lists every occurrence under `files`; repeats within one
   file are not collapsed; an unknown level in `config/validate.yaml` is a
   `config-invalid` warning and the default is kept; rule ids the release does
   not know are ignored silently (forward compatibility).
2. **Accessibility rules.** The `a11y-*` table.
   **Done 2026-10-09** (rules in `src/output-rules.js`, tests in
   `test/output.test.js`). No new dependency: `domutils` predicates were
   enough, so no `css-select`. CSS rules carry `kind: 'css'`; `validateOutput`
   runs them over every `.css` file in the output as plain text, and their
   findings have no `source` and ignore `validate_ignore`. Messages name an
   element by its identifying attribute (`src`, `href`, `type`/`name`/`id`)
   so the same template element collapses across pages while different
   elements stay apart. Choices made on the way:
   - `a11y-h1`, `a11y-main`: "none" is anchored at `<body>`, "more than one"
     is one finding at the second element. `a11y-main` also counts
     `role="main"`.
   - `a11y-heading-skip`: only jumps *down* by more than one level; the first
     heading is the baseline (a missing `h1` is `a11y-h1`'s job).
   - `a11y-form-label`: also exempts `reset` and `image` inputs (they carry
     their own name); a `title` attribute does not count as a label.
   - `a11y-link-name`: also accepts `aria-labelledby`; text inside an inline
     `<svg>` (its `<title>`) counts as text.
   - `a11y-skip-link`: a page with nothing focusable is silent. "Focusable" is
     approximate — links/areas with `href`, form controls not `disabled`,
     `iframe`, `summary`, `audio`/`video[controls]`, any `tabindex` ≥ 0 — and
     cannot see `display: none`. A `#id` link whose target is missing gets its
     own message.
   - `a11y-duplicate-id`: one finding per repeated id, at its second use.
   - `a11y-viewport-zoom`: `user-scalable` of `no`, `0` or `false`, or
     `maximum-scale` < 2; one finding naming both when both are set.
   - `a11y-link-lang`: matches on the primary subtag (`es-ES` ↔ `es`); the
     `lang` may sit on the link, its nearest ancestor with one, or an element
     inside it; `hreflang="x-default"` is skipped.
   - `a11y-reduced-motion`: comments are blanked first; `animation: none`
     does not count; `transition` is not checked. A collapsed CSS finding
     still says "on N pages" (the collapse wording from slice 1).
   - Plausibility run against `nera-website` (built from `81c94fc`), defaults:
     three findings — `a11y-skip-link` (105 pages, the header has none),
     `a11y-nav-name` (48 pages, plugin-page-pagination's unnamed `<nav>`),
     `a11y-form-label` (3 search pages, plugin-search's input). With the
     opt-ins on: `a11y-target-blank` on the header/footer GitHub and npm links
     and the plugin catalog; `a11y-link-lang` and `a11y-reduced-motion` stay
     silent (the language switch sets `lang`; the CSS has no motion).
3. **Privacy and legal rules.** The `privacy-*` and `legal-*` tables.
   **Done 2026-10-09** (rules in `src/output-rules.js`, config and the
   site-wide pass in `src/output.js`, tests in `test/output.test.js`). No new
   dependency. Structure added: `validateOutput` now parses every page first,
   then checks; page rules also get `url` (the output file's site path) and
   `site` (own host, allowed hosts, legal config, legal pages). A page rule may
   read CSS or JavaScript too, via `checkCss` / `checkJs` (`kind: 'css'` stays
   for CSS-only rules); `.js` findings, like CSS ones, have no `source`.
   `config/validate.yaml` gains `legal.imprint`, `legal.privacy` and
   `privacy.allowed_hosts`; an unusable value (not a mapping, a path not
   starting with `/`, a URL instead of a host name) is a `config-invalid`
   warning and is ignored. The two spec gaps were settled as decisions 6 and 7.
   Choices made on the way:
   - `privacy-third-party`: one finding per host per file, at its first use,
     naming the host — the host is what receives the IP address, and the
     message stays the same across pages so a template resource collapses.
     `srcset` candidates and `video[poster]` count; `<link rel>` other than
     `stylesheet`/`preload`/`icon`/`modulepreload` (canonical, alternate,
     preconnect) does not. `allowed_hosts` matches the exact host. In CSS:
     `url()` (which covers `@font-face src`) and `@import "…"`, comments blanked.
   - `privacy-insecure`: HTML only, one finding per element, named by the
     attribute holding the `http://` URL. Plain `<a href="http://…">` links are
     not resources and stay silent.
   - `privacy-storage`: inline scripts that run as JavaScript (no `type`,
     `module`, or a JavaScript MIME type — JSON-LD and import maps are skipped)
     and every `.js` file in the output; one finding per script listing what it
     touches. Plain text: a comment mentioning `localStorage` counts too.
   - `legal-*-link`: link text and `aria-label`, case-insensitive substring
     (`Datenschutzerklärung` matches `Datenschutz`). With config, the link's
     `href` is resolved against the page and compared as a path: `/x`,
     `/x.html`, `/x/` and an absolute URL on the own host are the same page.
     Anchored at `<body>`.
   - `legal-outdated-law`: the legal pages are, per kind and language, the
     configured path, else the target the heuristic finds on the **most**
     pages — the footer link wins over a blog post linked as "Datenschutz bei
     Cookie-Bannern". One finding per law per page, at its first mention in
     visible text (scripts and styles excluded). Matches `TMG` /
     `Telemediengesetz`, `TTDSG` / its long name, `§ 55 (Abs. n) RStV`.
   - Plausibility run against `nera-website` (built from `81c94fc` in a
     scratch copy): no `privacy-*` or `legal-*` findings, with defaults and
     with every opt-in plus a `legal` config for all three languages — checked
     against the HTML: the absolute `nera.js.org` URLs are canonical/alternate
     `<link>`s, the CSS loads only its own fonts, `search.js` touches no
     storage, the heuristic identifies exactly `/legal-notice`, `/privacy` and
     their `/de/` versions (Spanish is left to config), and those pages cite
     § 5 DDG and § 18 MStV. Four faults planted in the copy (a Google Fonts
     stylesheet on two pages, `§ 5 TMG` in the Spanish imprint, a missing
     imprint link on `/es/`, `localStorage` in `search.js`) were each reported
     once, at the right line.
4. **CLI and docs.** `nera check` and `nera build --check` in `nera-cli`,
   `--output` in the validate bin; `nera build --check` in `nera-website`'s CI
   workflow;
   both READMEs; the CLI docs page on nera.js.org in all three languages
   (`nera-website/pages/docs/cli.md`, `pages/de/docs/cli.md`,
   `pages/es/docs/cli.md`).
   **Done 2026-10-09**, except the `nera-website` CI workflow, which waits for
   the release (decision 5). Order of publishing: decision 8. Structure added:
   - validate: `formatOutputResults(results)` and `OUTPUT_NOTE` — the shared
     report ending with the reminder that a clean run is not proof of
     compliance and the hints are not legal advice, so the bin and the CLI
     print the same text. `formatResults`, and so `nera validate`'s output,
     is unchanged. The bin's `--output` runs `validateOutput` with the same
     exit-code rule; its tests spawn the bin.
   - nera-cli: `src/commands/check.js#runCheck` returns the exit code like
     `runValidate`; the "run `nera build` first" error is validateOutput's own
     throw, printed by the bin's `❌` handler (exit 1). `runBuild(args)` now
     returns an exit code too — 0, or `runCheck()`'s after `--check` — and
     the bin sets `process.exitCode` from it rather than calling
     `process.exit`, so a plain build still ends on its own.
   - READMEs: validate carries the full rule tables (id, default, WCAG
     criterion or law); nera-cli a summary and a link to them. The website's
     CLI page has the compact table (id, default, basis) in all three
     languages; its Spanish config example uses `legal.*.es`, since decision 7
     leaves Spanish pages to config.
   - Plausibility run: `nera check` (nera-cli checkout, validate linked) over a
     scratch copy of `nera-website` built from `81c94fc` plus the new docs:
     exit 0, the three findings of slice 2 (`a11y-skip-link` on 105 pages,
     `a11y-nav-name` on 48, `a11y-form-label` on 3) and the reminder; with
     `a11y-form-label: error` exit 1; with `public/` removed "run `nera build`
     first", exit 1 (`nera-validate --output` the same). `nera build --check`
     from a CLI checkout cannot build that copy: core resolves npm plugins
     from its own `node_modules`, not the site's, so it is proven by the
     nera-cli tests on a scaffolded site instead. Inside an installed site
     core sits in the site's `node_modules` and this does not arise.
5. **Field test** against `michael-becker-berlin.de` (acceptance criteria below),
   then release validate and nera. Then, in this order: validate 1.2.0 (tag);
   in nera-cli `"@nera-static/validate": "^1.2.0"` + lockfile + a `### Changed`
   CHANGELOG line, push with the held slice-4 commit, release nera; in
   nera-website push the held docs commit and add `nera build --check` to
   `.github/workflows/deploy.yml` (the step that runs `npm run build` today,
   decision 5).
   **Field test done 2026-10-09**, with `nera-validate --output` (validate at
   `f8324bd`) over three snapshots of `michael-becker-berlin.de`, each
   exported with `git archive` into a scratch folder and built with the site's
   own `npm run build` (assets + `nera build`, its installed packages):
   - `d2b7b2a^` (before the accessibility fixes), defaults: five findings,
     each collapsed — `a11y-skip-link` (32 pages), `a11y-heading-skip` h1→h3
     (14 pages: the 2021 posts and the tag pages) and h2→h4 (the two Search
     Console posts), `a11y-nav-name` (6 pages), `a11y-h1` (the home page in
     both languages, the about-me stack's second `<h1>`). With the opt-ins:
     `a11y-reduced-motion` once (the stylesheet's `scroll-behavior: smooth`),
     `a11y-link-lang` on the language switch, and `a11y-target-blank` on 40
     distinct external links.
   - `dff457d^` (before the DDG update): the same plus `legal-outdated-law`
     ("cites the TMG"), on the imprint in both languages, collapsed into one.
   - `HEAD` (`ac73b2a`, the branch is `main`, not `master`): defaults and every
     opt-in give one finding, `a11y-nav-name` on the four legal pages. No
     `privacy-third-party`, no `privacy-storage`, and no `legal-outdated-law`
     although the published cookie-banner post mentions the TTDSG.

   Where the result differs from the acceptance criteria, and why:
   - The criteria list `a11y-h1` for "about-me stack, tag pages" (the wording
     of the fix commit). The tag pages have one `<h1>` and `<h3>` cards — the
     fix was `h3` → `h2` — so they are `a11y-heading-skip`, which reports them.
     Both fixes are found; only the rule differs.
   - `a11y-target-blank` is not one finding per template: the site's
     `config/link-attributes.yaml` made plugin-link-attributes put
     `target="_blank"` on every external link in the content, so there is no
     shared template element, and the message names each link (slice 2) — 40
     different links, 40 findings, 2 pages each where a post exists in two
     languages. Left as is: the rule is opt-in, and one config line behind
     many links is something the output cannot see.
   - The remaining `HEAD` finding is real: the imprint and privacy pages carry
     a table of contents, `<nav class="toc">`, without `aria-label`, next to
     the labelled footer nav "Rechtliches". The hand audit missed it. The fix
     belongs to the site (an `aria-label` on the toc nav), not to validate.

   No rule changed after the field test, so the ids and defaults released in
   1.2.0 are the ones tested.

## Decisions (2026-10-09)

The open questions of the first draft, settled with the maintainer:

1. **Command surface: a separate verb.** `nera check` for the output,
   `nera validate` stays sources-only, plus `nera build --check` for CI (see
   "CLI"). Rejected: `nera validate --output`, which blurred what "validate"
   means.
2. **Collapsing: from two pages.** Any identical finding (`rule` + `message`) on
   two or more files is reported once, with the count and example files.
   Rejected: a percentage threshold (harder to explain) and no collapsing.
3. **Language of parts: yes, opt-in.** `a11y-link-lang` checks the narrow,
   reliable case — `hreflang` without a matching `lang`. Detecting foreign-language
   text in general stays out of scope.
4. **Messages stay English; the platform translates.** Nera Pro maps the stable
   `rule` id to its own localized text. validate takes no locale, which keeps
   the package free of translation upkeep.
5. **`nera-website` runs `nera build --check` in CI, not in the pre-push hook.**
   The hook stays `nera validate` so pushing stays fast; the CI workflow builds
   anyway. Wire this up after the release (slice 4).
6. **The site's own host resolves like `plugin-canonical-links`** (settled
   during slice 3): `origin` in `config/app.yaml`, else `app_origin` in
   `config/canonical-links.yaml`; the host counts with and without `www.`.
   `nera-website` sets only the latter, so a validate-specific key would have
   duplicated a value sites already have. Without either, only relative URLs
   are the site's own, and every absolute resource URL is reported by host.
   Rejected: `app.yaml` only (nera-website would report itself) and a
   `privacy.origin` key in `config/validate.yaml`.
7. **The link-text heuristic stays German/English and stays silent
   elsewhere** (settled during slice 3). It applies to pages whose `<html lang>`
   has the primary subtag `de` or `en`, or no `lang`; a page in any other
   language is not checked by `legal-*-link` unless `legal.<kind>.<lang>` names
   its page, and its legal pages reach `legal-outdated-law` only the same way.
   Rejected: extending the word list (Spanish "Aviso legal", "Privacidad" on
   nera-website) — each added language is upkeep, and any language still
   missing would get false findings.

8. **Publishing order for slice 4: develop against the local validate, hold
   the pushes** (settled during slice 4). nera-cli pins
   `@nera-static/validate` `^1.0.0` and its CI runs `npm ci` against the
   lockfile, so `nera check` cannot pass there before validate ships
   `validateOutput`. nera-cli was developed with
   `npm install ../nera-validate --no-save` (no change to `package.json` or the
   lockfile), and its slice-4 commit sits on local `main`, unpushed, until
   validate 1.2.0 is released in slice 5; the range bump follows then, in its
   own commit. The nera-website docs commit is held the same way, so the live
   site never documents an unreleased command; if nera-website must push
   something else first, that commit moves to a branch. The validate side of
   slice 4 is self-contained and can be pushed before. Rejected: releasing
   validate 1.2.0 before the field test — rule ids are stable once released,
   and a change the field test forces would then be breaking.

## Open questions

None at the moment.

## Acceptance criteria

- `validateSite` output is byte-identical before and after this work for every
  existing test and for `nera-website`.
- A site without `config/validate.yaml` gets only warnings from the new rules;
  `nera check` exits 0 unless a rule is promoted to `error`.
- `validateOutput` on a missing or empty `public/` throws a message that says to
  build first.
- **Field test, `michael-becker-berlin.de`:**
  - Built from `d2b7b2a^` (before the accessibility fixes): reports at least
    `a11y-skip-link`, `a11y-nav-name`, `a11y-h1` (about-me stack, tag pages),
    `a11y-heading-skip` (the 2021 posts) and, if enabled, `a11y-target-blank`
    and `a11y-reduced-motion`, each collapsed to one finding per template.
  - Built from `dff457d^` (before the DDG update): reports `legal-outdated-law`
    on the imprint, in both languages.
  - Built from current `master`: no `privacy-third-party` findings (the site
    loads nothing from third parties; its external hosts are all plain links),
    no `legal-outdated-law` despite the TTDSG mention in the cookie-banner draft,
    and every remaining finding is either fixed or explained in this document.
- Every rule has a positive and a negative test.

## Later

- **`@nera-static/validate-browser`** (name open): an optional package running
  axe-core in Playwright over `public/`, mapping its violations onto the same
  result shape. That is where contrast, focus visibility and target size would
  go. Separate so the base validator stays light.
- Rules for PDFs linked from the site (accessible PDF), and for `<video>` without
  `<track kind=captions>` (WCAG 1.2.2).
