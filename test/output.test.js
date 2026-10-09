import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'path'
import fs from 'fs/promises'
import os from 'os'
import { validateOutput, hasErrors, formatResults } from '../index.js'

let cwd

// Footer links to the imprint and privacy policy, named so the legal rules'
// link-text heuristic finds them.
const legalFooter =
    '<footer><a href="/imprint.html">Imprint</a> <a href="/privacy.html">Privacy</a></footer>'

// A page the way core writes it (run through `pretty`), with or without `lang`.
// Clean for every default rule: a title, a skip link to one `<main>` with one
// `<h1>`, and links to the legal pages — all on one line, so the lines above
// stay put.
const page = (htmlAttrs = ' lang="en"') =>
    `<!DOCTYPE html>\n<html${htmlAttrs}>\n  <head>\n    <title>T</title>\n  </head>\n  <body>\n    <a href="#main">Skip</a><main id="main"><h1>Hi</h1></main>${legalFooter}\n  </body>\n</html>\n`

// A full page around the given head and body markup, one element per line from
// line 1, so a finding's line is easy to predict: the head starts at line 4,
// the body's first child sits at line 6 + the number of head lines. The legal
// footer follows the body markup unless `footer` is false.
const doc = ({
    head = ['<title>T</title>'],
    body = ['<main><h1>Hi</h1></main>'],
    footer = true,
} = {}) =>
    [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        ...head,
        '</head>',
        '<body>',
        ...body,
        ...(footer ? [legalFooter] : []),
        '</body>',
        '</html>',
        '',
    ].join('\n')

async function write(relPath, content) {
    const abs = path.join(cwd, relPath)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, content)
}

// A minimal built site: config, one source page, and its output file.
async function buildSite() {
    await write('config/app.yaml', 'name: Test\nlang: en\n')
    await write('pages/index.md', '---\nlayout: pages/default.pug\n---\n# Hi\n')
    await write('public/index.html', page())
}

beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'nera-validate-output-'))
})

afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true })
})

describe('validateOutput', () => {
    it('reports nothing for clean output', async () => {
        await buildSite()
        expect(validateOutput({ cwd })).toEqual([])
    })

    it('throws "build first" when public/ is missing', async () => {
        await write('config/app.yaml', 'name: Test\n')
        expect(() => validateOutput({ cwd })).toThrow(/public\/.*nera build/)
    })

    it('throws "build first" when public/ holds no HTML', async () => {
        await write('public/assets/site.css', 'body {}\n')
        expect(() => validateOutput({ cwd })).toThrow(/nera build/)
    })

    it('reads another output folder via `dir`', async () => {
        await buildSite()
        await write('dist/index.html', page(''))
        const results = validateOutput({ cwd, dir: 'dist' })
        expect(results).toHaveLength(1)
        expect(results[0].file).toBe('dist/index.html')
    })

    describe('a11y-html-lang', () => {
        it('warns on <html> without lang, at its line, mapped to the page', async () => {
            await buildSite()
            await write('public/index.html', page(''))
            const results = validateOutput({ cwd })

            expect(results).toEqual([
                expect.objectContaining({
                    file: 'public/index.html',
                    line: 2,
                    severity: 'warning',
                    rule: 'a11y-html-lang',
                    source: 'pages/index.md',
                }),
            ])
            expect(results[0].message).toContain('no `lang`')
            expect(hasErrors(results)).toBe(false)
        })

        it('warns on an empty lang', async () => {
            await buildSite()
            await write('public/index.html', page(' lang="  "'))
            const [finding] = validateOutput({ cwd })
            expect(finding.rule).toBe('a11y-html-lang')
            expect(finding.message).toContain('an empty `lang`')
        })

        it('warns on a page with no <html> element at all', async () => {
            await buildSite()
            await write('public/fragment.html', '<p>just a fragment</p>\n')
            const [finding] = validateOutput({ cwd })
            expect(finding).toEqual(
                expect.objectContaining({
                    file: 'public/fragment.html',
                    line: null,
                    rule: 'a11y-html-lang',
                })
            )
        })

        it('stays silent when lang is set', async () => {
            await buildSite()
            await write('public/de/index.html', page(' lang="de"'))
            expect(validateOutput({ cwd })).toEqual([])
        })
    })

    describe('accessibility rules', () => {
        // Build a site whose index page is `html`, enable the rule when it is
        // opt-in, and return that rule's findings only.
        async function check(rule, html, { enable = false } = {}) {
            await buildSite()
            await write('public/index.html', html)
            if (enable) await write('config/validate.yaml', `rules:\n  ${rule}: warning\n`)
            return validateOutput({ cwd }).filter((r) => r.rule === rule)
        }

        it('keeps opt-in rules off until enabled', async () => {
            await buildSite()
            await write('public/index.html', doc({
                body: [
                    '<a href="#main">Skip</a>',
                    '<main id="main"><h1>Hi</h1>',
                    '<a href="/de/" hreflang="de" target="_blank">Deutsch</a></main>',
                ],
            }))
            await write('public/site.css', 'html { scroll-behavior: smooth; }\n')
            expect(validateOutput({ cwd })).toEqual([])
        })

        describe('a11y-title', () => {
            it('warns on a missing <title>', async () => {
                const [hit, ...rest] = await check('a11y-title', doc({ head: ['<meta charset="utf-8">'] }))
                expect(rest).toEqual([])
                expect(hit).toEqual(expect.objectContaining({ line: 3, severity: 'warning' }))
                expect(hit.message).toContain('no `<title>`')
                expect(hit.message).toContain('WCAG 2.4.2')
            })

            it('warns on an empty <title>', async () => {
                const [hit] = await check('a11y-title', doc({ head: ['<title>  </title>'] }))
                expect(hit.line).toBe(4)
                expect(hit.message).toContain('an empty `<title>`')
            })

            it('stays silent with a title', async () => {
                expect(await check('a11y-title', doc())).toEqual([])
            })
        })

        describe('a11y-h1', () => {
            it('warns on no <h1>', async () => {
                const [hit] = await check('a11y-h1', doc({ body: ['<main><h2>Hi</h2></main>'] }))
                expect(hit.line).toBe(6)
                expect(hit.message).toContain('no `<h1>`')
            })

            it('warns once on several <h1>, at the second', async () => {
                const hits = await check('a11y-h1', doc({
                    body: ['<main>', '<h1>A</h1>', '<h1>B</h1>', '<h1>C</h1>', '</main>'],
                }))
                expect(hits).toHaveLength(1)
                expect(hits[0].line).toBe(9)
                expect(hits[0].message).toContain('more than one `<h1>`')
            })

            it('stays silent with exactly one', async () => {
                expect(await check('a11y-h1', doc())).toEqual([])
            })
        })

        describe('a11y-heading-skip', () => {
            it('warns on each jump down, at the heading that skips', async () => {
                const hits = await check('a11y-heading-skip', doc({
                    body: ['<main>', '<h1>A</h1>', '<h3>B</h3>', '<h4>C</h4>', '<h6>D</h6>', '</main>'],
                }))
                expect(hits.map((h) => h.line)).toEqual([9, 11])
                expect(hits[0].message).toContain('from `<h1>` to `<h3>`')
                expect(hits[1].message).toContain('from `<h4>` to `<h6>`')
            })

            it('stays silent on steps of one and on any step back up', async () => {
                expect(await check('a11y-heading-skip', doc({
                    body: ['<main>', '<h1>A</h1>', '<h2>B</h2>', '<h3>C</h3>', '<h2>D</h2>', '</main>'],
                }))).toEqual([])
            })
        })

        describe('a11y-img-alt', () => {
            it('warns on <img> without alt', async () => {
                const [hit] = await check('a11y-img-alt', doc({
                    body: ['<main><h1>Hi</h1>', '<img src="/logo.png">', '</main>'],
                }))
                expect(hit.line).toBe(8)
                expect(hit.message).toContain('`<img src="/logo.png">` has no `alt`')
            })

            it('accepts alt="" (decorative) and real alt text', async () => {
                expect(await check('a11y-img-alt', doc({
                    body: ['<main><h1>Hi</h1>', '<img src="a.png" alt="">', '<img src="b.png" alt="B"></main>'],
                }))).toEqual([])
            })
        })

        describe('a11y-form-label', () => {
            it('warns on fields with no label', async () => {
                const hits = await check('a11y-form-label', doc({
                    body: [
                        '<main><h1>Hi</h1>',
                        '<input type="email" name="email">',
                        '<select name="topic"></select>',
                        '<textarea id="msg"></textarea>',
                        '<label for="other">Other</label>',
                        '</main>',
                    ],
                }))
                expect(hits.map((h) => h.line)).toEqual([8, 9, 10])
                expect(hits[0].message).toContain('`<input type="email" name="email">` has no label')
            })

            it('accepts every labelling technique and skips fields that need none', async () => {
                expect(await check('a11y-form-label', doc({
                    body: [
                        '<main><h1>Hi</h1>',
                        '<label for="a">A</label><input id="a">',
                        '<label>B <input name="b"></label>',
                        '<input aria-label="C">',
                        '<span id="dl">D</span><textarea aria-labelledby="dl"></textarea>',
                        '<input type="hidden" name="h"><input type="submit"><input type="button" value="x">',
                        '</main>',
                    ],
                }))).toEqual([])
            })
        })

        describe('a11y-link-name', () => {
            it('warns on a link with no name', async () => {
                const [hit] = await check('a11y-link-name', doc({
                    body: ['<main><h1>Hi</h1>', '<a href="https://example.org/"><img src="x.svg"></a>', '</main>'],
                }))
                expect(hit.line).toBe(8)
                expect(hit.message).toContain('link `<a href="https://example.org/">` has no text')
            })

            it('accepts text, aria-label, image alt; ignores <a> without href', async () => {
                expect(await check('a11y-link-name', doc({
                    body: [
                        '<main><h1>Hi</h1>',
                        '<a href="/a">A</a>',
                        '<a href="/b" aria-label="B"></a>',
                        '<a href="/c"><img src="c.png" alt="C"></a>',
                        '<a id="anchor"></a>',
                        '</main>',
                    ],
                }))).toEqual([])
            })
        })

        describe('a11y-main', () => {
            it('warns on no <main>', async () => {
                const [hit] = await check('a11y-main', doc({ body: ['<div><h1>Hi</h1></div>'] }))
                expect(hit.line).toBe(6)
                expect(hit.message).toContain('no `<main>`')
            })

            it('warns on more than one, at the second', async () => {
                const [hit] = await check('a11y-main', doc({
                    body: ['<main><h1>Hi</h1></main>', '<div role="main"></div>'],
                }))
                expect(hit.line).toBe(8)
                expect(hit.message).toContain('more than one `<main>`')
            })

            it('stays silent with one', async () => {
                expect(await check('a11y-main', doc())).toEqual([])
            })
        })

        describe('a11y-skip-link', () => {
            it('warns when the first focusable element is not a skip link', async () => {
                const [hit] = await check('a11y-skip-link', doc({
                    body: ['<header>', '<a href="/">Home</a>', '</header>', '<main><h1>Hi</h1></main>'],
                }))
                expect(hit.line).toBe(8)
                expect(hit.message).toContain('not a skip link')
            })

            it('warns when the skip link has no target', async () => {
                const [hit] = await check('a11y-skip-link', doc({
                    body: ['<a href="#content">Skip</a>', '<main id="main"><h1>Hi</h1></main>'],
                }))
                expect(hit.message).toContain('`#content`, but no element has `id="content"`')
            })

            it('accepts a skip link to an existing id, past unfocusable markup', async () => {
                expect(await check('a11y-skip-link', doc({
                    body: [
                        '<a name="top"></a><a href="/x" tabindex="-1">x</a>',
                        '<a class="skip" href="#main">Skip</a>',
                        '<nav><a href="/">Home</a></nav>',
                        '<main id="main"><h1>Hi</h1></main>',
                    ],
                }))).toEqual([])
            })

            it('stays silent on a page with nothing focusable', async () => {
                expect(await check('a11y-skip-link', doc({ footer: false }))).toEqual([])
            })
        })

        describe('a11y-nav-name', () => {
            it('warns on each unnamed <nav> when there are several', async () => {
                const hits = await check('a11y-nav-name', doc({
                    body: [
                        '<nav aria-label="Main"></nav>',
                        '<nav></nav>',
                        '<main><h1>Hi</h1></main>',
                        '<nav></nav>',
                    ],
                }))
                expect(hits.map((h) => h.line)).toEqual([8, 10])
            })

            it('stays silent on a single <nav>, named or not, and on named ones', async () => {
                expect(await check('a11y-nav-name', doc({
                    body: ['<nav></nav>', '<main><h1>Hi</h1></main>'],
                }))).toEqual([])
                await fs.rm(cwd, { recursive: true, force: true })
                expect(await check('a11y-nav-name', doc({
                    body: [
                        '<nav aria-label="Main"></nav>',
                        '<span id="f">Footer</span><nav aria-labelledby="f"></nav>',
                        '<main><h1>Hi</h1></main>',
                    ],
                }))).toEqual([])
            })
        })

        describe('a11y-duplicate-id', () => {
            it('warns once per repeated id, at its second use', async () => {
                const hits = await check('a11y-duplicate-id', doc({
                    body: [
                        '<main id="x"><h1>Hi</h1>',
                        '<p id="x"></p>',
                        '<p id="x"></p>',
                        '</main>',
                    ],
                }))
                expect(hits).toHaveLength(1)
                expect(hits[0].line).toBe(8)
                expect(hits[0].message).toContain('`id="x"` is used more than once')
            })

            it('stays silent on unique ids', async () => {
                expect(await check('a11y-duplicate-id', doc({
                    body: ['<main id="a"><h1 id="b">Hi</h1></main>'],
                }))).toEqual([])
            })
        })

        describe('a11y-viewport-zoom', () => {
            it('warns when zoom is blocked', async () => {
                const [hit] = await check('a11y-viewport-zoom', doc({
                    head: [
                        '<title>T</title>',
                        '<meta name="viewport" content="width=device-width, maximum-scale=1.0, user-scalable=no">',
                    ],
                }))
                expect(hit.line).toBe(5)
                expect(hit.message).toContain('`user-scalable=no` and `maximum-scale=1.0`')
            })

            it('accepts a viewport that allows zoom to 200%', async () => {
                expect(await check('a11y-viewport-zoom', doc({
                    head: [
                        '<title>T</title>',
                        '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5">',
                    ],
                }))).toEqual([])
            })
        })

        describe('a11y-link-lang (opt-in)', () => {
            it('warns on hreflang with no matching lang', async () => {
                const [hit] = await check('a11y-link-lang', doc({
                    body: ['<main><h1>Hi</h1>', '<a href="/de/" hreflang="de">Deutsch</a>', '</main>'],
                }), { enable: true })
                expect(hit.line).toBe(8)
                expect(hit.message).toContain('`hreflang="de"` but no matching `lang`')
                expect(hit.message).toContain('WCAG 3.1.2')
            })

            it('accepts lang on the link, an ancestor or inside it', async () => {
                expect(await check('a11y-link-lang', doc({
                    body: [
                        '<main><h1>Hi</h1>',
                        '<a href="/de/" hreflang="de" lang="de">Deutsch</a>',
                        '<span lang="es"><a href="/es/" hreflang="es-ES">Español</a></span>',
                        '<a href="/fr/" hreflang="fr"><span lang="fr">Français</span></a>',
                        '<a href="/" hreflang="x-default">Home</a>',
                        '</main>',
                    ],
                }), { enable: true })).toEqual([])
            })
        })

        describe('a11y-target-blank (opt-in)', () => {
            it('warns on target="_blank"', async () => {
                const [hit] = await check('a11y-target-blank', doc({
                    body: ['<main><h1>Hi</h1>', '<a href="https://example.org/" target="_blank">Ex</a>', '</main>'],
                }), { enable: true })
                expect(hit.line).toBe(8)
                expect(hit.message).toContain('opens a new window')
            })

            it('stays silent on links without it', async () => {
                expect(await check('a11y-target-blank', doc({
                    body: ['<main><h1>Hi</h1>', '<a href="/x" target="_self">X</a>', '</main>'],
                }), { enable: true })).toEqual([])
            })
        })

        describe('a11y-reduced-motion (opt-in, CSS)', () => {
            const enabled = 'rules:\n  a11y-reduced-motion: warning\n'

            it('warns on motion with no reduced-motion query, at the line, without source', async () => {
                await buildSite()
                await write('config/validate.yaml', enabled)
                await write('public/assets/site.css',
                    '/* animation: spin 1s; */\nbody { margin: 0; }\n.x {\n  animation: spin 1s;\n}\nhtml { scroll-behavior: smooth; }\n')
                const results = validateOutput({ cwd })

                expect(results).toEqual([
                    expect.objectContaining({
                        file: 'public/assets/site.css',
                        line: 4,
                        severity: 'warning',
                        rule: 'a11y-reduced-motion',
                    }),
                ])
                expect(results[0]).not.toHaveProperty('source')
                expect(results[0].message).toContain('`scroll-behavior: smooth` and `animation`')
            })

            it('stays silent with a prefers-reduced-motion query, or without motion', async () => {
                await buildSite()
                await write('config/validate.yaml', enabled)
                await write('public/a.css',
                    'html { scroll-behavior: smooth; }\n@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }\n')
                await write('public/b.css', '.x { animation: none; }\n/* scroll-behavior: smooth */\n')
                expect(validateOutput({ cwd })).toEqual([])
            })

            it('collapses the same finding across stylesheets', async () => {
                await buildSite()
                await write('config/validate.yaml', enabled)
                await write('public/a.css', 'html { scroll-behavior: smooth; }\n')
                await write('public/b.css', 'html { scroll-behavior: smooth; }\n')
                const results = validateOutput({ cwd })
                expect(results).toHaveLength(1)
                expect(results[0].files).toHaveLength(2)
            })
        })
    })

    describe('privacy and legal rules', () => {
        // Build a site whose index page is `html`, with `config` as
        // config/validate.yaml, and return the given rule's findings only.
        async function check(rule, html, { config } = {}) {
            await buildSite()
            await write('public/index.html', html)
            if (config) await write('config/validate.yaml', config)
            return validateOutput({ cwd }).filter((r) => r.rule === rule)
        }
        const thirdParty = () =>
            validateOutput({ cwd }).filter((r) => r.rule === 'privacy-third-party')

        describe('privacy-third-party', () => {
            it('warns once per third-party host, at its first use, naming known hosts', async () => {
                const hits = await check('privacy-third-party', doc({
                    head: [
                        '<title>T</title>',
                        '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">',
                        '<script src="https://cdn.example.org/a.js"></script>',
                    ],
                    body: [
                        '<main><h1>Hi</h1>',
                        '<img src="//cdn.example.org/b.png" alt="">',
                        '<img srcset="/x.png 1x, https://img.example.net/x@2x.png 2x" alt="">',
                        '<iframe src="https://www.youtube.com/embed/abc"></iframe>',
                        '</main>',
                    ],
                }))
                expect(hits.map((h) => [h.line, h.message.split(' — ')[0]])).toEqual([
                    [5, 'loads Google Fonts from fonts.googleapis.com'],
                    [6, 'loads cdn.example.org'],
                    [11, 'loads img.example.net'],
                    [12, 'loads a YouTube embed from www.youtube.com'],
                ])
                expect(hits[0].message).toContain('sends the visitor\'s IP address')
                expect(hits[0].message).toContain('LG München I, 3 O 17493/20')
                expect(hits[1].message).toContain('privacy.allowed_hosts')
                expect(hits[0].source).toBe('pages/index.md')
            })

            it('ignores relative URLs, plain links, non-resource <link>s and data: URLs', async () => {
                expect(await check('privacy-third-party', doc({
                    head: [
                        '<title>T</title>',
                        '<link rel="stylesheet" href="/css/site.css">',
                        '<link rel="canonical" href="https://other.example/x">',
                        '<link rel="alternate" hreflang="de" href="https://other.example/de/">',
                    ],
                    body: [
                        '<main><h1>Hi</h1>',
                        '<a href="https://github.com/seebaermichi/nera">GitHub</a>',
                        '<img src="data:image/png;base64,AAAA" alt="">',
                        '<script src="../js/app.js"></script>',
                        '</main>',
                    ],
                }))).toEqual([])
            })

            it('treats the origin in app.yaml as the site\'s own, with or without www.', async () => {
                await buildSite()
                await write('config/app.yaml', 'name: Test\norigin: https://example.com\n')
                await write('public/index.html', doc({
                    head: [
                        '<title>T</title>',
                        '<link rel="icon" href="https://www.example.com/favicon.svg">',
                        '<script src="https://example.com/a.js"></script>',
                    ],
                }))
                expect(thirdParty()).toEqual([])
            })

            it('falls back to app_origin in config/canonical-links.yaml; app.yaml wins', async () => {
                await buildSite()
                await write('config/canonical-links.yaml', 'app_origin: https://nera.js.org\n')
                await write('public/index.html', doc({
                    head: ['<title>T</title>', '<link rel="icon" href="https://nera.js.org/favicon.svg">'],
                }))
                expect(thirdParty()).toEqual([])

                await write('config/app.yaml', 'name: Test\norigin: https://example.com\n')
                const [hit] = thirdParty()
                expect(hit.message).toMatch(/^loads nera\.js\.org/)
            })

            it('without an origin, counts every absolute URL as third-party', async () => {
                const [hit] = await check('privacy-third-party', doc({
                    head: ['<title>T</title>', '<link rel="icon" href="https://example.com/favicon.svg">'],
                }))
                expect(hit.message).toMatch(/^loads example\.com/)
            })

            it('skips hosts listed under privacy.allowed_hosts', async () => {
                expect(await check('privacy-third-party', doc({
                    head: ['<title>T</title>', '<script src="https://cdn.example.org/a.js"></script>'],
                }), { config: 'privacy:\n  allowed_hosts:\n    - CDN.example.org\n' })).toEqual([])
            })

            it('reads @import, url() and @font-face in CSS, without source', async () => {
                await buildSite()
                await write('public/css/site.css', [
                    '/* @import url("https://commented.example/x.css"); */',
                    '@import "https://fonts.googleapis.com/css2?family=Inter";',
                    '.a { background: url(/img/a.png); }',
                    '@font-face {',
                    '  src: url(\'https://cdn.example.org/f.woff2\') format("woff2");',
                    '}',
                    '.b { background: url("https://cdn.example.org/b.png"); }',
                    '',
                ].join('\n'))
                const hits = validateOutput({ cwd })
                expect(hits.map((h) => [h.file, h.line, h.message.split(' — ')[0]])).toEqual([
                    ['public/css/site.css', 2, 'loads Google Fonts from fonts.googleapis.com'],
                    ['public/css/site.css', 5, 'loads cdn.example.org'],
                ])
                expect(hits[0]).not.toHaveProperty('source')
            })

            it('collapses the same template resource across pages', async () => {
                await buildSite()
                const html = doc({
                    head: ['<title>T</title>', '<script src="https://cdn.example.org/a.js"></script>'],
                })
                await write('public/index.html', html)
                await write('public/about.html', html)
                const results = thirdParty()
                expect(results).toHaveLength(1)
                expect(results[0].files).toHaveLength(2)
            })
        })

        describe('privacy-insecure', () => {
            it('warns on http:// resources and form actions, by element', async () => {
                const hits = await check('privacy-insecure', doc({
                    body: [
                        '<main><h1>Hi</h1>',
                        '<img src="http://example.com/a.png" alt="">',
                        '<form action="http://example.com/send"><button>Send</button></form>',
                        '</main>',
                    ],
                }))
                expect(hits.map((h) => h.line)).toEqual([8, 9])
                expect(hits[0].message).toContain('`<img src="http://example.com/a.png">` loads over plain http')
                expect(hits[1].message).toContain('`<form action="http://example.com/send">` sends its data over plain http')
                expect(hits[1].message).toContain('Art. 32 DSGVO')
            })

            it('stays silent on https, relative URLs and plain http links', async () => {
                expect(await check('privacy-insecure', doc({
                    body: [
                        '<main><h1>Hi</h1>',
                        '<img src="https://example.com/a.png" alt="">',
                        '<img src="/a.png" alt="">',
                        '<a href="http://example.com/">Old site</a>',
                        '<form action="/send"><button>Send</button></form>',
                        '</main>',
                    ],
                }))).toEqual([])
            })
        })

        describe('privacy-storage (opt-in)', () => {
            const enabled = 'rules:\n  privacy-storage: warning\n'

            it('is off until enabled', async () => {
                expect(await check('privacy-storage', doc({
                    body: ['<main><h1>Hi</h1></main>', '<script>localStorage.setItem("a", 1)</script>'],
                }))).toEqual([])
            })

            it('warns on an inline script touching device storage, at the line', async () => {
                const [hit, ...rest] = await check('privacy-storage', doc({
                    body: [
                        '<main><h1>Hi</h1></main>',
                        '<script>',
                        'const theme = "dark"',
                        'localStorage.setItem("theme", theme); document.cookie = "a=1"',
                        '</script>',
                    ],
                }), { config: enabled })
                expect(rest).toEqual([])
                expect(hit.line).toBe(10)
                expect(hit.message).toContain('inline `<script>` uses `document.cookie`, `localStorage`')
                expect(hit.message).toContain('§ 25 TDDDG')
            })

            it('ignores scripts without storage, external scripts and JSON-LD', async () => {
                expect(await check('privacy-storage', doc({
                    body: [
                        '<main><h1>Hi</h1></main>',
                        '<script>console.log("hi")</script>',
                        '<script src="/js/app.js"></script>',
                        '<script type="application/ld+json">{"localStorage": 1}</script>',
                    ],
                }), { config: enabled })).toEqual([])
            })

            it('reads .js files in the output, without source', async () => {
                await buildSite()
                await write('config/validate.yaml', enabled)
                await write('public/js/app.js', 'const a = 1\nsessionStorage.clear()\n')
                await write('public/js/plain.js', 'console.log("no storage")\n')
                const results = validateOutput({ cwd })
                expect(results).toEqual([
                    expect.objectContaining({
                        file: 'public/js/app.js',
                        line: 2,
                        rule: 'privacy-storage',
                    }),
                ])
                expect(results[0]).not.toHaveProperty('source')
                expect(results[0].message).toContain('script uses `sessionStorage`')
            })
        })

        describe('legal-imprint-link and legal-privacy-link', () => {
            const bare = (lang, body) =>
                doc({ body: ['<main><h1>Hi</h1></main>', ...body], footer: false })
                    .replace('lang="en"', `lang="${lang}"`)

            it('warn on a page without links to the legal pages, at <body>', async () => {
                await buildSite()
                await write('public/index.html', bare('en', []))
                const results = validateOutput({ cwd }).filter((r) => r.rule.startsWith('legal-'))
                expect(results.map((r) => [r.rule, r.line])).toEqual([
                    ['legal-imprint-link', 6],
                    ['legal-privacy-link', 6],
                ])
                expect(results[0].message).toContain('(Impressum, Imprint, Legal notice)')
                expect(results[0].message).toContain('§ 5 DDG')
                expect(results[1].message).toContain('Art. 13 DSGVO')
            })

            it('accept German and English link text, in any case, and aria-label', async () => {
                await buildSite()
                await write('public/index.html', bare('de', [
                    '<a href="/impressum.html">IMPRESSUM</a>',
                    '<a href="/datenschutz.html" aria-label="Datenschutzerklärung">§</a>',
                ]))
                await write('public/en.html', bare('en-GB', [
                    '<a href="/imprint.html">Legal notice</a>',
                    '<a href="/privacy.html">Data protection</a>',
                ]))
                expect(validateOutput({ cwd }).filter((r) => r.rule.startsWith('legal-'))).toEqual([])
            })

            it('do not guess for a language without words and without config', async () => {
                expect(await check('legal-imprint-link', bare('es', [
                    '<a href="/es/aviso-legal.html">Aviso legal</a>',
                ]))).toEqual([])
            })

            it('use legal.<kind> for the page\'s language, comparing paths not text', async () => {
                const config = [
                    'legal:',
                    '  imprint:',
                    '    es: /es/aviso-legal.html',
                    '    de: /de/impressum.html',
                    '',
                ].join('\n')
                await buildSite()
                await write('config/app.yaml', 'name: Test\norigin: https://example.com\n')
                await write('config/validate.yaml', config)
                await write('public/es/index.html', bare('es', ['<a href="aviso-legal">Aviso legal</a>']))
                await write('public/es/a.html', bare('es', ['<a href="https://example.com/es/aviso-legal.html">x</a>']))
                await write('public/de/index.html', bare('de', ['<a href="/de/kontakt.html">Impressum</a>']))
                const hits = validateOutput({ cwd }).filter((r) => r.rule === 'legal-imprint-link')

                expect(hits).toEqual([
                    expect.objectContaining({ file: 'public/de/index.html', line: 6 }),
                ])
                expect(hits[0].message).toContain('no link to the imprint (`/de/impressum.html`)')
            })
        })

        describe('legal-outdated-law', () => {
            // A site whose pages all link to /imprint.html and /privacy.html in
            // the footer; `pages` maps output paths to extra body lines.
            async function site(pages, config) {
                await buildSite()
                if (config) await write('config/validate.yaml', config)
                for (const [file, body] of Object.entries(pages)) {
                    await write(`public/${file}`, doc({ body: ['<main><h1>Hi</h1>', ...body, '</main>'] }))
                }
                return validateOutput({ cwd }).filter((r) => r.rule === 'legal-outdated-law')
            }

            it('warns on the legal pages the heuristic finds, once per law, at the line', async () => {
                const hits = await site({
                    'imprint.html': ['<p>Angaben gemäß § 5 TMG</p>', '<p>Telemediengesetz</p>', '<p>§ 55 Abs. 2 RStV</p>'],
                    'privacy.html': ['<p>Cookies: § 25 TTDSG.</p>'],
                })
                expect(hits.map((h) => [h.file, h.line, h.message.split(' — ')[0]])).toEqual([
                    ['public/imprint.html', 8, 'legal page cites the TMG (Telemediengesetz)'],
                    ['public/imprint.html', 10, 'legal page cites § 55 RStV'],
                    ['public/privacy.html', 8, 'legal page cites the TTDSG'],
                ])
                expect(hits[0].message).toContain('§ 5 DDG')
            })

            it('ignores other pages, a stray "Datenschutz" link and script text', async () => {
                const hits = await site({
                    'imprint.html': ['<p>Angaben gemäß § 5 DDG</p>', '<script>// TMG</script>'],
                    'blog/cookies.html': ['<p>Das TTDSG heißt jetzt TDDDG.</p>'],
                    'blog/index.html': ['<a href="/blog/cookies.html">Datenschutz bei Cookie-Bannern</a>'],
                })
                expect(hits).toEqual([])
            })

            it('checks the configured pages instead of the heuristic\'s', async () => {
                const hits = await site({
                    'privacy.html': ['<p>TTDSG</p>'],
                    'rechtliches/datenschutz.html': ['<p>§ 25 TTDSG</p>'],
                }, 'legal:\n  privacy:\n    en: /rechtliches/datenschutz.html\n')
                expect(hits).toEqual([
                    expect.objectContaining({ file: 'public/rechtliches/datenschutz.html', line: 8 }),
                ])
            })
        })

        describe('config/validate.yaml values', () => {
            it('reports unusable legal and privacy values and runs on', async () => {
                await buildSite()
                await write('config/validate.yaml', [
                    'legal:',
                    '  imprint: [/impressum.html]',
                    '  privacy:',
                    '    de: datenschutz.html',
                    'privacy:',
                    '  allowed_hosts:',
                    '    - https://cdn.example.org',
                    '    - cdn.example.net',
                    '',
                ].join('\n'))
                await write('public/index.html', doc({
                    head: [
                        '<title>T</title>',
                        '<script src="https://cdn.example.org/a.js"></script>',
                        '<script src="https://cdn.example.net/a.js"></script>',
                    ],
                }))
                const results = validateOutput({ cwd })
                const config = results.filter((r) => r.rule === 'config-invalid')
                expect(config.map((r) => r.message.split(' — ')[0])).toEqual([
                    'legal.imprint must map languages to paths, such as `de: /de/impressum.html`; ignoring it',
                    'legal.privacy.de is "datenschutz.html"',
                    'privacy.allowed_hosts has "https://cdn.example.org"',
                ])
                expect(config.every((r) => r.severity === 'warning')).toBe(true)
                expect(results.filter((r) => r.rule === 'privacy-third-party')
                    .map((r) => r.message.split(' — ')[0])).toEqual(['loads cdn.example.org'])
            })

            it('reports a legal or privacy key that is not a mapping', async () => {
                await buildSite()
                await write('config/validate.yaml', 'legal: yes\nprivacy: [a]\n')
                const results = validateOutput({ cwd })
                expect(results.map((r) => r.rule)).toEqual(['config-invalid', 'config-invalid'])
            })
        })
    })

    describe('source mapping', () => {
        it('maps a nested output file to its page', async () => {
            await buildSite()
            await write('pages/de/impressum.md', '---\nlayout: x\n---\n')
            await write('public/de/impressum.html', page(''))
            const [finding] = validateOutput({ cwd })
            expect(finding.source).toBe('pages/de/impressum.md')
        })

        it('omits source for output with no page behind it', async () => {
            await buildSite()
            await write('public/tags/nera.html', page(''))
            const [finding] = validateOutput({ cwd })
            expect(finding.file).toBe('public/tags/nera.html')
            expect(finding).not.toHaveProperty('source')
        })
    })

    describe('collapsing', () => {
        it('reports one finding repeated on two files once', async () => {
            await buildSite()
            await write('public/index.html', page(''))
            await write('public/about.html', page(''))
            const results = validateOutput({ cwd })

            expect(results).toHaveLength(1)
            const [finding] = results
            expect(finding.file).toBe('public/about.html')
            expect(finding.message).toContain(
                'on 2 pages, e.g. public/about.html, public/index.html)'
            )
            expect(finding.files).toEqual([
                { file: 'public/about.html', line: 2 },
                { file: 'public/index.html', line: 2, source: 'pages/index.md' },
            ])
        })

        it('names only the first three files and counts them all', async () => {
            await buildSite()
            for (const name of ['a', 'b', 'c', 'd']) {
                await write(`public/${name}.html`, page(''))
            }
            const [finding] = validateOutput({ cwd })
            expect(finding.message).toContain(
                'on 4 pages, e.g. public/a.html, public/b.html, public/c.html, …)'
            )
            expect(finding.files).toHaveLength(4)
        })

        it('keeps a finding on a single file as it is', async () => {
            await buildSite()
            await write('public/index.html', page(''))
            const [finding] = validateOutput({ cwd })
            expect(finding).not.toHaveProperty('files')
            expect(finding.message).not.toContain('pages, e.g.')
        })
    })

    describe('config/validate.yaml', () => {
        it('promotes a rule to error', async () => {
            await buildSite()
            await write('public/index.html', page(''))
            await write('config/validate.yaml', 'rules:\n  a11y-html-lang: error\n')
            const results = validateOutput({ cwd })
            expect(results[0].severity).toBe('error')
            expect(hasErrors(results)).toBe(true)
        })

        it('turns a rule off', async () => {
            await buildSite()
            await write('public/index.html', page(''))
            await write('config/validate.yaml', 'rules:\n  a11y-html-lang: off\n')
            expect(validateOutput({ cwd })).toEqual([])
        })

        it('ignores rules it does not know', async () => {
            await buildSite()
            await write('config/validate.yaml', 'rules:\n  a11y-from-the-future: error\n')
            expect(validateOutput({ cwd })).toEqual([])
        })

        it('warns on an unknown level and keeps the default', async () => {
            await buildSite()
            await write('public/index.html', page(''))
            await write('config/validate.yaml', 'rules:\n  a11y-html-lang: eror\n')
            const results = validateOutput({ cwd })

            const config = results.find((r) => r.rule === 'config-invalid')
            expect(config).toEqual(
                expect.objectContaining({
                    file: 'config/validate.yaml',
                    severity: 'warning',
                })
            )
            const lang = results.find((r) => r.rule === 'a11y-html-lang')
            expect(lang.severity).toBe('warning')
        })

        it('reports a config that does not parse, then runs on defaults', async () => {
            await buildSite()
            await write('public/index.html', page(''))
            await write('config/validate.yaml', 'rules: [unterminated\n')
            const results = validateOutput({ cwd })

            expect(results.find((r) => r.rule === 'yaml-parse')).toEqual(
                expect.objectContaining({
                    file: 'config/validate.yaml',
                    severity: 'error',
                })
            )
            expect(results.find((r) => r.rule === 'a11y-html-lang')).toBeDefined()
        })
    })

    describe('validate_ignore', () => {
        it('silences a rule for the page that lists it', async () => {
            await buildSite()
            await write(
                'pages/index.md',
                '---\nlayout: x\nvalidate_ignore: [a11y-html-lang]\n---\n'
            )
            await write('public/index.html', page(''))
            expect(validateOutput({ cwd })).toEqual([])
        })

        it('accepts a single id instead of a list', async () => {
            await buildSite()
            await write(
                'pages/index.md',
                '---\nlayout: x\nvalidate_ignore: a11y-html-lang\n---\n'
            )
            await write('public/index.html', page(''))
            expect(validateOutput({ cwd })).toEqual([])
        })

        it('leaves other pages alone', async () => {
            await buildSite()
            await write(
                'pages/index.md',
                '---\nlayout: x\nvalidate_ignore: [a11y-html-lang]\n---\n'
            )
            await write('pages/about.md', '---\nlayout: x\n---\n')
            await write('public/index.html', page(''))
            await write('public/about.html', page(''))
            const results = validateOutput({ cwd })
            expect(results).toHaveLength(1)
            expect(results[0].file).toBe('public/about.html')
        })
    })

    it('formats through the shared formatter', async () => {
        await buildSite()
        await write('public/index.html', page(''))
        const out = formatResults(validateOutput({ cwd }))
        expect(out).toContain('public/index.html')
        expect(out).toContain('a11y-html-lang')
        expect(out).toContain('0 error(s), 1 warning(s)')
    })
})
