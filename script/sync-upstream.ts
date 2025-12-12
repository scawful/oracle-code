#!/usr/bin/env bun

import { $ } from "bun"

const UPSTREAM_URL = "https://github.com/sst/opencode.git"

console.log("=== Checking Upstream Parity ===\n")

// 1. Ensure upstream remote exists
let remotes = await $`git remote -v`.text()
if (!remotes.includes("upstream")) {
  console.log("Adding upstream remote:", UPSTREAM_URL)
  await $`git remote add upstream ${UPSTREAM_URL}`
}

// 2. Fetch upstream
console.log("Fetching upstream...")
await $`git fetch upstream`

// 3. Compare packages/oracle-code (local) vs packages/opencode (upstream)
// We look for commits in upstream/dev that touch packages/opencode
// and are not strictly in our history (though due to fork/rename, almost all will show up unless we track them)
// A better simple check: List commits to packages/opencode in the last 2 weeks from upstream

const since = "2 weeks ago"
console.log(`\n--- Recent Upstream Commits to packages/opencode (since ${since}) ---\n`)

try {
  const log = await $`git log --oneline --since="${since}" upstream/dev -- packages/opencode`.text()
  if (log.trim()) {
    console.log(log)
    console.log("\n[!] There are recent changes in upstream packages/opencode.")
    console.log("    Review them to see if they need to be ported to packages/oracle-code.")
  } else {
    console.log("No recent changes found in upstream packages/opencode.")
  }
} catch (e) {
    console.error("Failed to check upstream logs. Make sure upstream/dev exists.")
}

console.log("\n=== Done ===")
