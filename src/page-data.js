import fssync from 'fs'
import path from 'path'
import YAML, { LineCounter, isMap, isScalar, isSeq } from 'yaml'
import { frontmatterKeyLine } from './frontmatter.js'
import { yamlParseMessage } from './config.js'

// Checks for the data files a page names with `page_data:`
// (@nera-static/plugin-page-data). The plugin only warns at build time, so a
// typo ships a page without its data and exit code 0. Its rules are mirrored
// here, not imported — the plugin is no dependency of the validator — from
// `nera-plugin-page-data/src/{config,load,lang}.js`: the same name check,
// `.yaml` tried before `.yml`, the same settings and fallbacks, the same test
// for a language map.

export const DEFAULT_DATA_FOLDER = 'data'
export const DEFAULT_FRONTMATTER_KEY = 'page_data'
export const EXTENSIONS = ['.yaml', '.yml']

const rel = (cwd, abs) => path.relative(cwd, abs).split(path.sep).join('/')

const isPlainObject = (value) =>
    value !== null && typeof value === 'object' && !Array.isArray(value)

// A plain object as YAML produces it — not a class instance such as a `Date`
// or a `Map` — as the plugin's `src/lang.js` tests it.
const isPlainData = (value) => {
    if (value === null || typeof value !== 'object') return false
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
}

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
    const lang = model.appConfig?.lang
    return {
        cwd,
        key: readFrontmatterKey(cwd, model.folders.config),
        dataFolder,
        folderLabel: rel(cwd, dataFolder) || '.',
        languages: siteLanguages(model.appConfig),
        fallback: isName(lang) ? lang.trim() : '',
        cache: new Map(),
    }
}

/**
 * The languages of a site: `app.lang` plus the keys of `app.translations`,
 * as the plugin's `siteLanguages` collects them.
 *
 * @param {object} [appConfig] the parsed `config/app.yaml`
 * @returns {Set<string>}
 */
export function siteLanguages(appConfig) {
    const languages = new Set()
    if (isName(appConfig?.lang)) languages.add(appConfig.lang.trim())
    if (isPlainData(appConfig?.translations)) {
        for (const key of Object.keys(appConfig.translations)) {
            if (isName(key)) languages.add(key.trim())
        }
    }
    return languages
}

/**
 * Whether a value is a language map: a non-empty plain object whose keys are
 * all languages of the site. Mirrors the plugin's `isLanguageMap`.
 *
 * @param {unknown} value
 * @param {Set<string>} languages
 * @returns {boolean}
 */
export function isLanguageMap(value, languages) {
    if (!isPlainData(value)) return false
    const keys = Object.keys(value)
    return keys.length > 0 && keys.every((key) => languages.has(key))
}

// `null` counts as missing: `de:` with no value is an untranslated field.
const hasValue = (map, language) =>
    Object.hasOwn(map, language) && map[language] !== null &&
    map[language] !== undefined

// The 1-based line of the node at `steps` (map keys and list indices) in a
// parsed document, or `null` when the path does not lead through plain maps
// and lists — an alias, a merge or a complex key — rather than a wrong line.
function lineAt(doc, lineCounter, steps) {
    let node = doc.contents
    for (const step of steps) {
        if (typeof step === 'number' && isSeq(node)) {
            node = node.items[step]
        } else if (typeof step === 'string' && isMap(node)) {
            node = node.items.find((pair) =>
                isScalar(pair.key) && String(pair.key.value) === step)?.value
        } else {
            return null
        }
    }
    if (!isMap(node) || !node.range) return null
    return lineCounter.linePos(node.range[0]).line
}

// What a page in `lang` shows where the first map lacking it stands.
function outcomeOf(map, lang, fallback) {
    if (lang === fallback) {
        return `pages in "${lang}" show nothing there, and so does every ` +
            'language that falls back to it'
    }
    if (fallback !== '' && hasValue(map, fallback)) {
        return `pages in "${lang}" show the "${fallback}" value instead`
    }
    return `pages in "${lang}" show nothing there (no ` +
        `${fallback === '' ? 'app.lang' : `"${fallback}" value`} to fall back to)`
}

/**
 * `page-data-language` for one parsed data file: every language map in it
 * (at any depth, in maps and lists) must carry a value for each language of
 * the site. One warning per field path and language, list indices collapsed
 * to `[]` as the plugin does (`themes[].audience`), at the line of the first
 * map lacking it. Runs only on sites with two or more languages.
 *
 * @param {ReturnType<typeof createPageDataContext>} context
 * @param {string} base the data file's base path (without extension)
 * @param {{ abs: string, value: unknown, text: string }} result
 * @param {Array<object>} findings
 */
export function collectLanguageFindings(context, base, result, findings) {
    const { languages, fallback } = context
    if (languages.size < 2) return
    const name = path.relative(context.dataFolder, base).split(path.sep).join('/')
    const file = rel(context.cwd, result.abs)
    const reported = new Set()
    let parsed = null
    const line = (steps) => {
        if (parsed === null) {
            const lineCounter = new LineCounter()
            const doc = YAML.parseDocument(result.text, { lineCounter })
            parsed = { doc, lineCounter }
        }
        return lineAt(parsed.doc, parsed.lineCounter, steps)
    }

    const walk = (node, at, steps) => {
        if (Array.isArray(node)) {
            node.forEach((item, i) => walk(item, `${at}[]`, [...steps, i]))
            return
        }
        if (!isPlainData(node)) return
        if (isLanguageMap(node, languages)) {
            for (const lang of languages) {
                if (hasValue(node, lang) || reported.has(`${at}\0${lang}`)) continue
                reported.add(`${at}\0${lang}`)
                findings.push({
                    file,
                    line: line(steps),
                    severity: 'warning',
                    rule: 'page-data-language',
                    message: `\`${at}\` has no "${lang}" value — ` +
                        `${outcomeOf(node, lang, fallback)}; add ` +
                        `\`${lang}: …\` to this map`,
                })
            }
            // A translation may hold language maps of its own.
            for (const [key, child] of Object.entries(node)) {
                walk(child, at, [...steps, key])
            }
            return
        }
        for (const [key, child] of Object.entries(node)) {
            walk(child, at === '' ? key : `${at}.${key}`, [...steps, key])
        }
    }

    walk(result.value, name, [])
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
            return { ok: true, abs, text, value: YAML.parse(text) }
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

// The cached result for a base path; the first read of a file reports what is
// wrong with it, every later page naming the file shares those findings.
function loadDataFile(context, base, findings) {
    if (context.cache.has(base)) return context.cache.get(base)
    const result = readDataFile(base)
    context.cache.set(base, result)
    const file = rel(context.cwd, result.abs)
    if (result.ok) {
        collectLanguageFindings(context, base, result, findings)
    } else if (result.reason === 'invalid-yaml') {
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
