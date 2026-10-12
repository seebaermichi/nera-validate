import fssync from 'fs'
import path from 'path'
import YAML from 'yaml'

const rel = (cwd, abs) => path.relative(cwd, abs).split(path.sep).join('/')

// Report a value in config/validate.yaml that cannot be used. It is ignored and
// the run goes on, so a typo never hides the rest of the report.
export const invalid = (file, message) => ({
    file,
    line: null,
    severity: 'warning',
    rule: 'config-invalid',
    message,
})

export const isMapping = (v) =>
    v != null && typeof v === 'object' && !Array.isArray(v)

// A `yaml-parse` message: what the parser says and how to fix it. Only the
// parser's first line is kept (the rest is a code frame), without its trailing
// `:`. `lineOffset` moves the parser's `at line N` to the file line when the
// YAML does not start the file (frontmatter). The parser names the spot, rarely
// the cause, so the fix names the usual causes.
export function yamlParseMessage(prefix, errorText, lineOffset = 0) {
    const first = String(errorText).split('\n')[0]
        .replace(/:\s*$/, '')
        .replace(/\bat line (\d+)/, (_, n) => `at line ${Number(n) + lineOffset}`)
    return `${prefix}: ${first} — fix the YAML at that line: quote a value ` +
        'that contains `: ` or ` #` or starts with `[`, `{`, `*`, `&` or `@`, ' +
        'and close any open bracket or quote'
}

// Read config/validate.yaml, shared by validateSite and validateOutput. Returns
// `{ config, file }` — `config` is `{}` when the file is missing, and also when
// it does not parse, which is reported as a `yaml-parse` finding.
export function readValidateYaml(cwd, configFolder, findings) {
    const abs = path.resolve(cwd, configFolder, 'validate.yaml')
    const file = rel(cwd, abs)
    if (!fssync.existsSync(abs)) return { config: {}, file }
    try {
        const config = YAML.parse(fssync.readFileSync(abs, 'utf-8')) || {}
        return { config: isMapping(config) ? config : {}, file }
    } catch (err) {
        findings.push({
            file,
            line: err.linePos?.[0]?.line ?? null,
            severity: 'error',
            rule: 'yaml-parse',
            message: yamlParseMessage('config could not be parsed', err.message),
        })
        return { config: {}, file }
    }
}

// `ignore: { <rule-id>: [path, …] }`: files a rule stays silent on, for rules
// of either pass. A path is relative to the site root, names a file or a folder
// (everything below it), and `*` stands for one whole path segment —
// `pages/*/references` covers every language. Returns a Map of rule id → split
// patterns.
export function readIgnore(config, file, findings) {
    const ignore = new Map()
    const value = config.ignore
    if (value == null) return ignore
    if (!isMapping(value)) {
        findings.push(invalid(file,
            'ignore must map rule ids to lists of paths — write it as ' +
            '`ignore: { layout-missing: [pages/drafts] }`; ignoring it'))
        return ignore
    }
    for (const [id, paths] of Object.entries(value)) {
        if (!Array.isArray(paths)) {
            findings.push(invalid(file,
                `ignore.${id} must be a list of paths — write it as ` +
                `\`${id}: [pages/drafts]\`; ignoring it`))
            continue
        }
        const patterns = []
        for (const p of paths) {
            const usable = typeof p === 'string' && p.trim() !== '' &&
                !p.startsWith('/') && !p.split('/').includes('..')
            if (!usable) {
                findings.push(invalid(file,
                    `ignore.${id} has "${p}" — use a path relative to the ` +
                    'site root, such as pages/drafts; ignoring it'))
                continue
            }
            patterns.push(p.replace(/^\.\//, '').split('/').filter(Boolean))
        }
        if (patterns.length) ignore.set(id, patterns)
    }
    return ignore
}

// Whether a finding's file is covered by an `ignore` pattern for its rule: the
// pattern matches the file itself or a folder above it, segment by segment.
export function isIgnored(finding, ignore) {
    const patterns = ignore.get(finding.rule)
    if (!patterns || !finding.file) return false
    const segments = finding.file.split('/')
    return patterns.some((pattern) =>
        pattern.length <= segments.length &&
        pattern.every((seg, i) => seg === '*' || seg === segments[i]))
}
