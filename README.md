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

## Requirements

Node.js >= 20.

## License

MIT
