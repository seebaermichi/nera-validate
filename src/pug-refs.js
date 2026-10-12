import fssync from 'fs'
import path from 'path'
import { makeLayeredResolver } from '@nera-static/core'

const rel = (cwd, abs) => path.relative(cwd, abs).split(path.sep).join('/')

// Resolve a pug `include`/`extends` target the way the build does: through the
// layered resolver (site view root then theme), then — because pug appends
// `.pug` to an extensionless target — try the `.pug` form. A filtered or
// already-extensioned target (`include:markdown-it x.md`) is checked as written.
// Returns the resolved absolute path, or null if nothing exists.
export function resolveTarget(rawTarget, sourceFile, roots) {
    const resolver = makeLayeredResolver(roots)
    const resolved = resolver(rawTarget, sourceFile, { basedir: roots[0] })
    const candidates = path.extname(resolved)
        ? [resolved]
        : [resolved, `${resolved}.pug`]
    return candidates.find((p) => fssync.existsSync(p)) || null
}

// `include-unresolved`: the files resolveTarget looked for, for the message
// only — the verdict is resolveTarget's. The layered resolver tries the
// target's path below each view root (site views first, then the theme's); for
// an extensionless target, resolveTarget then tries the `.pug` form of what it
// returned. That last file (or, for a target with an extension, the site's
// copy) is the one to create.
function unresolvedMessage(rawTarget, sourceFile, roots, cwd) {
    const resolved = makeLayeredResolver(roots)(
        rawTarget, sourceFile, { basedir: roots[0] }
    )
    const root = roots.find((r) => {
        const inside = path.relative(r, resolved)
        return !inside.startsWith('..') && !path.isAbsolute(inside)
    })
    const looked = root
        ? roots.map((r) => path.join(r, path.relative(root, resolved)))
        : [resolved]
    const own = path.extname(resolved) ? looked[0] : `${resolved}.pug`
    if (own !== looked[0]) looked.push(own)
    const create = looked.length > 1 ? rel(cwd, own) : 'it'
    return `include/extends target "${rawTarget}" does not resolve — looked ` +
        `for ${looked.map((abs) => rel(cwd, abs)).join(', ')}; create ` +
        `${create}, or fix the path (relative to this file; a leading \`/\` ` +
        `starts at ${rel(cwd, roots[0])})`
}

// Matches `include foo`, `include:filter foo`, and `extends foo`, capturing the
// target path. Pug directives sit at the start of a (possibly indented) line.
const INCLUDE_RE = /^\s*(?:include(?::[^\s]+)?|extends)\s+(.+?)\s*$/

// Walk a pug file's include/extends graph, pushing an `include-unresolved`
// finding for every target that does not resolve. `visited` is shared across the
// whole run so each pug file — and each unresolved reference — is reported once,
// no matter how many pages share the layout, and cycles terminate.
export function collectIncludeFindings(entryFile, roots, cwd, visited, findings) {
    if (visited.has(entryFile)) return
    visited.add(entryFile)

    let src
    try {
        src = fssync.readFileSync(entryFile, 'utf-8')
    } catch {
        return
    }

    src.split(/\r?\n/).forEach((line, i) => {
        const match = line.match(INCLUDE_RE)
        if (!match) return

        const target = match[1]
        const resolved = resolveTarget(target, entryFile, roots)
        if (!resolved) {
            findings.push({
                file: rel(cwd, entryFile),
                line: i + 1,
                severity: 'error',
                rule: 'include-unresolved',
                message: unresolvedMessage(target, entryFile, roots, cwd),
            })
            return
        }

        // Only pug templates have their own includes to follow.
        if (path.extname(resolved) === '.pug') {
            collectIncludeFindings(resolved, roots, cwd, visited, findings)
        }
    })
}
