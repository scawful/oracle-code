import fs from "fs"
import path from "path"
import { Log } from "./util/log"

const log = Log.create({ service: "instance-lock" })

const LOCK_FILE = ".oracle-code.lock"

interface LockInfo {
  pid: number
  startTime: number
  directory: string
  version?: string
}

/**
 * Instance locking to prevent multiple oracle-code processes
 * from running in the same directory.
 *
 * This prevents:
 * - File watcher conflicts on .context/
 * - State file race conditions
 * - Memory explosion from cascading refresh loops
 */
export namespace InstanceLock {
  /**
   * Acquire the instance lock for a directory.
   * Returns true if lock acquired, false if another instance holds it.
   */
  export function acquire(directory: string): boolean {
    const lockPath = getLockPath(directory)

    // Check for existing lock
    const existing = check(directory)
    if (existing) {
      log.warn("lock already held", { pid: existing.pid, directory })
      return false
    }

    // Create lock file
    const lockInfo: LockInfo = {
      pid: process.pid,
      startTime: Date.now(),
      directory,
    }

    // Ensure .context exists
    const contextDir = path.join(directory, ".context")
    if (!fs.existsSync(contextDir)) {
      fs.mkdirSync(contextDir, { recursive: true })
    }

    fs.writeFileSync(lockPath, JSON.stringify(lockInfo, null, 2))
    log.info("lock acquired", { pid: process.pid, directory })

    // Register cleanup handlers
    const cleanup = () => release(directory)
    process.on("exit", cleanup)
    process.on("SIGINT", () => {
      cleanup()
      process.exit(130)
    })
    process.on("SIGTERM", () => {
      cleanup()
      process.exit(143)
    })
    process.on("uncaughtException", (err) => {
      log.error("uncaught exception, releasing lock", { error: err.message })
      cleanup()
      throw err
    })

    return true
  }

  /**
   * Release the instance lock.
   * Only releases if we own it (same PID).
   */
  export function release(directory: string): void {
    const lockPath = getLockPath(directory)

    if (!fs.existsSync(lockPath)) return

    const content = fs.readFileSync(lockPath, "utf-8")
    const lock: LockInfo = JSON.parse(content)

    // Only remove if we own it
    if (lock.pid === process.pid) {
      fs.unlinkSync(lockPath)
      log.info("lock released", { pid: process.pid, directory })
    }
  }

  /**
   * Check if a lock exists and is valid (held by a running process).
   * Returns lock info if valid, null if no lock or stale.
   */
  export function check(directory: string): LockInfo | null {
    const lockPath = getLockPath(directory)

    if (!fs.existsSync(lockPath)) return null

    const content = fs.readFileSync(lockPath, "utf-8")
    const lock: LockInfo = JSON.parse(content)

    // Verify process is alive
    if (!isProcessAlive(lock.pid)) {
      // Stale lock - clean it up
      log.info("removing stale lock", { pid: lock.pid, directory })
      fs.unlinkSync(lockPath)
      return null
    }

    return lock
  }

  /**
   * Format a user-friendly error message for lock conflicts
   */
  export function formatLockError(lock: LockInfo): string {
    const startedAt = new Date(lock.startTime).toLocaleString()
    const elapsed = formatElapsed(Date.now() - lock.startTime)

    return `
┌─────────────────────────────────────────────────────────────┐
│  Another oracle-code instance is already running            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Directory: ${lock.directory.slice(0, 45).padEnd(45)}│
│  PID:       ${String(lock.pid).padEnd(45)}│
│  Started:   ${startedAt.padEnd(45)}│
│  Running:   ${elapsed.padEnd(45)}│
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  Options:                                                   │
│                                                             │
│  • Switch to the existing terminal window                   │
│  • Use panes within that instance:                          │
│      Ctrl+X then w / → split vertical                       │
│      Ctrl+X then w - → split horizontal                     │
│  • Kill the other process: kill ${String(lock.pid).padEnd(27)}│
│                                                             │
└─────────────────────────────────────────────────────────────┘
`
  }

  function getLockPath(directory: string): string {
    return path.join(directory, ".context", LOCK_FILE)
  }

  function isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0) // Signal 0 = check if alive
      return true
    } catch {
      return false
    }
  }

  function formatElapsed(ms: number): string {
    const seconds = Math.floor(ms / 1000)
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ${seconds % 60}s`
    const hours = Math.floor(minutes / 60)
    return `${hours}h ${minutes % 60}m`
  }
}
