import fssync from 'fs'
import path from 'path'
import YAML from 'yaml'
import { resolveSiteModel, resolveEntry } from '@nera-static/core'
import { extractFrontmatter, frontmatterKeyLine } from './src/frontmatter.js'
import { collectIncludeFindings } from './src/pug-refs.js'
import { formatResults } from './src/format.js'
import { walkFiles } from './src/walk.js'
import { validateOutput } from './src/output.js'

export { formatResults, validateOutput }

const rel = (cwd, abs) => path.relative(cwd, abs).split(path.sep).join('/')

// Any finding of severity 'error' makes the site invalid (a warning does not).
export const hasErrors = (results) =>
    results.some((r) => r.severity === 'error')

// The marker `nera new` puts on the first line of its starter templates
// (`layouts/layout.pug`, `pages/default.pug`). It lets the validator tell an
// untouched starter file apart from a deliberate child-theme override.
export const SCAFFOLD_MARKER = 'nera:scaffold-default'

// Site views win over theme views, file by file — that is the child-theme
// contract. So a `nera new` starter file left in place hides the theme's file
// of the same name, and the theme looks as if it does nothing. Flag only files
// that still carry the scaffold marker: any other same-named file is a
// deliberate override and must stay silent.
function collectShadowFindings(model, cwd, findings) {
    if (!model.theme) return
    const siteViews = model.roots[0]
    for (const abs of walkFiles(siteViews, '.pug')) {
        const relPath = path.relative(siteViews, abs)
        if (!fssync.existsSync(path.join(model.theme.viewsRoot, relPath))) {
            continue
        }
        const lines = fssync.readFileSync(abs, 'utf-8').split('\n')
        const markerIndex = lines.findIndex((l) => l.includes(SCAFFOLD_MARKER))
        if (markerIndex === -1) continue
        const name = relPath.split(path.sep).join('/')
        findings.push({
            file: rel(cwd, abs),
            line: markerIndex + 1,
            severity: 'warning',
            rule: 'theme-shadowed',
            message:
                `the \`nera new\` starter file hides the theme's own ${name} — ` +
                'delete it to use the theme\'s, or remove the ' +
                `\`${SCAFFOLD_MARKER}\` line to keep it on purpose`,
        })
    }
}

// Resolve a page's `layout` to an existing pug file through the layered chain,
// applying pug's `.pug` append for an extensionless value. Null if unresolved.
function resolveLayout(layout, roots) {
    const entry = resolveEntry(layout, roots)
    if (fssync.existsSync(entry)) return entry
    if (!path.extname(entry) && fssync.existsSync(`${entry}.pug`)) {
        return `${entry}.pug`
    }
    return null
}

/**
 * Validate a Nera site the way the build will see it. Pure and read-only — it
 * renders nothing and writes nothing. The Nera CLI (`nera validate`) and the
 * Nera Pro platform both call this, so "valid" means the same thing everywhere.
 *
 * Checks:
 *   - config/app.yaml parses (yaml-parse)
 *   - the configured theme resolves (theme-unresolved)
 *   - each page's frontmatter parses (yaml-parse)
 *   - each page declares `layout` (layout-missing — a warning: the build would
 *     silently skip the page)
 *   - the layout resolves through the theme-aware view chain (layout-unresolved)
 *   - every include/extends in the reachable pug graph resolves (include-unresolved)
 *   - no `nera new` starter template hides a theme file of the same name
 *     (theme-shadowed — a warning: the build uses the starter, not the theme)
 *
 * @returns {Array<{file:string, line:number|null, severity:'error'|'warning',
 *                  rule:string, message:string}>}
 */
export function validateSite({ cwd = process.cwd() } = {}) {
    const findings = []
    const model = resolveSiteModel({ cwd })

    // app.yaml lives under the config folder (which only comes from settings).
    const appYaml = `${model.folders.config.replace(/^\.\//, '')}/app.yaml`

    if (model.appConfigError) {
        findings.push({
            file: appYaml,
            line: null,
            severity: 'error',
            rule: 'yaml-parse',
            message: `config could not be parsed: ${model.appConfigError}`,
        })
    }

    if (model.themeError) {
        findings.push({
            file: appYaml,
            line: null,
            severity: 'error',
            rule: 'theme-unresolved',
            message: model.themeError,
        })
    }

    collectShadowFindings(model, cwd, findings)

    const pagesDir = path.resolve(cwd, model.folders.pages)
    const visitedPug = new Set()

    for (const abs of walkFiles(pagesDir, '.md')) {
        const raw = fssync.readFileSync(abs, 'utf-8')
        const fm = extractFrontmatter(raw)

        let meta = {}
        if (fm) {
            try {
                meta = YAML.parse(fm.text) || {}
            } catch (err) {
                const errLine = err.linePos?.[0]?.line ?? 1
                findings.push({
                    file: rel(cwd, abs),
                    line: fm.startLine + errLine - 1,
                    severity: 'error',
                    rule: 'yaml-parse',
                    message: `frontmatter YAML: ${err.message.split('\n')[0]}`,
                })
                continue
            }
        }

        if (!meta.layout) {
            findings.push({
                file: rel(cwd, abs),
                line: null,
                severity: 'warning',
                rule: 'layout-missing',
                message:
                    'page has no `layout` — the build skips it silently',
            })
            continue
        }

        const entry = resolveLayout(meta.layout, model.roots)
        if (!entry) {
            findings.push({
                file: rel(cwd, abs),
                line: frontmatterKeyLine(raw, 'layout'),
                severity: 'error',
                rule: 'layout-unresolved',
                message: `layout "${meta.layout}" not found in views${
                    model.theme ? ' or theme' : ''
                }`,
            })
            continue
        }

        collectIncludeFindings(entry, model.roots, cwd, visitedPug, findings)
    }

    return findings
}
