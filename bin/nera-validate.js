#!/usr/bin/env node
import { validateSite, hasErrors, formatResults } from '../index.js'

// Validate the site in the current working directory. Exit 1 when there is any
// error (warnings alone do not fail, so it is safe as an advisory CI gate).
try {
    const results = validateSite({ cwd: process.cwd() })
    console.log(formatResults(results))
    process.exit(hasErrors(results) ? 1 : 0)
} catch (error) {
    console.error('❌', error.message)
    process.exit(1)
}
