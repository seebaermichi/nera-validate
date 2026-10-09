import fssync from 'fs'
import path from 'path'

// Recursively collect files with the given extension under a directory
// (absolute paths). A missing directory yields an empty list.
export function walkFiles(dir, ext) {
    const out = []
    let entries
    try {
        entries = fssync.readdirSync(dir, { withFileTypes: true })
    } catch {
        return out
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) out.push(...walkFiles(full, ext))
        else if (entry.name.endsWith(ext)) out.push(full)
    }
    return out
}
