import fssync from 'fs'
import path from 'path'
import YAML from 'yaml'
import { resolveSiteModel } from '@nera-static/core'
import { extractFrontmatter } from './frontmatter.js'
import { parseHtml } from './html.js'
import { OUTPUT_RULES } from './output-rules.js'
import { walkFiles } from './walk.js'

const rel = (cwd, abs) => path.relative(cwd, abs).split(path.sep).join('/')

const LEVELS = ['error', 'warning', 'off']

// How many example files a collapsed finding names in its message.
const COLLAPSE_EXAMPLES = 3

// Read config/validate.yaml into a rule-id → level map over the rule defaults.
// A missing file means the defaults. A broken file or an unknown level is
// reported as a finding and otherwise ignored, so a typo never hides the run.
function loadRuleLevels(cwd, configFolder, findings) {
    const levels = Object.fromEntries(OUTPUT_RULES.map((r) => [r.id, r.level]))
    const abs = path.resolve(cwd, configFolder, 'validate.yaml')
    if (!fssync.existsSync(abs)) return levels

    let config
    try {
        config = YAML.parse(fssync.readFileSync(abs, 'utf-8')) || {}
    } catch (err) {
        findings.push({
            file: rel(cwd, abs),
            line: err.linePos?.[0]?.line ?? null,
            severity: 'error',
            rule: 'yaml-parse',
            message: `config could not be parsed: ${err.message.split('\n')[0]}`,
        })
        return levels
    }

    for (const [id, level] of Object.entries(config.rules || {})) {
        if (!(id in levels)) continue // a rule from a later release, or a typo
        if (!LEVELS.includes(level)) {
            findings.push({
                file: rel(cwd, abs),
                line: null,
                severity: 'warning',
                rule: 'config-invalid',
                message:
                    `rule "${id}" has level "${level}" — use ` +
                    `${LEVELS.join(', ')}; keeping "${levels[id]}"`,
            })
            continue
        }
        levels[id] = level
    }
    return levels
}

// The source page of an output file — the inverse of core's `meta.href`
// derivation (`pages/de/x.md` → `public/de/x.html`). Null for output with no
// page behind it, such as plugin-generated tag pages.
function sourcePage(outRel, pagesDir) {
    const abs = path.join(pagesDir, outRel.replace(/\.html$/, '.md'))
    return fssync.existsSync(abs) ? abs : null
}

// The rule ids a page silences via `validate_ignore` in its frontmatter (a list
// or a single id). Unparsable frontmatter is validateSite's to report.
function ignoredRules(sourceAbs) {
    const fm = extractFrontmatter(fssync.readFileSync(sourceAbs, 'utf-8'))
    if (!fm) return []
    try {
        const ignore = (YAML.parse(fm.text) || {}).validate_ignore
        return [].concat(ignore ?? []).map(String)
    } catch {
        return []
    }
}

// A problem in a layout repeats on every page that uses it. Report identical
// findings (same rule, severity and message) on two or more files once,
// anchored at the first, with every occurrence under `files`. Repeats within a
// single file stay separate: they are distinct spots on one page.
function collapse(findings) {
    const groups = new Map()
    for (const f of findings) {
        const key = `${f.rule}\0${f.severity}\0${f.message}`
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key).push(f)
    }

    return [...groups.values()].flatMap((group) => {
        const files = [...new Set(group.map((f) => f.file))]
        if (files.length < 2) return group
        const [first] = group
        const examples = files.slice(0, COLLAPSE_EXAMPLES)
        const more = files.length > COLLAPSE_EXAMPLES ? ', …' : ''
        return {
            file: first.file,
            line: first.line,
            severity: first.severity,
            rule: first.rule,
            message:
                `${first.message} (on ${files.length} pages, e.g. ` +
                `${examples.join(', ')}${more})`,
            files: group.map(({ file, line, source }) =>
                source ? { file, line, source } : { file, line }
            ),
        }
    })
}

/**
 * Check a site's BUILT output for accessibility, privacy and legal-notice
 * problems a parser can decide (ROADMAP-compliance.md). Read-only, like
 * validateSite, but over `dir` (default `public/`) rather than the sources — so
 * it needs a build first and throws when there is no HTML to read.
 *
 * Every rule is a hint and a warning by default; `config/validate.yaml`
 * (`rules: { <id>: error|warning|off }`) promotes or disables rules, and a
 * page's frontmatter `validate_ignore: [<id>, …]` silences rules for its output
 * file. Results share validateSite's shape, plus `source` (the page behind the
 * output file, when there is one) and, on a collapsed finding, `files`.
 *
 * @returns {Array<{file:string, line:number|null, severity:'error'|'warning',
 *                  rule:string, message:string, source?:string,
 *                  files?:Array<{file:string, line:number|null, source?:string}>}>}
 */
export function validateOutput({ cwd = process.cwd(), dir = 'public' } = {}) {
    const outDir = path.resolve(cwd, dir)
    const htmlFiles = walkFiles(outDir, '.html').sort()
    if (htmlFiles.length === 0) {
        throw new Error(
            `no built HTML in ${rel(cwd, outDir) || '.'}/ — run \`nera build\` first`
        )
    }

    const configFindings = []
    const model = resolveSiteModel({ cwd })
    const levels = loadRuleLevels(cwd, model.folders.config, configFindings)
    const activeRules = OUTPUT_RULES.filter((r) => levels[r.id] !== 'off')
    const pagesDir = path.resolve(cwd, model.folders.pages)

    const findings = []
    for (const abs of htmlFiles) {
        const outRel = path.relative(outDir, abs)
        const sourceAbs = sourcePage(outRel, pagesDir)
        const source = sourceAbs ? rel(cwd, sourceAbs) : null
        const ignored = sourceAbs ? ignoredRules(sourceAbs) : []
        const page = parseHtml(fssync.readFileSync(abs, 'utf-8'))

        for (const rule of activeRules) {
            if (ignored.includes(rule.id)) continue
            for (const hit of rule.check(page)) {
                findings.push({
                    file: rel(cwd, abs),
                    line: hit.line,
                    severity: levels[rule.id],
                    rule: rule.id,
                    message: hit.message,
                    ...(source && { source }),
                })
            }
        }
    }

    return [...configFindings, ...collapse(findings)]
}
