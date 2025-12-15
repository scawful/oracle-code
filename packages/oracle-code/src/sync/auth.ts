/**
 * Sync Authentication
 *
 * Manages sync tokens for halext backend communication.
 * Tokens are stored locally in .context/scratchpad/sync-config.json
 */

import fs from "fs/promises"
import path from "path"
import { z } from "zod"
import { AFS } from "../afs"

// =============================================================================
// SCHEMAS
// =============================================================================

export const SyncConfig = z.object({
  endpoint: z.string().url().optional(),
  token: z.string().optional(),
  tokenName: z.string().optional(),
  deviceId: z.string().optional(),
  lastSync: z.string().optional(),
  enabled: z.boolean().default(false),
})
export type SyncConfig = z.infer<typeof SyncConfig>

// =============================================================================
// AUTH NAMESPACE
// =============================================================================

export namespace SyncAuth {
  const CONFIG_FILE = "sync-config.json"

  function getConfigPath(root: string): string {
    return path.join(root, "scratchpad", CONFIG_FILE)
  }

  /**
   * Load sync configuration from AFS
   */
  export async function load(root?: string): Promise<SyncConfig> {
    const contextRoot = root ?? (await AFS.findRoot())
    if (!contextRoot) {
      return SyncConfig.parse({})
    }

    const configPath = getConfigPath(contextRoot)
    try {
      const content = await fs.readFile(configPath, "utf-8")
      return SyncConfig.parse(JSON.parse(content))
    } catch {
      return SyncConfig.parse({})
    }
  }

  /**
   * Save sync configuration to AFS
   */
  export async function save(config: SyncConfig, root?: string): Promise<void> {
    const contextRoot = root ?? (await AFS.findRoot())
    if (!contextRoot) {
      throw new Error("No AFS context root found")
    }

    const configPath = getConfigPath(contextRoot)
    await fs.mkdir(path.dirname(configPath), { recursive: true })
    await fs.writeFile(configPath, JSON.stringify(config, null, 2))
  }

  /**
   * Check if sync is configured and enabled
   */
  export async function isEnabled(root?: string): Promise<boolean> {
    const config = await load(root)
    return config.enabled && !!config.endpoint && !!config.token
  }

  /**
   * Get the sync endpoint URL
   */
  export async function getEndpoint(root?: string): Promise<string | null> {
    // Check environment variable first
    const envUrl = process.env.OCODE_HALEXT_URL
    if (envUrl) return envUrl

    const config = await load(root)
    return config.endpoint ?? null
  }

  /**
   * Get the sync token
   */
  export async function getToken(root?: string): Promise<string | null> {
    // Check environment variable first
    const envToken = process.env.OCODE_HALEXT_TOKEN
    if (envToken) return envToken

    const config = await load(root)
    return config.token ?? null
  }

  /**
   * Get device ID (generate if not exists)
   */
  export async function getDeviceId(root?: string): Promise<string> {
    const config = await load(root)
    if (config.deviceId) return config.deviceId

    // Generate a new device ID
    const hostname = (await import("os")).hostname()
    const deviceId = `oracle-code-${hostname}-${Date.now().toString(36)}`

    // Save it
    await save({ ...config, deviceId }, root)
    return deviceId
  }

  /**
   * Configure sync settings
   */
  export async function configure(
    options: {
      endpoint?: string
      token?: string
      tokenName?: string
      enabled?: boolean
    },
    root?: string,
  ): Promise<SyncConfig> {
    const config = await load(root)
    const updated: SyncConfig = {
      ...config,
      ...(options.endpoint !== undefined && { endpoint: options.endpoint }),
      ...(options.token !== undefined && { token: options.token }),
      ...(options.tokenName !== undefined && { tokenName: options.tokenName }),
      ...(options.enabled !== undefined && { enabled: options.enabled }),
    }
    await save(updated, root)
    return updated
  }

  /**
   * Update last sync timestamp
   */
  export async function recordSync(root?: string): Promise<void> {
    const config = await load(root)
    await save({ ...config, lastSync: new Date().toISOString() }, root)
  }

  /**
   * Get last sync timestamp
   */
  export async function getLastSync(root?: string): Promise<Date | null> {
    const config = await load(root)
    return config.lastSync ? new Date(config.lastSync) : null
  }

  /**
   * Clear sync configuration
   */
  export async function clear(root?: string): Promise<void> {
    await save(SyncConfig.parse({}), root)
  }

  /**
   * Build auth headers for requests
   */
  export async function getHeaders(root?: string): Promise<Record<string, string>> {
    const token = await getToken(root)
    if (!token) return {}

    // Determine if it's a sync token or JWT
    // Sync tokens are shorter and don't have dots
    const isJwt = token.includes(".")

    if (isJwt) {
      return { Authorization: `Bearer ${token}` }
    }
    return { "X-Sync-Token": token }
  }
}
