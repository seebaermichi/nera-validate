# @nera-static/validate

Validate a [Nera](https://github.com/seebaermichi/nera) site **the way the build
sees it** — before you publish, and before Nera silently drops a page.

📖 **Documentation:** [nera.js.org](https://nera.js.org)

Nera fails quietly by design: a page missing `layout` is skipped with no message,
an unresolved `include` surfaces late, malformed YAML is easy to miss. This
package surfaces those up front, and it resolves layouts and includes through the
**same layered theme/view resolver the generator uses** (imported from
`@nera-static/core`), so "valid here" means "will build there."

## CLI

```bash
npx @nera-static/validate     # or `nera validate` via the Nera CLI
```

Exits `1` if there are any errors (warnings alone do not fail), so it works as a
pre-publish or CI gate.

```bash
npx @nera-static/validate --output   # or `nera check`: the built public/ instead
```

`--output` runs the second pass, over the **built** site (see
[Checking the built output](#checking-the-built-output)). Build first; without a
`public/` folder it stops with "run `nera build` first". Same exit code: `1`
only when a finding has the level `error`.

## Library

```js
import { validateSite, hasErrors } from '@nera-static/validate'

const results = validateSite({ cwd: process.cwd() })
if (hasErrors(results)) process.exit(1)
```

`validateSite` is pure and read-only — it renders nothing and writes nothing. The
Nera CLI (`nera validate`) and the Nera Pro platform both call it, so they agree
on what "valid" means.

### Result shape

```js
{ file: 'pages/index.md', line: 2, severity: 'error', rule: 'layout-unresolved',
  message: 'layout "pages/missing.pug" not found in views or theme' }
```

`severity` is `'error'` or `'warning'`; `line` is 1-based or `null`.

### Checks

| rule | severity | meaning |
|---|---|---|
| `yaml-parse` | error | `config/app.yaml` or a page's frontmatter does not parse |
| `theme-unresolved` | error | a configured `theme:` cannot be resolved |
| `layout-missing` | warning | a page has no `layout` — the build would skip it |
| `layout-unresolved` | error | the `layout` does not resolve in the view/theme chain |
| `include-unresolved` | error | an `include`/`extends` in the pug graph does not resolve |
| `theme-shadowed` | warning | a `nera new` starter template hides the configured theme's file of the same name |

**`theme-shadowed`.** A site's own views win over its theme's, file by file —
that is how you override one theme template. But `nera new` scaffolds
`theme/views/layouts/layout.pug` and `theme/views/pages/default.pug`, the same
names a theme uses, so after installing a theme those starter files keep
hiding it and the build looks unthemed. The check fires only for files that
still carry the `//- nera:scaffold-default` line `nera new` writes into them;
any other same-named file is a deliberate override and is left alone. Delete
the starter file to use the theme's, or remove the marker line to keep it.
Sites scaffolded before `@nera-static/nera` 1.1.0 have no marker and are not
checked.

### Ignoring paths

Some Markdown files have no `layout` on purpose — content fragments another
page pulls in, drafts — and `layout-missing` would warn about each of them on
every run. List them under `ignore` in `config/validate.yaml`:

```yaml
ignore:
  layout-missing:
    - pages/*/references        # a folder: everything below it
    - pages/de/blog/drafts
    - pages/en/notes.md         # a single file
```

Paths are relative to the site root; `*` stands for one whole folder name
(`pages/*/references` covers every language), and a folder covers everything
below it. `ignore` works for any rule id, in this pass and in
`validateOutput` (paths under `public/` there). A path starting with `/` or
containing `..`, or a value that is not a list, is reported as
`config-invalid` and ignored; a `validate.yaml` that does not parse is a
`yaml-parse` error.

## Checking the built output

```js
import { validateOutput, hasErrors, formatOutputResults } from '@nera-static/validate'

const results = validateOutput({ cwd: process.cwd() })   // reads public/
console.log(formatOutputResults(results))
```

`validateSite` reads the sources; `validateOutput({ cwd, dir = 'public' })`
reads what the build produced — the HTML, CSS and JavaScript in `public/` — and
looks for accessibility, privacy and legal-notice problems a parser can decide.
Plugin hooks never see the finished page (the layout's `<html lang>`, navigation,
footer, loaded scripts and fonts), which is why this lives here and not in a
plugin. It is read-only and throws "run `nera build` first" when the folder is
missing or holds no HTML.

**These are hints, not legal advice.** A message names what was found ("loads
fonts.googleapis.com — a third-party request that sends the visitor's IP
address"), never a verdict. Automated checks find only part of the
accessibility problems — about a third of WCAG failures is the usual estimate;
contrast, visible focus, target size and reflow need a real browser and are not
checked. A clean run is not proof of compliance, which is why
`formatOutputResults` (and `nera check`) end every report with that reminder.
Whether a law applies to a site, and whether its legal texts are correct, is
not something a validator can tell.

Results have the same shape as `validateSite`'s, plus:

- `source` — the page behind an output file (`public/de/impressum.html` ←
  `pages/de/impressum.md`), when there is one. Tag pages and other
  plugin-generated output, CSS and JavaScript have none.
- `files` — on a collapsed finding. A problem in a layout repeats on every page;
  an identical finding (same rule and message) on two or more files is reported
  once, at the first file, with "(on N pages, e.g. …)" in the message and every
  occurrence listed under `files`.

Every rule is a **warning** by default, so `nera check` exits `0` until you
promote a rule to `error`. Opt-in rules are `off` until you enable them. Rule ids
are stable.

### Accessibility — WCAG 2.2 AA where machine-decidable

| rule | finds | WCAG | default |
|---|---|---|---|
| `a11y-html-lang` | `<html>` without a non-empty `lang` | 3.1.1 | warning |
| `a11y-title` | missing or empty `<title>` | 2.4.2 | warning |
| `a11y-h1` | not exactly one `<h1>` | 1.3.1 (best practice) | warning |
| `a11y-heading-skip` | a heading level jump down (`h2` → `h4`) | 1.3.1 | warning |
| `a11y-img-alt` | `<img>` without `alt` (`alt=""` is fine: decorative) | 1.1.1 | warning |
| `a11y-form-label` | a form field with no label, `aria-label` or `aria-labelledby` | 1.3.1, 4.1.2 | warning |
| `a11y-link-name` | a link with no text, label or `img[alt]` inside | 2.4.4, 4.1.2 | warning |
| `a11y-main` | no `<main>`, or more than one | 1.3.1 | warning |
| `a11y-skip-link` | the first focusable element is not a same-page link to an existing `id` | 2.4.1 | warning |
| `a11y-nav-name` | more than one `<nav>`, and one is unnamed | 1.3.1 | warning |
| `a11y-duplicate-id` | an `id` used twice in one page | 4.1.2 | warning |
| `a11y-viewport-zoom` | a viewport that blocks zoom (`user-scalable=no`, `maximum-scale` < 2) | 1.4.4 | warning |
| `a11y-link-lang` | a link with `hreflang` but no matching `lang` (the language switch) | 3.1.2 | opt-in |
| `a11y-target-blank` | `target="_blank"` links | 3.2.5 (AAA) | opt-in |
| `a11y-reduced-motion` | CSS with `scroll-behavior: smooth` or `animation` but no `prefers-reduced-motion` query | 2.3.3 (AAA) | opt-in |

### Privacy — DSGVO, TDDDG

| rule | finds | law | default |
|---|---|---|---|
| `privacy-third-party` | a resource (script, stylesheet, font, image, iframe, media, CSS `url()`/`@import`) loaded from another host than the site's own — the host receives the visitor's IP address. Specific messages for Google Fonts, YouTube, Vimeo, Google Analytics / Tag Manager and maps. Plain links are not resources. | Art. 6 DSGVO | warning |
| `privacy-insecure` | an `http://` resource or form action | Art. 32 DSGVO | warning |
| `privacy-storage` | a site-owned script touching `document.cookie`, `localStorage`, `sessionStorage` or `indexedDB` — confirm it is strictly necessary | § 25 TDDDG | opt-in |

### Legal notice — DDG, MStV

| rule | finds | law | default |
|---|---|---|---|
| `legal-imprint-link` | a page with no link to the imprint | § 5 DDG | warning |
| `legal-privacy-link` | a page with no link to the privacy policy | Art. 13 DSGVO | warning |
| `legal-outdated-law` | the imprint or privacy page cites a superseded law: TMG (→ DDG), TTDSG (→ TDDDG), § 55 RStV (→ § 18 MStV) | DDG, TDDDG, MStV | warning |

`legal-outdated-law` reads the legal pages only, never the whole site — a blog
post may mention the TTDSG on purpose.

### Configuration: `config/validate.yaml`

Optional; a missing file means the defaults above.

```yaml
rules:
  a11y-img-alt: error        # promote: fails `nera check` and `nera build --check`
  a11y-target-blank: warning # enable an opt-in rule
  a11y-skip-link: off        # disable
legal:
  imprint:                   # per language, the page every page must link to
    de: /de/impressum.html
    en: /en/imprint.html
  privacy:
    de: /de/datenschutz.html
    en: /en/data-protection.html
privacy:
  allowed_hosts:             # third-party hosts you have accounted for
    - cdn.example.org
ignore:                      # rule id → paths it stays silent on
  a11y-h1: [public/tags]
```

`ignore` is described under [Ignoring paths](#ignoring-paths).

A level other than `error`, `warning` or `off`, a legal path not starting with
`/`, or a URL instead of a host name is reported as `config-invalid` and
ignored. Rule ids this version does not know are ignored silently.

To silence rules on one page, list them in its frontmatter:

```yaml
---
layout: pages/default.pug
validate_ignore: [a11y-h1]
---
```

`validate_ignore` applies to that page's output file. CSS and JavaScript files
have no page behind them; switch their rules in `config/validate.yaml`.

### The site's own host

`privacy-third-party` needs to know which host is yours. It reads `origin` from
`config/app.yaml`, else `app_origin` from `config/canonical-links.yaml` — the
same value `@nera-static/plugin-canonical-links` uses; the host counts with and
without `www.`. With neither set, only relative URLs are the site's own, and
every absolute resource URL is reported by its host.

### Finding the legal pages: German and English only

Without `legal.*` config, `legal-imprint-link` and `legal-privacy-link` look for
a link whose text (or `aria-label`) contains *Impressum*, *Imprint* or *Legal
notice*, and *Datenschutz*, *Privacy* or *Data protection*. That heuristic runs
only on pages whose `<html lang>` is German or English (or missing). Pages in any
other language are checked only when `legal.imprint.<lang>` /
`legal.privacy.<lang>` names their page — set it for a Spanish *Aviso legal*,
for example. The same pages are what `legal-outdated-law` reads.

## Requirements

Node.js >= 20.

## License

MIT
