import { findOne } from 'domutils'

// The rule catalogue for `validateOutput` (ROADMAP-compliance.md). Each rule
// gets one parsed page and returns `{ line, message }` hits; the caller adds
// file, source and the configured severity. Rule ids are stable once released —
// the platform keys on them — and `level` is the default when
// config/validate.yaml says nothing (`warning`, or `off` for opt-in rules).
export const OUTPUT_RULES = [
    {
        id: 'a11y-html-lang',
        level: 'warning',
        check({ document, lineOf }) {
            const html = findOne((el) => el.name === 'html', document.children)
            if (!html) {
                return [{
                    line: null,
                    message:
                        'page has no `<html>` element to carry a `lang` — ' +
                        'screen readers cannot tell its language (WCAG 3.1.1)',
                }]
            }
            if (html.attribs.lang?.trim()) return []
            return [{
                line: lineOf(html),
                message:
                    `\`<html>\` has ${'lang' in html.attribs ? 'an empty' : 'no'} ` +
                    '`lang` — screen readers cannot tell the page language ' +
                    '(WCAG 3.1.1)',
            }]
        },
    },
]
