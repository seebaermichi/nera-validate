import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'path'
import fs from 'fs/promises'
import os from 'os'
import { validateOutput, hasErrors, formatResults } from '../index.js'

let cwd

// A page the way core writes it (run through `pretty`), with or without `lang`.
const page = (htmlAttrs = ' lang="en"') =>
    `<!DOCTYPE html>\n<html${htmlAttrs}>\n  <head>\n    <title>T</title>\n  </head>\n  <body>\n    <main>Hi</main>\n  </body>\n</html>\n`

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
