import fssync from 'fs'
import path from 'path'
import YAML from 'yaml'
import { resolveSiteModel } from '@nera-static/core'
import { extractFrontmatter } from './frontmatter.js'
import { parseHtml } from './html.js'
import { OUTPUT_RULES, findLegalPages } from './output-rules.js'
import { walkFiles } from './walk.js'

const rel = (cwd, abs) => path.relative(cwd, abs).split(path.sep).join('/')

const LEVELS = ['error', 'warning', 'off']

// How many example files a collapsed finding names in its message.
const COLLAPSE_EXAMPLES = 3

// Report a value in config/validate.yaml that cannot be used. It is ignored and
// the run goes on, so a typo never hides the rest of the report.
const invalid = (file, message) => ({
    file,
    line: null,
    severity: 'warning',
    rule: 'config-invalid',
    message,
})

const isMapping = (v) => v != null && typeof v === 'object' && !Array.isArray(v)

// `legal.imprint` / `legal.privacy`: per language, the site path every page of
// that language must link to. Keys are lower-cased to match `<html lang>`.
function readLegalPaths(config, kind, file, findings) {
    const value = config.legal?.[kind]
    if (value == null) return {}
    if (!isMapping(value)) {
        findings.push(invalid(file,
            `legal.${kind} must map languages to paths, such as ` +
            '`de: /de/impressum.html`; ignoring it'))
        return {}
    }
    const paths = {}
    for (const [lang, sitePath] of Object.entries(value)) {
        if (typeof sitePath !== 'string' || !sitePath.startsWith('/')) {
            findings.push(invalid(file,
                `legal.${kind}.${lang} is "${sitePath}" — use a site path ` +
                'starting with `/`, such as /de/impressum.html; ignoring it'))
            continue
        }
        paths[lang.toLowerCase()] = sitePath
    }
    return paths
}

// `privacy.allowed_hosts`: host names the owner has accounted for, which
// privacy-third-party skips.
function readAllowedHosts(config, file, findings) {
    const value = config.privacy?.allowed_hosts
    if (value == null) return []
    if (!Array.isArray(value)) {
        findings.push(invalid(file,
            'privacy.allowed_hosts must be a list of host names; ignoring it'))
        return []
    }
    return value.filter((host) => {
        if (typeof host === 'string' && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host)) {
            return true
        }
        findings.push(invalid(file,
            `privacy.allowed_hosts has "${host}" — use a bare host name, ` +
            'such as cdn.example.org; ignoring it'))
        return false
    }).map((host) => host.toLowerCase())
}

// Read config/validate.yaml: rule levels over the rule defaults, the legal pages
// and the allowed third-party hosts. A missing file means the defaults. A
// broken file or an unusable value is reported as a finding and otherwise
// ignored.
function loadConfig(cwd, configFolder, findings) {
    const levels = Object.fromEntries(OUTPUT_RULES.map((r) => [r.id, r.level]))
    const defaults = { levels, legal: { imprint: {}, privacy: {} }, allowedHosts: [] }
    const abs = path.resolve(cwd, configFolder, 'validate.yaml')
    if (!fssync.existsSync(abs)) return defaults
    const file = rel(cwd, abs)

    let config
    try {
        config = YAML.parse(fssync.readFileSync(abs, 'utf-8')) || {}
    } catch (err) {
        findings.push({
            file,
            line: err.linePos?.[0]?.line ?? null,
            severity: 'error',
            rule: 'yaml-parse',
            message: `config could not be parsed: ${err.message.split('\n')[0]}`,
        })
        return defaults
    }

    for (const [id, level] of Object.entries(config.rules || {})) {
        if (!(id in levels)) continue // a rule from a later release, or a typo
        if (!LEVELS.includes(level)) {
            findings.push(invalid(file,
                `rule "${id}" has level "${level}" — use ` +
                `${LEVELS.join(', ')}; keeping "${levels[id]}"`))
            continue
        }
        levels[id] = level
    }

    if (config.legal != null && !isMapping(config.legal)) {
        findings.push(invalid(file,
            'legal must be a mapping with `imprint` and `privacy`; ignoring it'))
        config.legal = {}
    }
    if (config.privacy != null && !isMapping(config.privacy)) {
        findings.push(invalid(file,
            'privacy must be a mapping with `allowed_hosts`; ignoring it'))
        config.privacy = {}
    }

    return {
        levels,
        legal: {
            imprint: readLegalPaths(config, 'imprint', file, findings),
            privacy: readLegalPaths(config, 'privacy', file, findings),
        },
        allowedHosts: readAllowedHosts(config, file, findings),
    }
}

// The site's own host, resolved the way plugin-canonical-links resolves its
// origin: `origin` in config/app.yaml, else `app_origin` in
// config/canonical-links.yaml. Null when neither is set or parses — then only
// relative URLs count as the site's own.
function ownHost(cwd, model) {
    let origin = model.appConfig.origin
    if (!origin) {
        const abs = path.resolve(cwd, model.folders.config, 'canonical-links.yaml')
        try {
            origin = YAML.parse(fssync.readFileSync(abs, 'utf-8'))?.app_origin
        } catch {
            // missing or broken: that file is the plugin's to report
        }
    }
    try {
        return new URL(origin).hostname.toLowerCase() || null
    } catch {
        return null
    }
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
 * validateSite, but over `dir` (default `public/`) rather than the sources — its
 * HTML, and its CSS and JavaScript for the rules that read them — so it needs a
 * build first and throws when there is no HTML to read.
 *
 * Every rule is a hint and a warning by default; `config/validate.yaml`
 * (`rules: { <id>: error|warning|off }`) promotes or disables rules, names the
 * legal pages (`legal: { imprint|privacy: { <lang>: <path> } }`) and the
 * accounted-for third-party hosts (`privacy: { allowed_hosts: [...] }`), and a
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
    const config = loadConfig(cwd, model.folders.config, configFindings)
    const { levels } = config
    const activeRules = OUTPUT_RULES.filter((r) => levels[r.id] !== 'off')
    const htmlRules = activeRules.filter((r) => r.kind !== 'css')
    const pagesDir = path.resolve(cwd, model.folders.pages)

    // Parse every page first: some rules need the whole site (which pages are
    // the legal pages) before they can judge one page.
    const pages = htmlFiles.map((abs) => {
        const outRel = path.relative(outDir, abs)
        const sourceAbs = sourcePage(outRel, pagesDir)
        return {
            abs,
            source: sourceAbs ? rel(cwd, sourceAbs) : null,
            ignored: sourceAbs ? ignoredRules(sourceAbs) : [],
            url: `/${outRel.split(path.sep).join('/')}`,
            ...parseHtml(fssync.readFileSync(abs, 'utf-8')),
        }
    })

    const site = {
        ownHost: ownHost(cwd, model),
        allowedHosts: new Set(config.allowedHosts),
        legal: config.legal,
        legalPages: new Set(),
    }
    if (levels['legal-outdated-law'] !== 'off') {
        site.legalPages = findLegalPages(pages, site)
    }

    const findings = []
    for (const page of pages) {
        for (const rule of htmlRules) {
            if (page.ignored.includes(rule.id)) continue
            for (const hit of rule.check({ ...page, site })) {
                findings.push({
                    file: rel(cwd, page.abs),
                    line: hit.line,
                    severity: levels[rule.id],
                    rule: rule.id,
                    message: hit.message,
                    ...(page.source && { source: page.source }),
                })
            }
        }
    }

    // Stylesheets and scripts have no page behind them, so no `source` and no
    // `validate_ignore`: rules on them are set for the whole site in
    // config/validate.yaml only. A `kind: 'css'` rule reads CSS alone; a page
    // rule may also read CSS (`checkCss`) or JavaScript (`checkJs`).
    const textPasses = [
        ['.css', (r) => (r.kind === 'css' ? r.check : r.checkCss)],
        ['.js', (r) => r.checkJs],
    ]
    for (const [ext, handler] of textPasses) {
        const rules = activeRules.filter(handler)
        const files = rules.length ? walkFiles(outDir, ext).sort() : []
        for (const abs of files) {
            const text = fssync.readFileSync(abs, 'utf-8')
            for (const rule of rules) {
                for (const hit of handler(rule)({ text, site })) {
                    findings.push({
                        file: rel(cwd, abs),
                        line: hit.line,
                        severity: levels[rule.id],
                        rule: rule.id,
                        message: hit.message,
                    })
                }
            }
        }
    }

    return [...configFindings, ...collapse(findings)]
}
