import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'path'
import fs from 'fs/promises'
import os from 'os'
import { validateSite, hasErrors } from '../index.js'

let cwd

const write = async (file, text) => {
    const abs = path.join(cwd, file)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, text)
}

// A minimal valid thin Nera site with a `data/themes.yaml` no page names yet.
async function buildSite() {
    await write('config/app.yaml', 'name: Test\nlang: en\n')
    await write('pages/index.md', '---\nlayout: pages/default.pug\ntitle: Home\n---\n# Hello\n')
    await write('theme/views/layouts/layout.pug', 'html\n  body\n    block content\n')
    await write('theme/views/pages/default.pug',
        'extends ../layouts/layout\n\nblock content\n  main !{ content }\n')
    await write('data/themes.yaml', '- name: Nera\n')
}

// A page at `pages/<name>.md` whose frontmatter carries `lines` after the
// layout (line 2), so the first of them is file line 3.
const page = (name, ...lines) => write(`pages/${name}.md`,
    `---\nlayout: pages/default.pug\n${lines.join('\n')}\n---\n# ${name}\n`)

const pageDataFindings = () =>
    validateSite({ cwd }).filter((r) => r.rule.startsWith('page-data-'))

beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'nera-validate-page-data-'))
    await buildSite()
})

afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true })
})

describe('page_data references', () => {
    it('changes nothing for a site whose pages do not set page_data', async () => {
        // data/ holds a broken file, but no page names it, so nothing reads it.
        await write('data/broken.yaml', 'a: [1, 2\n')
        expect(validateSite({ cwd })).toEqual([])
    })

    it('accepts a name and a list of names that exist', async () => {
        await write('data/links.yml', 'home: /\n')
        await write('data/lists/tools.yaml', '- vite\n')
        await page('one', 'page_data: themes')
        await page('two', 'page_data:', '  - themes', '  - links', '  - lists/tools', '  - ./themes')
        expect(validateSite({ cwd })).toEqual([])
    })

    it('treats an empty or comment-only data file as valid', async () => {
        await write('data/empty.yaml', '')
        await write('data/comments.yaml', '# nothing yet\n')
        await page('one', 'page_data: [empty, comments]')
        expect(validateSite({ cwd })).toEqual([])
    })

    it('tries .yaml before .yml', async () => {
        // themes.yaml is valid, so a broken themes.yml is never read.
        await write('data/themes.yml', 'a: [1, 2\n')
        await page('one', 'page_data: themes')
        expect(pageDataFindings()).toEqual([])
    })

    it.each([
        ['a number', 'page_data: 42', '42'],
        ['a mapping', 'page_data: { name: themes }', '{"name":"themes"}'],
        ['empty', 'page_data:', 'null'],
    ])('reports page-data-type when the value is %s', async (_, line, shown) => {
        await page('one', 'title: One', line)
        const results = pageDataFindings()
        expect(results).toHaveLength(1)
        expect(results[0]).toMatchObject({
            file: 'pages/one.md', line: 4, severity: 'error', rule: 'page-data-type',
        })
        expect(results[0].message).toContain(`got ${shown}`)
        expect(results[0].message).toContain('`page_data: themes`')
    })

    it('reports page-data-type per list entry that is not a name, and checks the rest', async () => {
        await page('one', 'page_data: [themes, 7, "", nope]')
        const results = pageDataFindings()
        expect(results.map((r) => [r.rule, r.line])).toEqual([
            ['page-data-type', 3],
            ['page-data-type', 3],
            ['page-data-missing', 3],
        ])
        expect(results[0].message).toContain('entry 7 is not a data file name')
        expect(results[1].message).toContain('entry "" is not a data file name')
        expect(hasErrors(results)).toBe(true)
    })

    it('reports page-data-missing at the key line, naming the .yaml it looked for', async () => {
        await page('one', 'title: One', 'page_data: themez')
        expect(pageDataFindings()).toEqual([{
            file: 'pages/one.md',
            line: 4,
            severity: 'error',
            rule: 'page-data-missing',
            message: '`page_data` names "themez", but data/themez.yaml does not ' +
                'exist (nor its `.yml`) — the page builds without that data; ' +
                'create data/themez.yaml or fix the name',
        }])
    })

    it('reports a name listed twice once', async () => {
        await page('one', 'page_data: [themez, " themez "]')
        expect(pageDataFindings()).toHaveLength(1)
    })

    it.each([
        ['a ".." segment', '../config/app'],
        ['a nested ".." segment', 'lists/../../secret'],
        ['an absolute path', '/etc/hosts'],
        ['the data folder itself', '.'],
    ])('reports page-data-missing for %s, outside the data folder', async (_, name) => {
        await page('one', `page_data: "${name}"`)
        const results = pageDataFindings()
        expect(results).toHaveLength(1)
        expect(results[0]).toMatchObject({ rule: 'page-data-missing', line: 3 })
        expect(results[0].message).toContain('outside the data folder data/')
        expect(results[0].message).toContain('the plugin refuses it')
    })

    it('reports page-data-invalid once per data file, at the parser line, for two pages', async () => {
        await write('data/broken.yaml', 'ok: 1\nbad: a: b\nmore: 2\n')
        await page('one', 'page_data: broken')
        await page('two', 'page_data: [broken]')
        const results = pageDataFindings()
        expect(results).toHaveLength(1)
        expect(results[0]).toMatchObject({
            file: 'data/broken.yaml', line: 2, severity: 'error', rule: 'page-data-invalid',
        })
        expect(results[0].message).toContain('invalid YAML in a data file named in `page_data`')
        expect(results[0].message).toContain('Nested mappings are not allowed')
        expect(results[0].message).toContain('fix the YAML at that line')
    })

    it('reports page-data-invalid without a line for a directory named like a data file', async () => {
        await fs.mkdir(path.join(cwd, 'data', 'folder.yaml'))
        await write('data/folder.yml', 'a: 1\n')
        await page('one', 'page_data: folder')
        expect(pageDataFindings()).toEqual([expect.objectContaining({
            file: 'data/folder.yaml', line: null, rule: 'page-data-invalid',
        })])
    })

    it('checks layout-less pages, but not a page whose frontmatter does not parse', async () => {
        await write('pages/fragment.md', '---\ntype: stack\npage_data: nope\n---\n')
        await write('pages/broken.md', '---\npage_data: nope\ntitle: [\n---\n')
        const results = validateSite({ cwd })
        expect(results.filter((r) => r.rule === 'page-data-missing')
            .map((r) => r.file)).toEqual(['pages/fragment.md'])
        expect(results.some((r) => r.file === 'pages/broken.md' &&
            r.rule === 'yaml-parse')).toBe(true)
    })

    it('reads the data folder from folders.data in config/app.yaml', async () => {
        await write('config/app.yaml', 'name: Test\nlang: en\nfolders:\n  data: content/data\n')
        await write('content/data/menu.yaml', '- home\n')
        await page('one', 'page_data: [menu, themes]')
        const results = pageDataFindings()
        expect(results).toHaveLength(1)
        expect(results[0].message).toContain('content/data/themes.yaml does not exist')
    })

    it('falls back to data when folders.data is not a usable name', async () => {
        await write('config/app.yaml', 'name: Test\nlang: en\nfolders:\n  data: ""\n')
        await page('one', 'page_data: themes')
        expect(pageDataFindings()).toEqual([])
    })

    it('reads the key from frontmatter_key in config/page-data.yaml', async () => {
        await write('config/page-data.yaml', 'frontmatter_key: sources\n')
        await page('one', 'page_data: nope', 'sources: themez')
        const results = pageDataFindings()
        expect(results).toHaveLength(1)
        expect(results[0]).toMatchObject({ rule: 'page-data-missing', line: 4 })
        expect(results[0].message).toMatch(/^`sources` names "themez"/)
    })

    it('keeps the default key when frontmatter_key is not usable', async () => {
        await write('config/page-data.yaml', 'frontmatter_key: 3\n')
        await page('one', 'page_data: themez')
        expect(pageDataFindings()).toHaveLength(1)
    })

    it('honours ignore: for each rule', async () => {
        await write('data/broken.yaml', 'a: [1, 2\n')
        await page('one', 'page_data: [themez, 4, broken]')
        await write('config/validate.yaml', [
            'ignore:',
            '  page-data-missing: [pages/one.md]',
            '  page-data-type: [pages]',
            '  page-data-invalid: [data/broken.yaml]',
        ].join('\n') + '\n')
        expect(validateSite({ cwd })).toEqual([])
    })
})
