import fssync from 'fs'
import path from 'path'
import YAML from 'yaml'
import { resolveSiteModel, resolveEntry } from '@nera-static/core'
import { extractFrontmatter, frontmatterKeyLine } from './src/frontmatter.js'
import { collectIncludeFindings } from './src/pug-refs.js'
import { formatResults } from './src/format.js'

export { formatResults }

const rel = (cwd, abs) => path.relative(cwd, abs).split(path.sep).join('/')

// Any finding of severity 'error' makes the site invalid (a warning does not).
export const hasErrors = (results) =>
    results.some((r) => r.severity === 'error')

// Recursively collect `.md` page files under a directory (absolute paths).
function walkPages(dir) {
    const out = []
    let entries
    try {
        entries = fssync.readdirSync(dir, { withFileTypes: true })
    } catch {
        return out
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) out.push(...walkPages(full))
        else if (entry.name.endsWith('.md')) out.push(full)
    }
    return out
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

    const pagesDir = path.resolve(cwd, model.folders.pages)
    const visitedPug = new Set()

    for (const abs of walkPages(pagesDir)) {
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
