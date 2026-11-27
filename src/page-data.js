import fssync from 'fs'
import path from 'path'
import YAML from 'yaml'
import { frontmatterKeyLine } from './frontmatter.js'
import { yamlParseMessage } from './config.js'

// Checks for the data files a page names with `page_data:`
// (@nera-static/plugin-page-data). The plugin only warns at build time, so a
// typo ships a page without its data and exit code 0. Its rules are mirrored
// here, not imported — the plugin is no dependency of the validator — from
// `nera-plugin-page-data/src/{config,load}.js`: the same name check, `.yaml`
// tried before `.yml`, the same settings and fallbacks.

export const DEFAULT_DATA_FOLDER = 'data'
export const DEFAULT_FRONTMATTER_KEY = 'page_data'
export const EXTENSIONS = ['.yaml', '.yml']

const rel = (cwd, abs) => path.relative(cwd, abs).split(path.sep).join('/')

const isPlainObject = (value) =>
    value !== null && typeof value === 'object' && !Array.isArray(value)

const isName = (value) => typeof value === 'string' && value.trim() !== ''

const show = (value) => JSON.stringify(value) ?? String(value)

// `frontmatterKeyLine` builds a RegExp from the key; a configured key is the
// author's text, so its special characters are escaped.
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// The plugin's `frontmatter_key` from `<config folder>/page-data.yaml`, or the
// default when the file is missing, does not parse or holds no usable key. An
// invalid value is no finding here: the plugin warns about it at build.
function readFrontmatterKey(cwd, configFolder) {
    const abs = path.resolve(cwd, configFolder, 'page-data.yaml')
    let config
    try {
        config = YAML.parse(fssync.readFileSync(abs, 'utf-8'))
    } catch {
        return DEFAULT_FRONTMATTER_KEY
    }
    const key = isPlainObject(config) ? config.frontmatter_key : undefined
    return isName(key) ? key.trim() : DEFAULT_FRONTMATTER_KEY
}

/**
 * Everything the page-data checks share in one `validateSite` run: the
 * frontmatter key, the absolute data folder (`folders.data` in
 * `config/app.yaml`, default `data`) and the cache that keeps each data file
 * read and parsed once, and its `page-data-invalid` finding reported once.
 *
 * @param {{ appConfig?: object, folders: { config: string } }} model
 * @param {string} cwd
 */
export function createPageDataContext(model, cwd) {
    const folder = model.appConfig?.folders?.data
    const dataFolder = path.resolve(
        cwd, isName(folder) ? folder.trim() : DEFAULT_DATA_FOLDER
    )
    return {
        cwd,
        key: readFrontmatterKey(cwd, model.folders.config),
        dataFolder,
        folderLabel: rel(cwd, dataFolder) || '.',
        cache: new Map(),
    }
}

/**
 * The base path (without extension) a name points to inside the data folder,
 * or `null` when the plugin refuses the name: absolute, with a `..` segment,
 * or resolving outside the folder or onto the folder itself. Mirrors
 * `resolveName` in the plugin's `src/load.js`; `name` is a non-empty string.
 *
 * @param {string} dataFolder absolute data folder
 * @param {string} name
 * @returns {string | null}
 */
export function resolveDataName(dataFolder, name) {
    const trimmed = name.trim()
    if (path.isAbsolute(trimmed) || path.win32.isAbsolute(trimmed)) return null
    if (trimmed.split(/[\\/]/).includes('..')) return null
    const base = path.resolve(dataFolder, trimmed)
    const relative = path.relative(dataFolder, base)
    const outside = relative === '..' || relative.startsWith(`..${path.sep}`)
    if (relative === '' || outside || path.isAbsolute(relative)) return null
    return base
}

// Read and parse the data file at `base` (`.yaml`, else `.yml`), as the
// plugin's loader does: a file that exists but cannot be read stops the
// search, it does not fall through to `.yml`. An empty or comment-only file
// parses to `null`, a valid empty data set.
function readDataFile(base) {
    for (const extension of EXTENSIONS) {
        const abs = base + extension
        let text
        try {
            text = fssync.readFileSync(abs, 'utf-8')
        } catch (err) {
            if (err.code === 'ENOENT') continue
            return { ok: false, reason: 'unreadable', abs, message: err.message }
        }
        try {
            return { ok: true, abs, value: YAML.parse(text) }
        } catch (err) {
            return {
                ok: false,
                reason: 'invalid-yaml',
                abs,
                message: err.message,
                line: err.linePos?.[0]?.line ?? null,
            }
        }
    }
    return { ok: false, reason: 'missing', abs: base + EXTENSIONS[0] }
}

// The cached result for a base path; the first failing read of a file reports
// it, every later page naming the file shares that one finding.
function loadDataFile(context, base, findings) {
    if (context.cache.has(base)) return context.cache.get(base)
    const result = readDataFile(base)
    context.cache.set(base, result)
    const file = rel(context.cwd, result.abs)
    if (result.reason === 'invalid-yaml') {
        findings.push({
            file,
            line: result.line,
            severity: 'error',
            rule: 'page-data-invalid',
            message: yamlParseMessage(
                `invalid YAML in a data file named in \`${context.key}\` ` +
                '(every page that names it builds without its data)',
                result.message
            ),
        })
    } else if (result.reason === 'unreadable') {
        findings.push({
            file,
            line: null,
            severity: 'error',
            rule: 'page-data-invalid',
            message: `data file named in \`${context.key}\` cannot be read ` +
                `(${String(result.message).split('\n')[0]}) — every page that ` +
                'names it builds without its data; make it a readable YAML file',
        })
    }
    return result
}

// The names a page's value asks for. A string is one name, a list is its
// entries; anything else is a `page-data-type` finding and asks for nothing.
function namesOf(value, page) {
    if (typeof value === 'string') return [value]
    if (Array.isArray(value)) return value
    page.report('page-data-type',
        `\`${page.key}\` must be a data file name or a list of names, got ` +
        `${show(value)} — write e.g. \`${page.key}: themes\` for ` +
        `${page.folder}/themes.yaml`)
    return []
}

/**
 * `page-data-type`, `page-data-missing` and `page-data-invalid` for one page:
 * its `page_data` value must be a name or a list of names, and each name must
 * point at a data file inside the data folder that parses. Findings on the
 * page anchor at the key's line; `page-data-invalid` points at the data file
 * and is reported once per file. A page without the key reads nothing.
 *
 * @param {object} meta the page's parsed frontmatter
 * @param {string} raw the page file's text
 * @param {string} file the page, site-relative
 * @param {ReturnType<typeof createPageDataContext>} context
 * @param {Array<object>} findings
 */
export function collectPageDataFindings(meta, raw, file, context, findings) {
    if (!isPlainObject(meta) || meta[context.key] === undefined) return
    const line = frontmatterKeyLine(raw, escapeRegExp(context.key))
    const page = {
        key: context.key,
        folder: context.folderLabel,
        report: (rule, message) => findings.push({
            file, line, severity: 'error', rule, message,
        }),
    }
    // A name listed twice is checked (and reported) once, as the plugin
    // loads it once.
    const done = new Set()

    for (const entry of namesOf(meta[context.key], page)) {
        if (!isName(entry)) {
            page.report('page-data-type',
                `\`${page.key}\` entry ${show(entry)} is not a data file ` +
                `name — write a name such as \`themes\` for ${page.folder}/` +
                'themes.yaml, or remove the entry')
            continue
        }
        const name = entry.trim()
        if (done.has(name)) continue
        done.add(name)

        const base = resolveDataName(context.dataFolder, name)
        if (base === null) {
            page.report('page-data-missing',
                `\`${page.key}\` names ${show(entry)}, which is outside the ` +
                `data folder ${page.folder}/ — the plugin refuses it and the ` +
                `page builds without it; use a name inside ${page.folder}/, ` +
                'without `..` or a leading `/`')
            continue
        }
        const result = loadDataFile(context, base, findings)
        if (result.reason === 'missing') {
            const shown = rel(context.cwd, result.abs)
            page.report('page-data-missing',
                `\`${page.key}\` names ${show(entry)}, but ${shown} does not ` +
                'exist (nor its `.yml`) — the page builds without that data; ' +
                `create ${shown} or fix the name`)
        }
    }
}
