import fssync from 'fs'
import path from 'path'
import YAML from 'yaml'
import { resolveSiteModel, resolveEntry } from '@nera-static/core'
import { extractFrontmatter, frontmatterKeyLine } from './src/frontmatter.js'
import { collectIncludeFindings } from './src/pug-refs.js'
import { formatResults, formatOutputResults, OUTPUT_NOTE } from './src/format.js'
import { walkFiles } from './src/walk.js'
import { validateOutput } from './src/output.js'
import {
    readValidateYaml,
    readIgnore,
    isIgnored,
    yamlParseMessage,
} from './src/config.js'

export { formatResults, formatOutputResults, OUTPUT_NOTE, validateOutput }

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

// Resolve a page's `layout` to an existing file through the layered chain.
// Null if unresolved. Unlike an include, an extensionless layout gets no `.pug`:
// the build hands resolveEntry's path straight to `pug.compileFile`, which
// fails on `pages/default` even when `pages/default.pug` exists.
function resolveLayout(layout, roots) {
    const entry = resolveEntry(layout, roots)
    return fssync.existsSync(entry) ? entry : null
}

// `layout-unresolved`: the files resolveLayout looked for, site-relative — the
// value under each view root (site views, then theme views) — and the fix: the
// missing `.pug` extension for an extensionless value, else the site's copy to
// create.
function layoutUnresolvedMessage(layout, model, cwd) {
    // A Set: a theme whose views are the site's own would list a path twice.
    const looked = [...new Set(model.roots.map((root) => path.join(root, layout)))]
    const shown = looked.map((abs) => rel(cwd, abs))
    const what = `layout "${layout}" not found in views${
        model.theme ? ' or theme' : ''
    } — looked for ${shown.join(', ')}`
    if (!path.extname(layout)) {
        const exists = looked.some((abs) => fssync.existsSync(`${abs}.pug`))
        return `${what}; add the extension, \`layout: ${layout}.pug\`, since ` +
            'the build does not append `.pug` to a layout' +
            (exists ? '' : `, and create ${shown[0]}.pug`)
    }
    const create = shown.length > 1 ? shown[0] : 'it'
    return `${what}; create ${create}, or fix \`layout\` to name an existing ` +
        'template'
}

// Where a site's templates live, for messages: `theme/views`, plus the theme's
// views folder when a theme is configured.
const viewsText = (model, cwd) =>
    model.roots.map((root) => rel(cwd, root)).join(' or ')

// The layout most pages use (the first one seen on a tie), as the example in
// `layout-missing`. Null when no page has a layout that resolves.
function mostUsed(counts) {
    let best = null
    for (const [layout, n] of counts) {
        if (best === null || n > counts.get(best)) best = layout
    }
    return best
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
 *     silently skip the page; `type: stack` pages of @nera-static/plugin-stacks
 *     are exempt, they have no layout on purpose)
 *   - the layout resolves through the theme-aware view chain (layout-unresolved)
 *   - every include/extends in the reachable pug graph resolves (include-unresolved)
 *   - no `nera new` starter template hides a theme file of the same name
 *     (theme-shadowed — a warning: the build uses the starter, not the theme)
 *
 * `ignore: { <rule-id>: [path, …] }` in config/validate.yaml silences a rule
 * on the listed files and folders — e.g. `layout-missing` on content fragments
 * another page includes, or on drafts.
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
            line: model.appConfigErrorLine ?? null,
            severity: 'error',
            rule: 'yaml-parse',
            message: yamlParseMessage(
                'config could not be parsed', model.appConfigError
            ),
        })
    }

    if (model.themeError) {
        findings.push({
            file: appYaml,
            line: null,
            severity: 'error',
            rule: 'theme-unresolved',
            // Core's text already reads `<what> — <what to do>` (core 4.18.1).
            message: model.themeError,
        })
    }

    collectShadowFindings(model, cwd, findings)

    const configFindings = []
    const { config, file } = readValidateYaml(
        cwd, model.folders.config, configFindings
    )

    const pagesDir = path.resolve(cwd, model.folders.pages)
    const visitedPug = new Set()
    // Layout values of the pages whose layout resolves, with their page count,
    // and the pages without one: their message names the most-used layout as
    // the example, so it is written once every page has been read.
    const layoutCounts = new Map()
    const noLayout = []

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
                    message: yamlParseMessage(
                        'frontmatter YAML', err.message, fm.startLine - 1
                    ),
                })
                continue
            }
        }

        if (!meta.layout) {
            // A plugin-stacks fragment is layout-less on purpose: the plugin
            // exposes it as `app.stacks` for other pages to embed.
            if (meta.type === 'stack') continue
            const finding = {
                file: rel(cwd, abs),
                line: null,
                severity: 'warning',
                rule: 'layout-missing',
                message: '',
            }
            findings.push(finding)
            noLayout.push(finding)
            continue
        }

        const entry = resolveLayout(meta.layout, model.roots)
        if (!entry) {
            findings.push({
                file: rel(cwd, abs),
                line: frontmatterKeyLine(raw, 'layout'),
                severity: 'error',
                rule: 'layout-unresolved',
                message: layoutUnresolvedMessage(String(meta.layout), model, cwd),
            })
            continue
        }

        const value = String(meta.layout)
        layoutCounts.set(value, (layoutCounts.get(value) ?? 0) + 1)

        collectIncludeFindings(entry, model.roots, cwd, visitedPug, findings)
    }

    const example = mostUsed(layoutCounts)
    for (const finding of noLayout) {
        finding.message =
            'page has no `layout` — the build skips it silently; add ' +
            (example ? `\`layout: ${example}\`` : 'a `layout:` key') +
            ` to its frontmatter (a template in ${viewsText(model, cwd)}), ` +
            'or, if it has none on purpose (a fragment or draft), add ' +
            `\`ignore: { layout-missing: [${finding.file}] }\` to ${file}`
    }

    const ignore = readIgnore(config, file, configFindings)
    return [
        ...configFindings,
        ...findings.filter((f) => !isIgnored(f, ignore)),
    ]
}
