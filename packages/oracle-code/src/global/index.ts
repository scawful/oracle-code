import fs from "fs/promises"
import { xdgData, xdgCache, xdgConfig, xdgState } from "xdg-basedir"
import path from "path"
import os from "os"

const app = "ocode"

// Legacy app names for migration
const LEGACY_APPS = ["codewizard", "opencode"]

const data = path.join(xdgData!, app)
const cache = path.join(xdgCache!, app)
const config = path.join(xdgConfig!, app)
const state = path.join(xdgState!, app)

export namespace Global {
  export const Path = {
    home: os.homedir(),
    data,
    bin: path.join(data, "bin"),
    log: path.join(data, "log"),
    cache,
    config,
    state,
  } as const

  /**
   * Get the original working directory.
   * When running via bun --cwd, process.cwd() returns the --cwd path.
   * OCODE_CWD is set by the wrapper script to preserve the user's original directory.
   */
  export function cwd(): string {
    return process.env["OCODE_CWD"] || process.cwd()
  }
}

await Promise.all([
  fs.mkdir(Global.Path.data, { recursive: true }),
  fs.mkdir(Global.Path.config, { recursive: true }),
  fs.mkdir(Global.Path.state, { recursive: true }),
  fs.mkdir(Global.Path.log, { recursive: true }),
  fs.mkdir(Global.Path.bin, { recursive: true }),
])

// Migrate auth.json from legacy app locations if it doesn't exist in new location
async function migrateAuth() {
  const newAuthPath = path.join(Global.Path.data, "auth.json")

  // Check if auth already exists in new location
  try {
    await fs.access(newAuthPath)
    return // Already exists, no migration needed
  } catch {
    // File doesn't exist, try to migrate
  }

  // Try each legacy location
  for (const legacyApp of LEGACY_APPS) {
    const legacyPath = path.join(xdgData!, legacyApp, "auth.json")
    try {
      const content = await fs.readFile(legacyPath, "utf-8")
      await fs.writeFile(newAuthPath, content)
      await fs.chmod(newAuthPath, 0o600)
      console.log(`Migrated auth from ${legacyApp} to ${app}`)
      return
    } catch {
      // Legacy file doesn't exist, try next
    }
  }
}

await migrateAuth()

const CACHE_VERSION = "14"

const version = await Bun.file(path.join(Global.Path.cache, "version"))
  .text()
  .catch(() => "0")

if (version !== CACHE_VERSION) {
  try {
    const contents = await fs.readdir(Global.Path.cache)
    await Promise.all(
      contents.map((item) =>
        fs.rm(path.join(Global.Path.cache, item), {
          recursive: true,
          force: true,
        }),
      ),
    )
  } catch (e) {}
  await Bun.file(path.join(Global.Path.cache, "version")).write(CACHE_VERSION)
}
