import { findAll, findOne, textContent } from 'domutils'

const all = (document, test) => findAll(test, document.children)
const named = (...names) => (el) => names.includes(el.name)
const attr = (el, name) => el.attribs[name]?.trim() || ''

// `<body>`, else the document's first element: where a finding about something
// the page lacks is anchored.
const bodyOf = (document) =>
    findOne(named('body'), document.children) ??
    document.children.find((n) => n.type === 'tag') ??
    null

// A short, page-independent description of an element for messages, so the
// same template element reads the same on every page and collapses.
function describe(el, keys) {
    const shown = keys
        .filter((k) => attr(el, k))
        .map((k) => `${k}="${attr(el, k)}"`)
    return `\`<${[el.name, ...shown].join(' ')}>\``
}

function closest(el, test) {
    for (let node = el.parent; node; node = node.parent) {
        if (node.type === 'tag' && test(node)) return node
    }
    return null
}

// Elements a keyboard user tabs to, in document order (approximate: no
// `contenteditable`, and `display: none` cannot be seen without styles).
function isFocusable(el) {
    if ('disabled' in el.attribs) return false
    const tabindex = el.attribs.tabindex
    if (tabindex != null && Number(tabindex) < 0) return false
    switch (el.name) {
    case 'a':
    case 'area':
        return 'href' in el.attribs
    case 'input':
        return attr(el, 'type').toLowerCase() !== 'hidden'
    case 'button':
    case 'select':
    case 'textarea':
    case 'iframe':
    case 'summary':
        return true
    case 'audio':
    case 'video':
        return 'controls' in el.attribs
    default:
        return tabindex != null
    }
}

// The primary subtag of a language tag (`de-AT` → `de`), for comparing a
// link's `hreflang` with the `lang` its text is in.
const primary = (tag) => tag.trim().toLowerCase().split('-')[0]

// Strip CSS comments without moving offsets, so line numbers stay true.
const blankComments = (css) =>
    css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))

const lineAt = (text, offset) => text.slice(0, offset).split('\n').length

// ── Privacy and legal helpers ───────────────────────────────────────────────

// The host a URL loads from, lower-cased, or null for a relative URL (always
// the site's own) and for non-network schemes (`data:`, `blob:`, …).
function hostOf(url) {
    if (!/^\s*(?:https?:)?\/\//i.test(url)) return null
    try {
        return new URL(url.trim(), 'https://nera.invalid/').hostname.toLowerCase()
    } catch {
        return null
    }
}

const bare = (host) => host.replace(/^www\./, '')

// The site's own host counts with and without a leading `www.`.
const isOwnHost = (host, site) =>
    Boolean(site.ownHost) && bare(host) === bare(site.ownHost)

const isThirdParty = (host, site) =>
    Boolean(host) && !isOwnHost(host, site) && !site.allowedHosts.has(host)

// Elements whose URL attributes make the browser fetch something on load, and
// the `<link rel>` tokens that do. A plain `<a href>` is not a resource.
const RESOURCE_ATTRS = {
    script: ['src'],
    link: ['href'],
    img: ['src', 'srcset'],
    iframe: ['src'],
    video: ['src', 'poster'],
    audio: ['src'],
    source: ['src', 'srcset'],
    track: ['src'],
    embed: ['src'],
    object: ['data'],
}
const RESOURCE_RELS = ['stylesheet', 'preload', 'icon', 'modulepreload']

// The MIME type essences a browser runs a `<script>` as JavaScript for (HTML
// spec, "JavaScript MIME type"), plus `module`.
const JS_TYPES = new Set([
    'module',
    'application/ecmascript', 'application/javascript',
    'application/x-ecmascript', 'application/x-javascript',
    'text/ecmascript', 'text/javascript', 'text/javascript1.0',
    'text/javascript1.1', 'text/javascript1.2', 'text/javascript1.3',
    'text/javascript1.4', 'text/javascript1.5', 'text/jscript',
    'text/livescript', 'text/x-ecmascript', 'text/x-javascript',
])

// Whether the browser runs a `<script>` as JavaScript, by the HTML spec's
// rules: a missing or empty `type` means JavaScript (unless a legacy
// `language` says otherwise), matching ignores case and surrounding
// whitespace, and a type with parameters is not run. Any other type — JSON-LD,
// an import map, a template, plugin-consent's gated `text/plain` — is inert,
// so its `src` is never fetched.
function isJsType(el) {
    const type = attr(el, 'type').toLowerCase()
    if (type) return JS_TYPES.has(type)
    const language = attr(el, 'language').toLowerCase()
    return 'type' in el.attribs || !language || JS_TYPES.has(`text/${language}`)
}

// Every `{ el, name, url }` a page loads, in document order. An inert
// `<script>` loads nothing, and `data-src`/`data-consent-*` are never URLs.
function resources(document) {
    return all(document, (el) => {
        if (!(el.name in RESOURCE_ATTRS)) return false
        if (el.name === 'script') return isJsType(el)
        if (el.name !== 'link') return true
        const rels = attr(el, 'rel').toLowerCase().split(/\s+/)
        return rels.some((r) => RESOURCE_RELS.includes(r))
    }).flatMap((el) => RESOURCE_ATTRS[el.name]
        .filter((name) => attr(el, name))
        .flatMap((name) => (name === 'srcset'
            ? attr(el, name).split(',').map((c) => c.trim().split(/\s+/)[0])
            : [attr(el, name)]
        ).map((url) => ({ el, name, url }))))
}

// Hosts whose request says more than "a third party": what it is, and what the
// owner can do about it.
const KNOWN_HOSTS = [
    {
        domains: ['fonts.googleapis.com', 'fonts.gstatic.com'],
        what: 'Google Fonts',
        note: 'consider self-hosting the fonts (cf. LG München I, 3 O 17493/20)',
    },
    {
        domains: ['youtube.com', 'youtube-nocookie.com', 'ytimg.com'],
        what: 'a YouTube embed',
        note: 'consider a click-to-load placeholder (Art. 6 DSGVO, § 25 TDDDG)',
    },
    {
        domains: ['vimeo.com', 'vimeocdn.com'],
        what: 'a Vimeo embed',
        note: 'consider a click-to-load placeholder (Art. 6 DSGVO, § 25 TDDDG)',
    },
    {
        domains: ['google-analytics.com', 'googletagmanager.com'],
        what: 'Google Analytics / Tag Manager',
        note: 'tracking that reads or stores data on the device needs consent ' +
            '(§ 25 TDDDG); load it only after the visitor agrees',
    },
    {
        domains: [
            'maps.googleapis.com', 'maps.google.com', 'maps.gstatic.com',
            'tile.openstreetmap.org', 'api.mapbox.com',
        ],
        what: 'a map',
        note: 'consider a click-to-load placeholder (Art. 6 DSGVO)',
    },
]

// How to silence privacy-third-party for a host on purpose.
const ALLOW_HOST =
    'list the host under `privacy.allowed_hosts` in config/validate.yaml once ' +
    'it is accounted for'

// Elements plugin-consent can hold back until the visitor agrees (its
// ROADMAP, "Markup contract"): `<source>`/`<track>` only inside gated media.
// `img`, `picture > source`, `link` and CSS are not gated by design.
const GATEABLE = ['script', 'iframe', 'embed', 'object', 'video', 'audio']
const isGateable = (el) => GATEABLE.includes(el.name) ||
    (['source', 'track'].includes(el.name) &&
        ['video', 'audio'].includes(el.parent?.name))

// How to hold a gateable element back until the visitor agrees.
const GATE =
    'gate the element with `data-consent` (the markup of ' +
    '@nera-static/plugin-consent)'

// `gateable`: the host's first use is an element that can be consent-gated.
function thirdPartyMessage(host, gateable) {
    const known = KNOWN_HOSTS.find((k) =>
        k.domains.some((d) => host === d || host.endsWith(`.${d}`)))
    if (known) {
        const gate = gateable ? `, e.g. ${GATE}` : ''
        return `loads ${known.what} from ${host} — a third-party request that ` +
            `sends the visitor's IP address; ${known.note}${gate}, or ${ALLOW_HOST}`
    }
    const gate = gateable ? `, ${GATE} so it loads only after the visitor agrees` : ''
    return `loads ${host} — a third-party request that sends the visitor's IP ` +
        `address; self-host the resource${gate}, or name the host in the ` +
        `privacy policy and ${ALLOW_HOST} (Art. 6 DSGVO)`
}

// One hit per third-party host — the host is what receives the IP address —
// at its first use. `uses` is `[{ url, line, gateable }]` in order.
function thirdPartyHits(uses, site) {
    const hits = new Map()
    for (const { url, line, gateable = false } of uses) {
        const host = hostOf(url)
        if (!isThirdParty(host, site) || hits.has(host)) continue
        hits.set(host, { line, message: thirdPartyMessage(host, gateable) })
    }
    return [...hits.values()]
}

// Device storage a script reaches for, by plain text match (no JS parser).
const STORAGE = [
    ['`document.cookie`', /\bdocument\.cookie\b/],
    ['`localStorage`', /\blocalStorage\b/],
    ['`sessionStorage`', /\bsessionStorage\b/],
    ['`indexedDB`', /\bindexedDB\b/],
]

// `{ uses, offset }` for a script's storage access, or null when it has none.
function storageUse(code) {
    const found = STORAGE
        .map(([what, re]) => ({ what, match: re.exec(code) }))
        .filter((f) => f.match)
    if (found.length === 0) return null
    return {
        uses: found.map((f) => f.what).join(', '),
        offset: Math.min(...found.map((f) => f.match.index)),
    }
}

const storageNote =
    'storing or reading data on the visitor\'s device needs consent unless ' +
    'it is strictly necessary; confirm that it is, or ask for consent ' +
    'before the script runs (§ 25 TDDDG)'

// An inline `<script>` that runs as JavaScript (not JSON-LD, an import map or
// a template).
const isInlineScript = (el) =>
    el.name === 'script' && !('src' in el.attribs) && isJsType(el)

// The words the link-text heuristic looks for, and the page languages it
// applies to. A page in another language is not guessed at: it is checked only
// when `legal.<kind>` in config/validate.yaml names its page.
const LEGAL = {
    imprint: {
        name: 'the imprint',
        words: ['Impressum', 'Imprint', 'Legal notice'],
        law: '§ 5 DDG',
    },
    privacy: {
        name: 'the privacy policy',
        words: ['Datenschutz', 'Privacy', 'Data protection'],
        law: 'Art. 13 DSGVO',
    },
}
const HEURISTIC_LANGS = ['de', 'en']

const htmlLang = (document) =>
    attr(findOne(named('html'), document.children) ?? { attribs: {} }, 'lang')
        .toLowerCase()

// A site path in one spelling for comparison: `/de/`, `/de/index.html` and
// `/de/index` are the same page, as are `/x.html`, `/x` and `/x/`.
const normalizePath = (p) =>
    p.replace(/\/index(?:\.html)?$/, '/').replace(/\.html$/, '').replace(/(.)\/$/, '$1')

// The normalized site path a link on the page at `url` points to, or null when
// it leaves the site (another host, `mailto:`, …).
function ownPath(href, url, site) {
    let target
    try {
        target = new URL(href, `https://nera.invalid${url}`)
    } catch {
        return null
    }
    if (!['http:', 'https:'].includes(target.protocol)) return null
    if (target.hostname !== 'nera.invalid' && !isOwnHost(target.hostname, site)) {
        return null
    }
    try {
        return normalizePath(decodeURI(target.pathname))
    } catch {
        return normalizePath(target.pathname)
    }
}

// The page's links to its imprint or privacy policy: `{ configured, links }`,
// where `configured` is the path from `legal.<kind>` for the page's language,
// if any. Null when the page cannot be checked — no config for its language
// and a language the link-text heuristic has no words for.
function legalLinks(kind, { document, url, site }) {
    const lang = htmlLang(document)
    const configured = site.legal[kind][lang] ?? site.legal[kind][primary(lang)]
    const links = all(document, (el) => el.name === 'a' && 'href' in el.attribs)
    if (configured) {
        const want = normalizePath(configured)
        return {
            configured,
            links: links.filter((a) => ownPath(attr(a, 'href'), url, site) === want),
        }
    }
    if (lang && !HEURISTIC_LANGS.includes(primary(lang))) return null
    const words = LEGAL[kind].words.map((w) => w.toLowerCase())
    return {
        configured: null,
        links: links.filter((a) => {
            const text = `${textContent(a)} ${attr(a, 'aria-label')}`
                .replace(/\s+/g, ' ').toLowerCase()
            return words.some((w) => text.includes(w))
        }),
    }
}

/**
 * The site paths of the imprint and privacy pages, for `legal-outdated-law`.
 * Per kind and language: the path from `legal.<kind>` when configured, else
 * the target the link-text heuristic finds on the most pages — the footer link,
 * not a blog post that happens to mention "Datenschutz".
 */
export function findLegalPages(pages, site) {
    const legalPages = new Set()
    const counts = new Map()
    for (const page of pages) {
        for (const kind of Object.keys(LEGAL)) {
            const found = legalLinks(kind, { ...page, site })
            if (!found) continue
            if (found.configured) {
                legalPages.add(normalizePath(found.configured))
                continue
            }
            const key = `${kind}\0${primary(htmlLang(page.document))}`
            if (!counts.has(key)) counts.set(key, new Map())
            const targets = new Set(found.links
                .map((a) => ownPath(attr(a, 'href'), page.url, site))
                .filter(Boolean))
            for (const t of targets) {
                counts.get(key).set(t, (counts.get(key).get(t) ?? 0) + 1)
            }
        }
    }
    for (const targets of counts.values()) {
        const most = Math.max(...targets.values())
        for (const [t, n] of targets) if (n === most) legalPages.add(t)
    }
    return legalPages
}

function legalLinkRule(kind) {
    const { name, words, law } = LEGAL[kind]
    return ({ document, url, site, lineOf }) => {
        const found = legalLinks(kind, { document, url, site })
        if (!found || found.links.length > 0) return []
        const missing = found.configured
            ? `page has no link to ${name} (\`${found.configured}\`)`
            : `page has no link whose text names ${name} (${words.join(', ')})`
        const otherName = found.configured
            ? ''
            : `, or, if it is linked under another name, set \`legal.${kind}\` ` +
              'in config/validate.yaml'
        return [{
            line: lineOf(bodyOf(document)),
            message:
                `${missing} — it should be easy to find and directly ` +
                'reachable from every page; link it from the layout, such as ' +
                `in the footer${otherName} (${law})`,
        }]
    }
}

// Superseded laws a legal page should no longer cite.
const OUTDATED_LAWS = [
    {
        re: /\bTMG\b|Telemediengesetz/,
        message:
            'cites the TMG (Telemediengesetz) — replaced by the DDG on ' +
            '2024-05-14; cite § 5 DDG for the imprint duty instead',
    },
    {
        re: /\bTTDSG\b|Telekommunikation-Telemedien-Datenschutz-Gesetz/,
        message:
            'cites the TTDSG — renamed TDDDG on 2024-05-14; cite the TDDDG ' +
            'instead (device storage is § 25 TDDDG)',
    },
    {
        re: /§\s*55\s*(?:Abs\.?\s*\d+\s*)?RStV/,
        message:
            'cites § 55 RStV — replaced by § 18 MStV on 2020-11-07; cite ' +
            '§ 18 MStV instead',
    },
]

// The page's visible text nodes, in order (script and style content excluded).
function* textNodes(node) {
    for (const child of node.children ?? []) {
        if (child.type === 'text') yield child
        else if (child.type === 'tag') yield* textNodes(child)
    }
}

// The rule catalogue for `validateOutput` (ROADMAP-compliance.md). Each rule
// gets one parsed page and returns `{ line, message }` hits; the caller adds
// file, source and the configured severity. Rule ids are stable once released —
// the platform keys on them — and `level` is the default when
// config/validate.yaml says nothing (`warning`, or `off` for opt-in rules).
// A page rule also gets `url` (the output file's site path) and `site` (own
// host, allowed hosts, legal config and legal pages). A rule with `kind: 'css'`
// gets each CSS file in the output instead, as `{ text, site }` — plain text,
// no CSS parser — and a page rule may read CSS or JavaScript files too, through
// `checkCss` / `checkJs`. Hits on those files carry no `source`.
export const OUTPUT_RULES = [
    {
        id: 'a11y-html-lang',
        level: 'warning',
        check({ document, lineOf }) {
            const html = findOne((el) => el.name === 'html', document.children)
            if (!html) {
                return [{
                    line: null,
                    message:
                        'page has no `<html>` element to carry a `lang` — ' +
                        'screen readers cannot tell its language; wrap the ' +
                        'layout in `<html lang="…">` (WCAG 3.1.1)',
                }]
            }
            if (html.attribs.lang?.trim()) return []
            return [{
                line: lineOf(html),
                message:
                    `\`<html>\` has ${'lang' in html.attribs ? 'an empty' : 'no'} ` +
                    '`lang` — screen readers cannot tell the page language; ' +
                    'set it in the layout, such as `<html lang="de">` ' +
                    '(WCAG 3.1.1)',
            }]
        },
    },

    {
        id: 'a11y-title',
        level: 'warning',
        check({ document, lineOf }) {
            const title = findOne(named('title'), document.children)
            if (title && textContent(title).trim()) return []
            return [{
                line: title
                    ? lineOf(title)
                    : lineOf(findOne(named('head'), document.children) ?? bodyOf(document)),
                message:
                    `page has ${title ? 'an empty' : 'no'} \`<title>\` — it names ` +
                    'the page in tabs, history and screen readers; give the ' +
                    'layout\'s `<head>` a `<title>` with the page title ' +
                    '(WCAG 2.4.2)',
            }]
        },
    },
    {
        id: 'a11y-h1',
        level: 'warning',
        check({ document, lineOf }) {
            const h1s = all(document, named('h1'))
            if (h1s.length === 1) return []
            if (h1s.length === 0) {
                return [{
                    line: lineOf(bodyOf(document)),
                    message:
                        'page has no `<h1>` — screen-reader users jump to it ' +
                        'to find the main heading; mark the main heading as ' +
                        '`<h1>` (WCAG 1.3.1, best practice)',
                }]
            }
            return [{
                line: lineOf(h1s[1]),
                message:
                    'page has more than one `<h1>` — one main heading per ' +
                    'page keeps its outline clear; keep one and make the ' +
                    'others `<h2>` (WCAG 1.3.1, best practice)',
            }]
        },
    },
    {
        id: 'a11y-heading-skip',
        level: 'warning',
        check({ document, lineOf }) {
            const headings = all(document, (el) => /^h[1-6]$/.test(el.name))
            const hits = []
            for (let i = 1; i < headings.length; i++) {
                const from = Number(headings[i - 1].name[1])
                const to = Number(headings[i].name[1])
                if (to <= from + 1) continue
                hits.push({
                    line: lineOf(headings[i]),
                    message:
                        `heading level jumps from \`<h${from}>\` to \`<h${to}>\` — ` +
                        'the outline suggests a missing section; use ' +
                        `\`<h${from + 1}>\` here, or add the missing level ` +
                        '(WCAG 1.3.1)',
                })
            }
            return hits
        },
    },
    {
        id: 'a11y-img-alt',
        level: 'warning',
        check({ document, lineOf }) {
            return all(document, (el) => el.name === 'img' && !('alt' in el.attribs))
                .map((img) => ({
                    line: lineOf(img),
                    message:
                        `${describe(img, ['src'])} has no \`alt\` — add a text ` +
                        'alternative, or `alt=""` if the image is decorative ' +
                        '(WCAG 1.1.1)',
                }))
        },
    },
    {
        id: 'a11y-form-label',
        level: 'warning',
        check({ document, lineOf }) {
            const labelled = new Set(
                all(document, named('label')).map((l) => attr(l, 'for')).filter(Boolean)
            )
            const exempt = ['hidden', 'submit', 'button', 'reset', 'image']
            return all(document, (el) =>
                ['input', 'select', 'textarea'].includes(el.name) &&
                !(el.name === 'input' && exempt.includes(attr(el, 'type').toLowerCase())) &&
                !attr(el, 'aria-label') &&
                !attr(el, 'aria-labelledby') &&
                !(attr(el, 'id') && labelled.has(attr(el, 'id'))) &&
                !closest(el, named('label'))
            ).map((field) => ({
                line: lineOf(field),
                message:
                    `${describe(field, ['type', 'name', 'id'])} has no label — ` +
                    'use `<label for>`, a wrapping `<label>`, `aria-label` or ' +
                    '`aria-labelledby` (WCAG 1.3.1, 4.1.2)',
            }))
        },
    },
    {
        id: 'a11y-link-name',
        level: 'warning',
        check({ document, lineOf }) {
            const hasName = (a) =>
                textContent(a).trim() ||
                attr(a, 'aria-label') ||
                attr(a, 'aria-labelledby') ||
                findOne((el) => el.name === 'img' && attr(el, 'alt'), a.children)
            return all(document, (el) => el.name === 'a' && 'href' in el.attribs && !hasName(el))
                .map((a) => ({
                    line: lineOf(a),
                    message:
                        `link ${describe(a, ['href'])} has no text, ` +
                        '`aria-label` or image `alt` — screen readers ' +
                        'announce it without a name; give it visible text ' +
                        'or an `aria-label` (WCAG 2.4.4, 4.1.2)',
                }))
        },
    },
    {
        id: 'a11y-main',
        level: 'warning',
        check({ document, lineOf }) {
            const mains = all(document, (el) =>
                el.name === 'main' || attr(el, 'role') === 'main'
            )
            if (mains.length === 1) return []
            if (mains.length === 0) {
                return [{
                    line: lineOf(bodyOf(document)),
                    message:
                        'page has no `<main>` — assistive technology uses it ' +
                        'to jump to the content; wrap the page content in ' +
                        'one `<main>` in the layout (WCAG 1.3.1)',
                }]
            }
            return [{
                line: lineOf(mains[1]),
                message:
                    'page has more than one `<main>` — there should be one ' +
                    'main landmark; keep one and make the others ' +
                    '`<section>` or `<div>` (WCAG 1.3.1)',
            }]
        },
    },
    {
        id: 'a11y-skip-link',
        level: 'warning',
        check({ document, lineOf }) {
            const first = findOne(isFocusable, document.children)
            if (!first) return [] // nothing to tab past
            const href = first.name === 'a' ? attr(first, 'href') : ''
            if (!href.startsWith('#') || href.length < 2) {
                return [{
                    line: lineOf(first),
                    message:
                        'the first focusable element is not a skip link — ' +
                        'keyboard users must tab through everything before ' +
                        'the content; start the layout\'s `<body>` with a ' +
                        'link such as `<a href="#main">Skip to content</a>` ' +
                        'to the `id` of its `<main>` (WCAG 2.4.1)',
                }]
            }
            let id
            try {
                id = decodeURIComponent(href.slice(1))
            } catch {
                id = href.slice(1)
            }
            if (findOne((el) => el.attribs.id === id, document.children)) return []
            return [{
                line: lineOf(first),
                message:
                    `the skip link points to \`${href}\`, but no element has ` +
                    `\`id="${id}"\` — it goes nowhere; add \`id="${id}"\` to ` +
                    'the main content, or fix the link (WCAG 2.4.1)',
            }]
        },
    },
    {
        id: 'a11y-nav-name',
        level: 'warning',
        check({ document, lineOf }) {
            const navs = all(document, named('nav'))
            if (navs.length < 2) return []
            return navs
                .filter((nav) => !attr(nav, 'aria-label') && !attr(nav, 'aria-labelledby'))
                .map((nav) => ({
                    line: lineOf(nav),
                    message:
                        'page has more than one `<nav>`, and this one has no ' +
                        '`aria-label` or `aria-labelledby` — screen readers ' +
                        'cannot tell them apart; give it one, such as ' +
                        '`aria-label="Main"` (WCAG 1.3.1)',
                }))
        },
    },
    {
        id: 'a11y-duplicate-id',
        level: 'warning',
        check({ document, lineOf }) {
            const seen = new Set()
            const reported = new Set()
            const hits = []
            for (const el of all(document, (e) => e.attribs.id)) {
                const id = el.attribs.id
                if (!seen.has(id)) {
                    seen.add(id)
                } else if (!reported.has(id)) {
                    reported.add(id)
                    hits.push({
                        line: lineOf(el),
                        message:
                            `\`id="${id}"\` is used more than once on the page — ` +
                            'labels, skip links and ARIA references may hit ' +
                            'the wrong element; make each `id` unique ' +
                            '(WCAG 4.1.2)',
                    })
                }
            }
            return hits
        },
    },
    {
        id: 'a11y-viewport-zoom',
        level: 'warning',
        check({ document, lineOf }) {
            const meta = findOne((el) =>
                el.name === 'meta' && attr(el, 'name').toLowerCase() === 'viewport',
            document.children)
            if (!meta) return []
            const settings = Object.fromEntries(
                attr(meta, 'content').split(/[,;]/).map((pair) => {
                    const [key, value = ''] = pair.split('=')
                    return [key.trim().toLowerCase(), value.trim().toLowerCase()]
                })
            )
            const blocked = []
            if (['no', '0', 'false'].includes(settings['user-scalable'])) {
                blocked.push(`user-scalable=${settings['user-scalable']}`)
            }
            const max = parseFloat(settings['maximum-scale'])
            if (max < 2) blocked.push(`maximum-scale=${settings['maximum-scale']}`)
            if (blocked.length === 0) return []
            return [{
                line: lineOf(meta),
                message:
                    `\`<meta name="viewport">\` sets ${blocked.map((b) => `\`${b}\``).join(' and ')} — ` +
                    'visitors cannot zoom the page to 200%; remove ' +
                    `${blocked.map((b) => `\`${b}\``).join(' and ')} from its ` +
                    '`content` (WCAG 1.4.4)',
            }]
        },
    },
    {
        id: 'a11y-link-lang',
        level: 'off',
        check({ document, lineOf }) {
            const matches = (hreflang) => (el) =>
                el.attribs.lang != null && primary(el.attribs.lang) === hreflang
            return all(document, (el) =>
                el.name === 'a' && attr(el, 'hreflang') &&
                attr(el, 'hreflang').toLowerCase() !== 'x-default'
            ).filter((a) => {
                const hreflang = primary(a.attribs.hreflang)
                // The language the link text is read in: its own `lang`, the
                // nearest ancestor's, or one set on an element inside it.
                const own = a.attribs.lang != null
                    ? a
                    : closest(a, (el) => el.attribs.lang != null)
                if (own && matches(hreflang)(own)) return false
                return !findOne(matches(hreflang), a.children)
            }).map((a) => ({
                line: lineOf(a),
                message:
                    `link ${describe(a, ['href'])} has \`hreflang="${attr(a, 'hreflang')}"\` ` +
                    'but no matching `lang` — screen readers read its text in ' +
                    `the page language; add \`lang="${attr(a, 'hreflang')}"\` ` +
                    'to the link (WCAG 3.1.2)',
            }))
        },
    },
    {
        id: 'a11y-target-blank',
        level: 'off',
        check({ document, lineOf }) {
            return all(document, (el) =>
                el.name === 'a' && attr(el, 'target').toLowerCase() === '_blank'
            ).map((a) => ({
                line: lineOf(a),
                message:
                    `link ${describe(a, ['href'])} opens a new window ` +
                    '(`target="_blank"`) — consider announcing it in the link ' +
                    'text, or dropping the target (WCAG 3.2.5)',
            }))
        },
    },
    {
        id: 'a11y-reduced-motion',
        level: 'off',
        kind: 'css',
        check({ text }) {
            const css = blankComments(text)
            if (/prefers-reduced-motion/i.test(css)) return []
            const motion = [
                ['`scroll-behavior: smooth`', /scroll-behavior\s*:\s*smooth/i],
                ['`animation`', /(?:^|[\s;{])animation(?:-name)?\s*:(?!\s*none\s*[;}!])/im],
            ].map(([what, re]) => ({ what, match: re.exec(css) })).filter((m) => m.match)
            if (motion.length === 0) return []
            const at = (m) => m.match.index + m.match[0].search(/[a-z]/i)
            return [{
                line: lineAt(css, Math.min(...motion.map(at))),
                message:
                    `stylesheet uses ${motion.map((m) => m.what).join(' and ')} ` +
                    'but has no `prefers-reduced-motion` query — visitors who ' +
                    'turned motion off still get it; turn the motion off ' +
                    'inside `@media (prefers-reduced-motion: reduce)` ' +
                    '(WCAG 2.3.3)',
            }]
        },
    },
    {
        id: 'privacy-third-party',
        level: 'warning',
        check({ document, lineOf, site }) {
            return thirdPartyHits(
                resources(document).map(({ el, url }) =>
                    ({ url, line: lineOf(el), gateable: isGateable(el) })),
                site
            )
        },
        checkCss({ text, site }) {
            const css = blankComments(text)
            const uses = []
            for (const re of [/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi, /@import\s+(['"])([^'"]+)\1/gi]) {
                for (const m of css.matchAll(re)) {
                    uses.push({ url: m[2], offset: m.index })
                }
            }
            uses.sort((a, b) => a.offset - b.offset)
            return thirdPartyHits(
                uses.map(({ url, offset }) => ({ url, line: lineAt(css, offset) })),
                site
            )
        },
    },
    {
        id: 'privacy-insecure',
        level: 'warning',
        check({ document, lineOf }) {
            const http = (url) => /^\s*http:\/\//i.test(url)
            const seen = new Set()
            const hits = resources(document)
                .filter(({ el, url }) => http(url) && !seen.has(el) && seen.add(el))
                .map(({ el, name }) => ({
                    line: lineOf(el),
                    message:
                        `${describe(el, [name])} loads over plain http — the ` +
                        'request can be read and altered on the way; use https ' +
                        '(Art. 32 DSGVO)',
                }))
            const forms = all(document, (el) => el.name === 'form' && http(attr(el, 'action')))
                .map((form) => ({
                    line: lineOf(form),
                    message:
                        `${describe(form, ['action'])} sends its data over plain ` +
                        'http — anyone on the way can read what visitors enter; ' +
                        'use https (Art. 32 DSGVO)',
                }))
            return [...hits, ...forms].sort((a, b) => a.line - b.line)
        },
    },
    {
        id: 'privacy-storage',
        level: 'off',
        check({ document, lineOf }) {
            return all(document, isInlineScript).flatMap((script) => {
                const code = textContent(script)
                const use = storageUse(code)
                if (!use) return []
                return [{
                    line: lineOf(script) + code.slice(0, use.offset).split('\n').length - 1,
                    message: `inline \`<script>\` uses ${use.uses} — ${storageNote}`,
                }]
            })
        },
        checkJs({ text }) {
            const use = storageUse(text)
            if (!use) return []
            return [{
                line: lineAt(text, use.offset),
                message: `script uses ${use.uses} — ${storageNote}`,
            }]
        },
    },
    {
        id: 'legal-imprint-link',
        level: 'warning',
        check: legalLinkRule('imprint'),
    },
    {
        id: 'legal-privacy-link',
        level: 'warning',
        check: legalLinkRule('privacy'),
    },
    {
        id: 'legal-outdated-law',
        level: 'warning',
        check({ document, url, site, lineOf }) {
            if (!site.legalPages.has(normalizePath(url))) return []
            const hits = []
            for (const law of OUTDATED_LAWS) {
                for (const node of textNodes(document)) {
                    const match = law.re.exec(node.data)
                    if (!match) continue
                    hits.push({
                        line: lineOf(node) + node.data.slice(0, match.index).split('\n').length - 1,
                        message: `legal page ${law.message}`,
                    })
                    break
                }
            }
            return hits.sort((a, b) => a.line - b.line)
        },
    },
]
