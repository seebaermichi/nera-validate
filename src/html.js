import { parseDocument } from 'htmlparser2'

// Parse a built HTML file into a DOM whose nodes carry `startIndex`, plus a
// `lineOf(node)` that turns that offset into a 1-based line. Core runs its
// output through `pretty`, so these lines are the ones a reader sees.
export function parseHtml(source) {
    const document = parseDocument(source, { withStartIndices: true })

    // Offsets at which each line begins, for a binary search per lookup.
    const lineStarts = [0]
    for (let i = 0; i < source.length; i++) {
        if (source[i] === '\n') lineStarts.push(i + 1)
    }

    const lineOf = (node) => {
        const offset = node?.startIndex
        if (offset == null) return null
        let lo = 0
        let hi = lineStarts.length - 1
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1
            if (lineStarts[mid] <= offset) lo = mid
            else hi = mid - 1
        }
        return lo + 1
    }

    return { document, lineOf }
}
