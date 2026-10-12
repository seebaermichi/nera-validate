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

    it('errors on malformed config/app.yaml', async () => {
        await buildValidSite()
        await fs.writeFile(
            path.join(cwd, 'config', 'app.yaml'),
            'name: [unterminated\n'
        )
        const results = validateSite({ cwd })

        const finding = results.find(
            (r) => r.rule === 'yaml-parse' && r.file === 'config/app.yaml'
        )
        expect(finding).toBeDefined()
        expect(finding.severity).toBe('error')
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

    describe('messages', () => {
        // Every source-pass message says what to do: right after the ` — `
        // that ends the "what", or after a later `; `, an imperative from this
        // list starts the fix. A bare "x is wrong" message fails this.
        const FIX = / — (?:.*?; )?(?:add|create|fix|quote|delete|remove|use|write|put|list|set|run|install|update)\b/

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

        it('theme-unresolved adds a fix only where core\'s text has none', async () => {
            await buildValidSite()
            await write('config/app.yaml', 'name: Test\ntheme: ./missing-theme\n')
            const local = validateSite({ cwd }).find((r) => r.rule === 'theme-unresolved')
            expect(local.message).toContain('does not exist — fix `theme:` in config/app.yaml')

            await write('config/app.yaml', 'name: Test\ntheme: no-such-theme-xyz\n')
            const pkg = validateSite({ cwd }).find((r) => r.rule === 'theme-unresolved')
            expect(pkg.message).toContain('npm install @nera-static/theme-no-such-theme-xyz')
            expect(pkg.message).not.toContain('fix `theme:`')
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
