import { createMemo } from "solid-js"
import { createSimpleContext } from "./helper"
import { useSync } from "./sync"

/**
 * Default safe tools that are whitelisted globally
 * These tools are read-only and cannot modify system state
 */
export const DEFAULT_GLOBAL_WHITELIST = ["list", "read", "glob", "grep", "todoread"]

/** Extended permission type with whitelist (not yet in SDK types) */
type PermissionWithWhitelist = {
  whitelist?: {
    global?: string[]
    project?: string[]
  }
}

export const { use: useToolWhitelist, provider: ToolWhitelistProvider } = createSimpleContext({
  name: "ToolWhitelist",
  init: () => {
    const sync = useSync()

    const globalWhitelist = createMemo(() => {
      const permission = sync.data.config.permission as PermissionWithWhitelist | undefined
      const configured = permission?.whitelist?.global
      // Use default if not configured
      return configured ?? DEFAULT_GLOBAL_WHITELIST
    })

    const projectWhitelist = createMemo(() => {
      const permission = sync.data.config.permission as PermissionWithWhitelist | undefined
      return permission?.whitelist?.project ?? []
    })

    const combinedWhitelist = createMemo(() => {
      return [...new Set([...globalWhitelist(), ...projectWhitelist()])]
    })

    return {
      /**
       * Check if a tool is whitelisted
       */
      isWhitelisted(tool: string): boolean {
        return combinedWhitelist().includes(tool)
      },

      /**
       * Get globally whitelisted tools
       */
      get global() {
        return globalWhitelist()
      },

      /**
       * Get project-specific whitelisted tools
       */
      get project() {
        return projectWhitelist()
      },

      /**
       * Get all whitelisted tools (global + project combined)
       */
      get all() {
        return combinedWhitelist()
      },

      /**
       * Get count of whitelisted tools
       */
      get count() {
        return combinedWhitelist().length
      },
    }
  },
})
