import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'path'
import fs from 'fs/promises'
import os from 'os'
import { validateSite, hasErrors } from '../index.js'

let cwd

// Build a minimal, valid thin Nera site, then let each test break one thing.
async function buildValidSite() {
    await fs.mkdir(path.join(cwd, 'config'), { recursive: true })
    await fs.writeFile(
        path.join(cwd, 'config', 'app.yaml'),
        'name: Test\nlang: en\n'
    )
    await fs.mkdir(path.join(cwd, 'pages'), { recursive: true })
    await fs.writeFile(
        path.join(cwd, 'pages', 'index.md'),
        '---\nlayout: pages/default.pug\ntitle: Home\n---\n# Hello\n'
    )
    const views = path.join(cwd, 'theme', 'views')
    await fs.mkdir(path.join(views, 'layouts'), { recursive: true })
    await fs.mkdir(path.join(views, 'pages'), { recursive: true })
    await fs.writeFile(
        path.join(views, 'layouts', 'layout.pug'),
        'html\n  body\n    block content\n'
    )
    await fs.writeFile(
        path.join(views, 'pages', 'default.pug'),
        'extends ../layouts/layout\n\nblock content\n  main !{ content }\n'
    )
}

beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'nera-validate-'))
})

afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true })
})

describe('validateSite', () => {
    it('reports nothing for a valid site', async () => {
        await buildValidSite()
        const results = validateSite({ cwd })
        expect(results).toEqual([])
        expect(hasErrors(results)).toBe(false)
    })

    it('warns (not errors) on a page with no layout', async () => {
        await buildValidSite()
        await fs.writeFile(
            path.join(cwd, 'pages', 'draft.md'),
            '---\ntitle: Draft\n---\n# no layout here\n'
        )
        const results = validateSite({ cwd })

        const finding = results.find((r) => r.rule === 'layout-missing')
        expect(finding).toBeDefined()
        expect(finding.severity).toBe('warning')
        expect(finding.file).toBe('pages/draft.md')
        // A warning alone keeps the site valid.
        expect(hasErrors(results)).toBe(false)
    })

    it('anchors layout-missing to the opening fence, or nowhere without one', async () => {
        await buildValidSite()
        await fs.writeFile(
            path.join(cwd, 'pages', 'draft.md'),
            '---\ntitle: Draft\n---\n# no layout here\n'
        )
        await fs.writeFile(path.join(cwd, 'pages', 'bare.md'), '# no frontmatter\n')
        const lines = Object.fromEntries(validateSite({ cwd })
            .filter((r) => r.rule === 'layout-missing')
            .map((r) => [r.file, r.line]))
        expect(lines).toEqual({ 'pages/draft.md': 1, 'pages/bare.md': null })
    })

    it('errors when the layout cannot be resolved, at the layout line', async () => {
        await buildValidSite()
        await fs.writeFile(
            path.join(cwd, 'pages', 'index.md'),
            '---\nlayout: pages/missing.pug\ntitle: Home\n---\n# Hello\n'
        )
        const results = validateSite({ cwd })

        const finding = results.find((r) => r.rule === 'layout-unresolved')
        expect(finding).toBeDefined()
        expect(finding.severity).toBe('error')
        expect(finding.file).toBe('pages/index.md')
        expect(finding.line).toBe(2) // the `layout:` line
        expect(hasErrors(results)).toBe(true)
    })

    it('errors on an unresolved include, in the pug file at the include line', async () => {
        await buildValidSite()
        // Add a broken include to the layout.
        await fs.writeFile(
            path.join(cwd, 'theme', 'views', 'layouts', 'layout.pug'),
            'html\n  head\n    include ../partials/missing\n  body\n    block content\n'
        )
        const results = validateSite({ cwd })

        const finding = results.find((r) => r.rule === 'include-unresolved')
        expect(finding).toBeDefined()
        expect(finding.severity).toBe('error')
        expect(finding.file).toBe('theme/views/layouts/layout.pug')
        expect(finding.line).toBe(3)
    })

    it('errors on malformed frontmatter YAML with a file line', async () => {
        await buildValidSite()
        await fs.writeFile(
            path.join(cwd, 'pages', 'bad.md'),
            '---\nlayout: pages/default.pug\ntitle: [unterminated\n---\n# body\n'
        )
        const results = validateSite({ cwd })

        const finding = results.find(
            (r) => r.rule === 'yaml-parse' && r.file === 'pages/bad.md'
        )
        expect(finding).toBeDefined()
        expect(finding.severity).toBe('error')
        expect(finding.line).toBeGreaterThanOrEqual(2)
    })

    it('errors on malformed config/app.yaml with the parser line', async () => {
        await buildValidSite()
        await fs.writeFile(
            path.join(cwd, 'config', 'app.yaml'),
            'name: Test\nlang: en\nname: Again\n'
        )
        const results = validateSite({ cwd })

        const finding = results.find(
            (r) => r.rule === 'yaml-parse' && r.file === 'config/app.yaml'
        )
        expect(finding).toBeDefined()
        expect(finding.severity).toBe('error')
        expect(finding.line).toBe(3) // the duplicate `name:` key
    })

    it('errors when a configured theme cannot be resolved', async () => {
        await buildValidSite()
        await fs.writeFile(
            path.join(cwd, 'config', 'app.yaml'),
            'name: Test\ntheme: ./missing-theme\n'
        )
        const results = validateSite({ cwd })

        const finding = results.find((r) => r.rule === 'theme-unresolved')
        expect(finding).toBeDefined()
        expect(finding.severity).toBe('error')
    })

    it('resolves a layout that lives only in the theme (layering)', async () => {
        await buildValidSite()
        // Move the page layout into a local theme package; the site keeps only
        // the base layout. The layered resolver must find pages/default.pug in
        // the theme.
        await fs.writeFile(
            path.join(cwd, 'config', 'app.yaml'),
            'name: Test\ntheme: ./my-theme\n'
        )
        const themeViews = path.join(cwd, 'my-theme', 'views')
        await fs.mkdir(path.join(themeViews, 'pages'), { recursive: true })
        await fs.mkdir(path.join(themeViews, 'layouts'), { recursive: true })
        await fs.writeFile(
            path.join(themeViews, 'layouts', 'layout.pug'),
            'html\n  body\n    block content\n'
        )
        await fs.writeFile(
            path.join(themeViews, 'pages', 'default.pug'),
            'extends ../layouts/layout\n\nblock content\n  main !{ content }\n'
        )
        // Remove the site's own copies so only the theme provides them.
        await fs.rm(path.join(cwd, 'theme', 'views', 'pages', 'default.pug'))
        await fs.rm(path.join(cwd, 'theme', 'views', 'layouts', 'layout.pug'))

        const results = validateSite({ cwd })
        expect(results.filter((r) => r.severity === 'error')).toEqual([])
    })

    describe('theme-shadowed', () => {
        // A site using a local theme that ships its own layout and page
        // template, alongside the site's own copies of both.
        async function buildThemedSite(siteLayout) {
            await buildValidSite()
            await fs.writeFile(
                path.join(cwd, 'config', 'app.yaml'),
                'name: Test\ntheme: ./my-theme\n'
            )
            const themeViews = path.join(cwd, 'my-theme', 'views')
            await fs.mkdir(path.join(themeViews, 'layouts'), { recursive: true })
            await fs.mkdir(path.join(themeViews, 'pages'), { recursive: true })
            await fs.writeFile(
                path.join(themeViews, 'layouts', 'layout.pug'),
                'html\n  body\n    header Theme\n    block content\n'
            )
            await fs.writeFile(
                path.join(themeViews, 'pages', 'default.pug'),
                'extends ../layouts/layout\n\nblock content\n  main !{ content }\n'
            )
            await fs.writeFile(
                path.join(cwd, 'theme', 'views', 'layouts', 'layout.pug'),
                siteLayout
            )
        }

        it('warns when a nera new starter file hides a theme file', async () => {
            await buildThemedSite(
                '//- nera:scaffold-default\nhtml\n  body\n    block content\n'
            )
            const results = validateSite({ cwd })

            const finding = results.find((r) => r.rule === 'theme-shadowed')
            expect(finding).toEqual(
                expect.objectContaining({
                    file: 'theme/views/layouts/layout.pug',
                    line: 1,
                    severity: 'warning',
                })
            )
            expect(finding.message).toContain('layouts/layout.pug')
            // Only the marked file is reported, and a warning keeps it valid.
            expect(
                results.filter((r) => r.rule === 'theme-shadowed')
            ).toHaveLength(1)
            expect(hasErrors(results)).toBe(false)
        })

        it('stays silent for a deliberate override without the marker', async () => {
            await buildThemedSite('html\n  body\n    block content\n')
            const results = validateSite({ cwd })
            expect(results.find((r) => r.rule === 'theme-shadowed')).toBeUndefined()
        })

        it('stays silent when no theme is configured', async () => {
            await buildValidSite()
            await fs.writeFile(
                path.join(cwd, 'theme', 'views', 'layouts', 'layout.pug'),
                '//- nera:scaffold-default\nhtml\n  body\n    block content\n'
            )
            expect(validateSite({ cwd })).toEqual([])
        })

        it('stays silent for a starter file the theme does not ship', async () => {
            await buildThemedSite('html\n  body\n    block content\n')
            await fs.writeFile(
                path.join(cwd, 'theme', 'views', 'pages', 'extra.pug'),
                '//- nera:scaffold-default\np extra\n'
            )
            const results = validateSite({ cwd })
            expect(results.find((r) => r.rule === 'theme-shadowed')).toBeUndefined()
        })
    })

    describe('ignore in config/validate.yaml', () => {
        // Pages without a layout in several folders, the way a site keeps
        // content fragments (included elsewhere) and drafts.
        async function buildSiteWithFragments(validateYaml) {
            await buildValidSite()
            const pages = {
                'pages/de/references/a.md': '---\ntitle: A\n---\n',
                'pages/en/references/a.md': '---\ntitle: A\n---\n',
                'pages/de/blog/drafts/x.md': '---\ntitle: X\n---\n',
                'pages/de/blog/forgotten.md': '---\ntitle: F\n---\n',
            }
            for (const [rel, body] of Object.entries(pages)) {
                await fs.mkdir(path.join(cwd, path.dirname(rel)), { recursive: true })
                await fs.writeFile(path.join(cwd, rel), body)
            }
            if (validateYaml != null) {
                await fs.writeFile(
                    path.join(cwd, 'config', 'validate.yaml'),
                    validateYaml
                )
            }
        }

        const files = (results, rule) =>
            results.filter((r) => r.rule === rule).map((r) => r.file).sort()

        it('reports every page without a layout when nothing is ignored', async () => {
            await buildSiteWithFragments()
            expect(files(validateSite({ cwd }), 'layout-missing')).toHaveLength(4)
        })

        it('silences a rule on listed folders, with * for one segment', async () => {
            await buildSiteWithFragments(
                'ignore:\n  layout-missing:\n' +
                '    - pages/*/references\n    - ./pages/de/blog/drafts/\n'
            )
            const results = validateSite({ cwd })
            expect(files(results, 'layout-missing'))
                .toEqual(['pages/de/blog/forgotten.md'])
            expect(results.find((r) => r.rule === 'config-invalid')).toBeUndefined()
        })

        it('matches a single file, and only for the named rule', async () => {
            await buildSiteWithFragments(
                'ignore:\n  layout-missing: [pages/de/blog/forgotten.md]\n' +
                '  layout-unresolved: [pages]\n'
            )
            expect(files(validateSite({ cwd }), 'layout-missing')).toEqual([
                'pages/de/blog/drafts/x.md',
                'pages/de/references/a.md',
                'pages/en/references/a.md',
            ])
        })

        it('does not match a folder by a name prefix', async () => {
            await buildSiteWithFragments(
                'ignore:\n  layout-missing: [pages/de/ref]\n'
            )
            expect(files(validateSite({ cwd }), 'layout-missing')).toHaveLength(4)
        })

        it('reports unusable values as config-invalid and ignores them', async () => {
            await buildSiteWithFragments(
                'ignore:\n  layout-missing: [/pages/de/references, ../x, pages/en/references]\n' +
                '  layout-unresolved: pages\n'
            )
            const results = validateSite({ cwd })
            const invalid = results.filter((r) => r.rule === 'config-invalid')
            expect(invalid).toHaveLength(3)
            expect(invalid[0].file).toBe('config/validate.yaml')
            expect(invalid.map((r) => r.message).join('\n'))
                .toContain('use a path relative to the site root')
            expect(files(results, 'layout-missing')).toHaveLength(3)
            expect(hasErrors(results)).toBe(false)
        })

        it('reports ignore that is not a mapping', async () => {
            await buildSiteWithFragments('ignore: [pages]\n')
            const results = validateSite({ cwd })
            expect(results.filter((r) => r.rule === 'config-invalid')).toHaveLength(1)
            expect(files(results, 'layout-missing')).toHaveLength(4)
        })

        it('errors on a validate.yaml that does not parse', async () => {
            await buildSiteWithFragments('ignore: [unclosed\n')
            const results = validateSite({ cwd })
            const parse = results.find((r) => r.rule === 'yaml-parse')
            expect(parse.file).toBe('config/validate.yaml')
            expect(hasErrors(results)).toBe(true)
        })
    })

    describe('stack pages (type: stack)', () => {
        const stack = (extra = '') =>
            `---\ntype: stack\nslug: home\ntitle: Intro\n${extra}---\nA section.\n`

        it('reports no layout-missing for a stack page without a layout', async () => {
            await buildValidSite()
            await fs.writeFile(path.join(cwd, 'pages', 'intro.md'), stack())
            expect(validateSite({ cwd })).toEqual([])
        })

        it('still warns on a sibling page without type or layout, message unchanged', async () => {
            await buildValidSite()
            await fs.writeFile(path.join(cwd, 'pages', 'intro.md'), stack())
            await fs.writeFile(
                path.join(cwd, 'pages', 'draft.md'),
                '---\ntitle: Draft\n---\n'
            )
            const results = validateSite({ cwd })
            expect(results).toEqual([{
                file: 'pages/draft.md',
                line: 1,
                severity: 'warning',
                rule: 'layout-missing',
                message:
                    'page has no `layout` — the build skips it silently; add ' +
                    '`layout: pages/default.pug` to its frontmatter (a template in ' +
                    'theme/views), or, if it has none on purpose (a fragment or ' +
                    'draft), add `ignore: { layout-missing: [pages/draft.md] }` ' +
                    'to config/validate.yaml',
            }])
        })

        it('validates a stack page that has a layout like any page', async () => {
            await buildValidSite()
            await fs.writeFile(
                path.join(cwd, 'pages', 'intro.md'),
                stack('layout: pages/missing.pug\n')
            )
            const unresolved = validateSite({ cwd })
            expect(unresolved.map((r) => [r.rule, r.file])).toEqual([
                ['layout-unresolved', 'pages/intro.md'],
            ])

            await fs.writeFile(
                path.join(cwd, 'pages', 'intro.md'),
                stack('layout: pages/section.pug\n')
            )
            await fs.writeFile(
                path.join(cwd, 'theme', 'views', 'pages', 'section.pug'),
                'include ../partials/missing\n'
            )
            const include = validateSite({ cwd })
            expect(include.map((r) => [r.rule, r.file])).toEqual([
                ['include-unresolved', 'theme/views/pages/section.pug'],
            ])
        })

        it('stack layout counts toward the layout-missing example', async () => {
            await buildValidSite()
            for (const name of ['a', 'b']) {
                await fs.writeFile(
                    path.join(cwd, 'pages', `${name}.md`),
                    stack('layout: layouts/layout.pug\n')
                )
            }
            await fs.writeFile(path.join(cwd, 'pages', 'draft.md'), '---\ntitle: x\n---\n')
            const finding = validateSite({ cwd }).find((r) => r.rule === 'layout-missing')
            expect(finding.message).toContain('add `layout: layouts/layout.pug`')
        })

        it.each(['Stack', 'stacks', 'stack '])(
            'matches `type: stack` exactly — %j still warns',
            async (type) => {
                await buildValidSite()
                await fs.writeFile(
                    path.join(cwd, 'pages', 'intro.md'),
                    `---\ntype: "${type}"\n---\n`
                )
                expect(
                    validateSite({ cwd }).filter((r) => r.rule === 'layout-missing')
                        .map((r) => r.file)
                ).toEqual(['pages/intro.md'])
            }
        )
    })

    describe('date-invalid', () => {
        const page = (frontmatter) =>
            `---\nlayout: pages/default.pug\ntitle: Post\n${frontmatter}---\n# Post\n`

        async function dated(frontmatter) {
            await buildValidSite()
            await fs.writeFile(path.join(cwd, 'pages', 'post.md'), page(frontmatter))
            return validateSite({ cwd })
        }

        it('warns on a date that does not parse, on its line', async () => {
            const results = await dated('date: 25.10.2026\n')
            expect(results).toEqual([{
                file: 'pages/post.md',
                line: 4,
                severity: 'warning',
                rule: 'date-invalid',
                message:
                    '`date` "25.10.2026" is not a date — pages ordered or ' +
                    'printed by date get it wrong; write it as `YYYY-MM-DD`, ' +
                    'e.g. `date: 2026-10-25`',
            }])
            expect(hasErrors(results)).toBe(false)
        })

        it('checks createdAt too, each key on its own line', async () => {
            const results = await dated('createdAt: soon\ndate: [2026]\n')
            expect(results.map((r) => [r.rule, r.line, r.message.split(' — ')[0]]))
                .toEqual([
                    ['date-invalid', 4, '`createdAt` "soon" is not a date'],
                    ['date-invalid', 5, '`date` [2026] is not a date'],
                ])
        })

        it('catches a month or day out of range, which a YAML timestamp would roll over', async () => {
            const results = await dated('date: 2026-13-45\n')
            expect(results.map((r) => r.rule)).toEqual(['date-invalid'])
        })

        it.each([
            ['an unquoted YAML date', 'date: 2026-10-25\n'],
            ['a quoted ISO timestamp', 'createdAt: "2026-10-25T10:00:00+02:00"\n'],
            ['a date with a time', 'date: 2026-10-25 10:00\n'],
            ['an empty value (core falls back to the file date)', 'date:\ncreatedAt: ""\n'],
        ])('reports nothing for %s', async (_, frontmatter) => {
            expect(await dated(frontmatter)).toEqual([])
        })

        it('is silenced by ignore in config/validate.yaml', async () => {
            await buildValidSite()
            await fs.writeFile(
                path.join(cwd, 'config', 'validate.yaml'),
                'ignore:\n  date-invalid: [pages/post.md]\n'
            )
            await fs.writeFile(path.join(cwd, 'pages', 'post.md'), page('date: someday\n'))
            expect(validateSite({ cwd })).toEqual([])
        })
    })

    describe('messages', () => {
        // Every source-pass message says what to do: right after the ` — `
        // that ends the "what", or after a later `; `, an imperative from this
        // list starts the fix. A bare "x is wrong" message fails this.
        const FIX = / — (?:.*?; )?(?:add|create|fix|quote|delete|remove|use|write|put|list|set|run|install|update|point)\b/

        const write = async (rel, content) => {
            const abs = path.join(cwd, rel)
            await fs.mkdir(path.dirname(abs), { recursive: true })
            await fs.writeFile(abs, content)
        }

        const THEMED = 'name: Test\ntheme: ./my-theme\n'
        async function addTheme() {
            await write('config/app.yaml', THEMED)
            await write('my-theme/views/layouts/layout.pug', 'html\n  body\n    block content\n')
        }

        // One case per finding the source pass can produce: the files to
        // write over a valid site, and the rule and file it must report.
        const CASES = [
            ['yaml-parse in config/app.yaml', 'yaml-parse', 'config/app.yaml',
                { 'config/app.yaml': 'name: [unterminated\n' }],
            ['yaml-parse in frontmatter', 'yaml-parse', 'pages/bad.md',
                { 'pages/bad.md': '---\nlayout: pages/default.pug\ntitle: Note: read me\n---\n' }],
            ['yaml-parse in config/validate.yaml', 'yaml-parse', 'config/validate.yaml',
                { 'config/validate.yaml': 'ignore: [unclosed\n' }],
            ['theme-unresolved', 'theme-unresolved', 'config/app.yaml',
                { 'config/app.yaml': 'name: Test\ntheme: ./missing-theme\n' }],
            ['layout-missing', 'layout-missing', 'pages/draft.md',
                { 'pages/draft.md': '---\ntitle: Draft\n---\n' }],
            ['date-invalid', 'date-invalid', 'pages/post.md',
                { 'pages/post.md': '---\nlayout: pages/default.pug\ndate: someday\n---\n' }],
            ['layout-unresolved', 'layout-unresolved', 'pages/index.md',
                { 'pages/index.md': '---\nlayout: pages/missing.pug\n---\n' }],
            ['include-unresolved', 'include-unresolved', 'theme/views/layouts/layout.pug',
                { 'theme/views/layouts/layout.pug': 'html\n  head\n    include ../partials/missing\n' }],
            ['theme-shadowed', 'theme-shadowed', 'theme/views/layouts/layout.pug', {
                'config/app.yaml': THEMED,
                'my-theme/views/layouts/layout.pug': 'html\n  body\n    block content\n',
                'theme/views/layouts/layout.pug': '//- nera:scaffold-default\nhtml\n  body\n    block content\n',
            }],
            ['config-invalid: ignore not a mapping', 'config-invalid', 'config/validate.yaml',
                { 'config/validate.yaml': 'ignore: [pages]\n' }],
            ['config-invalid: ignore.<id> not a list', 'config-invalid', 'config/validate.yaml',
                { 'config/validate.yaml': 'ignore:\n  layout-missing: pages\n' }],
            ['config-invalid: unusable path', 'config-invalid', 'config/validate.yaml',
                { 'config/validate.yaml': 'ignore:\n  layout-missing: [/pages]\n' }],
        ]

        it.each(CASES)('%s says what to do, on one line', async (_, rule, file, files) => {
            await buildValidSite()
            for (const [rel, content] of Object.entries(files)) {
                await write(rel, content)
            }
            const finding = validateSite({ cwd })
                .find((r) => r.rule === rule && r.file === file)
            expect(finding).toBeDefined()
            expect(finding.message).toMatch(FIX)
            expect(finding.message).not.toContain('\n')
            expect(finding.message).toMatch(/^[a-z`]/)
            expect(finding.message).not.toMatch(/\.$/)
        })

        it('yaml-parse keeps the parser\'s first line and names the usual fix', async () => {
            await buildValidSite()
            await write('config/app.yaml', 'name: [unterminated\n')
            const finding = validateSite({ cwd }).find((r) => r.rule === 'yaml-parse')
            expect(finding.message).toContain('config could not be parsed: ')
            expect(finding.message).toContain('at line 2, column 1 — fix the YAML at that line')
            expect(finding.message).toContain('quote a value that contains `: `')
        })

        it('yaml-parse in frontmatter names the file line, not the YAML line', async () => {
            await buildValidSite()
            await write('pages/bad.md', '---\nlayout: pages/default.pug\ntitle: Note: read me\n---\n')
            const finding = validateSite({ cwd }).find((r) => r.rule === 'yaml-parse')
            expect(finding.line).toBe(3)
            expect(finding.message).toContain('frontmatter YAML: ')
            expect(finding.message).toContain('at line 3,')
            expect(finding.message).toContain('fix the YAML at that line')
        })

        it('theme-unresolved passes core\'s text through, with its fix once', async () => {
            const dashes = (message) => message.split(' — ').length - 1

            await buildValidSite()
            await write('config/app.yaml', 'name: Test\ntheme: ./missing-theme\n')
            const local = validateSite({ cwd }).find((r) => r.rule === 'theme-unresolved')
            expect(local.message).toContain(
                'has no views/ folder — point `theme:` in config/app.yaml'
            )
            expect(dashes(local.message)).toBe(1)

            await write('config/app.yaml', 'name: Test\ntheme: no-such-theme-xyz\n')
            const pkg = validateSite({ cwd }).find((r) => r.rule === 'theme-unresolved')
            expect(pkg.message).toContain(
                'run `npm install @nera-static/theme-no-such-theme-xyz`'
            )
            expect(dashes(pkg.message)).toBe(1)
        })

        it('layout-missing names the most-used layout and the ignore entry', async () => {
            await buildValidSite()
            await write('pages/draft.md', '---\ntitle: Draft\n---\n')
            const finding = validateSite({ cwd }).find((r) => r.rule === 'layout-missing')
            expect(finding.message).toContain('the build skips it silently')
            expect(finding.message).toContain('add `layout: pages/default.pug` to its frontmatter')
            expect(finding.message).toContain('(a template in theme/views)')
            expect(finding.message).toContain(
                '`ignore: { layout-missing: [pages/draft.md] }` to config/validate.yaml'
            )
        })

        it('layout-missing without any working layout gives no example', async () => {
            await buildValidSite()
            await write('pages/index.md', '---\ntitle: Home\n---\n')
            await addTheme()
            const finding = validateSite({ cwd }).find((r) => r.rule === 'layout-missing')
            expect(finding.message).toContain('add a `layout:` key to its frontmatter')
            expect(finding.message).toContain('(a template in theme/views or my-theme/views)')
        })

        it('layout-unresolved lists the files looked for and the one to create', async () => {
            await buildValidSite()
            await write('pages/index.md', '---\nlayout: pages/missing.pug\n---\n')
            const plain = validateSite({ cwd }).find((r) => r.rule === 'layout-unresolved')
            expect(plain.message).toContain(
                'layout "pages/missing.pug" not found in views — looked for ' +
                'theme/views/pages/missing.pug; create it, or fix `layout`'
            )

            await addTheme()
            await write('pages/index.md', '---\nlayout: pages/missing.pug\n---\n')
            const themed = validateSite({ cwd }).find((r) => r.rule === 'layout-unresolved')
            expect(themed.message).toContain('not found in views or theme')
            expect(themed.message).toContain(
                'looked for theme/views/pages/missing.pug, my-theme/views/pages/missing.pug; ' +
                'create theme/views/pages/missing.pug'
            )
        })

        // The build hands the layout path to pug.compileFile as is, which fails
        // on `pages/default` even when `pages/default.pug` exists.
        it('an extensionless layout is unresolved, with the extension as the fix', async () => {
            await buildValidSite()
            await write('pages/index.md', '---\nlayout: pages/default\n---\n')
            const existing = validateSite({ cwd }).find((r) => r.rule === 'layout-unresolved')
            expect(existing.message).toContain(
                'looked for theme/views/pages/default; add the extension, ' +
                '`layout: pages/default.pug`, since the build does not append `.pug` to a layout'
            )
            expect(existing.message).not.toContain('and create')

            await write('pages/index.md', '---\nlayout: pages/missing\n---\n')
            const missing = validateSite({ cwd }).find((r) => r.rule === 'layout-unresolved')
            expect(missing.message).toContain(', and create theme/views/pages/missing.pug')
        })

        it('a theme whose views are the site\'s own lists each file once', async () => {
            await buildValidSite()
            await write('config/app.yaml', 'name: Test\ntheme: ./theme\n')
            await write('pages/other.md', '---\nlayout: pages/missing.pug\n---\n')
            await write('theme/views/layouts/layout.pug', 'html\n  head\n    include ../partials/missing.pug\n')
            const results = validateSite({ cwd })
            expect(results.find((r) => r.rule === 'layout-unresolved').message).toContain(
                'looked for theme/views/pages/missing.pug; create it'
            )
            expect(results.find((r) => r.rule === 'include-unresolved').message).toContain(
                'looked for theme/views/partials/missing.pug; create it'
            )
        })

        it('include-unresolved lists the files looked for and the one to create', async () => {
            await buildValidSite()
            await write('theme/views/layouts/layout.pug', 'html\n  head\n    include ../partials/missing.pug\n')
            const plain = validateSite({ cwd }).find((r) => r.rule === 'include-unresolved')
            expect(plain.message).toContain(
                'include/extends target "../partials/missing.pug" does not resolve — ' +
                'looked for theme/views/partials/missing.pug; create it, or fix the path'
            )

            await addTheme()
            await write('theme/views/layouts/layout.pug', 'html\n  head\n    include ../partials/missing\n')
            const themed = validateSite({ cwd }).find((r) => r.rule === 'include-unresolved')
            expect(themed.message).toContain('does not resolve')
            expect(themed.message).toContain(
                'looked for theme/views/partials/missing.pug, my-theme/views/partials/missing.pug; ' +
                'create theme/views/partials/missing.pug'
            )
            expect(themed.message).toContain('a leading `/` starts at theme/views')
        })

        // Pug appends `.pug` to an extensionless include before resolving, so
        // a partial only the theme has resolves through the layered chain.
        it('an extensionless include found only in the theme resolves', async () => {
            await buildValidSite()
            await addTheme()
            await write('my-theme/views/partials/nav.pug', 'nav\n')
            await write('theme/views/layouts/layout.pug', 'html\n  head\n    include ../partials/nav\n')
            expect(validateSite({ cwd }).filter((r) => r.rule === 'include-unresolved')).toEqual([])
        })

        it('config-invalid for ignore shows the correct form', async () => {
            await buildValidSite()
            await write('config/validate.yaml', 'ignore: [pages]\n')
            const [notMap] = validateSite({ cwd }).filter((r) => r.rule === 'config-invalid')
            expect(notMap.message).toContain(
                'write it as `ignore: { layout-missing: [pages/drafts] }`'
            )

            await write('config/validate.yaml', 'ignore:\n  a11y-h1: public/tags\n')
            const [notList] = validateSite({ cwd }).filter((r) => r.rule === 'config-invalid')
            expect(notList.message).toContain('write it as `a11y-h1: [pages/drafts]`')
        })
    })
})
