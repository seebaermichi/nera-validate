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

// The rule catalogue for `validateOutput` (ROADMAP-compliance.md). Each rule
// gets one parsed page and returns `{ line, message }` hits; the caller adds
// file, source and the configured severity. Rule ids are stable once released —
// the platform keys on them — and `level` is the default when
// config/validate.yaml says nothing (`warning`, or `off` for opt-in rules).
// A rule with `kind: 'css'` gets each CSS file in the output instead, as
// `{ text }` — plain text, no CSS parser — and its hits carry no `source`.
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
                        'screen readers cannot tell its language (WCAG 3.1.1)',
                }]
            }
            if (html.attribs.lang?.trim()) return []
            return [{
                line: lineOf(html),
                message:
                    `\`<html>\` has ${'lang' in html.attribs ? 'an empty' : 'no'} ` +
                    '`lang` — screen readers cannot tell the page language ' +
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
                    'the page in tabs, history and screen readers (WCAG 2.4.2)',
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
                        'to find the main heading (WCAG 1.3.1, best practice)',
                }]
            }
            return [{
                line: lineOf(h1s[1]),
                message:
                    'page has more than one `<h1>` — one main heading per ' +
                    'page keeps its outline clear (WCAG 1.3.1, best practice)',
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
                        'the outline suggests a missing section (WCAG 1.3.1)',
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
                        'announce it without a name (WCAG 2.4.4, 4.1.2)',
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
                        'to jump to the content (WCAG 1.3.1)',
                }]
            }
            return [{
                line: lineOf(mains[1]),
                message:
                    'page has more than one `<main>` — there should be one ' +
                    'main landmark (WCAG 1.3.1)',
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
                        'the content (WCAG 2.4.1)',
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
                    `\`id="${id}"\` — it goes nowhere (WCAG 2.4.1)`,
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
                        'cannot tell them apart (WCAG 1.3.1)',
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
                            'the wrong element (WCAG 4.1.2)',
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
                    'visitors cannot zoom the page to 200% (WCAG 1.4.4)',
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
                    'the page language (WCAG 3.1.2)',
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
                    'turned motion off still get it (WCAG 2.3.3)',
            }]
        },
    },
]
