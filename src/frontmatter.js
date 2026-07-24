// Frontmatter helpers. A Nera page is `---\n<yaml>\n---\n<body>`; the build reads
// it via markdown-it-meta. Here we extract the same leading fence so its YAML can
// be parsed for errors and required keys, with file-accurate line numbers.

// Return the frontmatter YAML text and the file line it starts on (line 2, after
// the opening `---`), or null when the file has no leading fence.
export function extractFrontmatter(raw) {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
    if (!match) return null
    return { text: match[1], startLine: 2 }
}

// The 1-based file line of a top-level frontmatter key (`layout:`), or null if
// the file has no fence or the key is absent. Used to anchor a finding at the
// offending line rather than the top of the file.
export function frontmatterKeyLine(raw, key) {
    const lines = raw.split(/\r?\n/)
    if (lines[0]?.trim() !== '---') return null

    const keyRe = new RegExp(`^${key}\\s*:`)
    for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === '---') break
        if (keyRe.test(lines[i])) return i + 1
    }
    return null
}
