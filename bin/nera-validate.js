#!/usr/bin/env node
import {
    validateSite,
    validateOutput,
    hasErrors,
    formatResults,
    formatOutputResults,
} from '../index.js'

// Validate the site in the current working directory. Exit 1 when there is any
// error (warnings alone do not fail, so it is safe as an advisory CI gate).
// `--output` checks the built output in public/ instead of the sources — the
// pass `nera check` runs; this bin has no verbs, so it is a flag here.
try {
    if (process.argv.slice(2).includes('--output')) {
        const results = validateOutput({ cwd: process.cwd() })
        console.log(formatOutputResults(results))
        process.exit(hasErrors(results) ? 1 : 0)
    }
    const results = validateSite({ cwd: process.cwd() })
    console.log(formatResults(results))
    process.exit(hasErrors(results) ? 1 : 0)
} catch (error) {
    console.error('❌', error.message)
    process.exit(1)
}
