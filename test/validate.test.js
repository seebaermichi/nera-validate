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
})
