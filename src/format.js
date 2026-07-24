// Human-readable formatting for `validateSite` results, shared by this package's
// `nera-validate` bin and the `nera validate` subcommand so their output agrees.

const COLORS = {
    error: '\x1b[31m', // red
    warning: '\x1b[33m', // yellow
    reset: '\x1b[0m',
    dim: '\x1b[2m',
}

const useColor = () => process.stdout.isTTY && !process.env.NO_COLOR

const paint = (text, color) =>
    useColor() ? `${color}${text}${COLORS.reset}` : text

// Render results grouped by file, most findings first, with a summary line.
// Returns the full string (the caller prints it) so it stays testable.
export function formatResults(results) {
    if (results.length === 0) {
        return paint('✓ No problems found.', COLORS.dim)
    }

    const byFile = new Map()
    for (const r of results) {
        if (!byFile.has(r.file)) byFile.set(r.file, [])
        byFile.get(r.file).push(r)
    }

    const out = []
    for (const [file, items] of byFile) {
        out.push(paint(file, COLORS.dim))
        for (const r of items) {
            const loc = r.line != null ? `:${r.line}` : ''
            const label = paint(
                r.severity,
                r.severity === 'error' ? COLORS.error : COLORS.warning
            )
            out.push(`  ${loc.padEnd(5)} ${label}  ${r.message}  ${paint(r.rule, COLORS.dim)}`)
        }
    }

    const errors = results.filter((r) => r.severity === 'error').length
    const warnings = results.length - errors
    out.push('')
    out.push(`${errors} error(s), ${warnings} warning(s)`)
    return out.join('\n')
}
