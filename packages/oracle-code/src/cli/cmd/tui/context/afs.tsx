import { createStore } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { createEffect, onMount } from "solid-js"
import { AFS } from "@/afs"
import { useSync } from "./sync"

export interface AFSContextData {
  root: string | null
  exists: boolean
  directories: AFS.DirectoryStatus[]
  plan: string | null
  planExists: boolean
  lastUpdated: number
}

export const { use: useAFS, provider: AFSProvider } = createSimpleContext({
  name: "AFS",
  init: () => {
    const sync = useSync()

    const [store, setStore] = createStore<AFSContextData>({
      root: null,
      exists: false,
      directories: [],
      plan: null,
      planExists: false,
      lastUpdated: 0,
    })

    async function refresh() {
      try {
        // Use the directory from sync context if available, otherwise fall back to default
        const startDir = sync.data.path.directory || sync.data.path.worktree || undefined
        const status = await AFS.getStatus(startDir ? await AFS.findRoot(startDir) ?? undefined : undefined)
        const plan = status.exists ? await AFS.readPlan(status.root) : null

        setStore({
          root: status.root,
          exists: status.exists,
          directories: status.directories,
          plan,
          planExists: plan !== null,
          lastUpdated: Date.now(),
        })
      } catch (error) {
        // AFS not initialized - set defaults
        setStore({
          root: null,
          exists: false,
          directories: [],
          plan: null,
          planExists: false,
          lastUpdated: Date.now(),
        })
      }
    }

    onMount(() => {
      refresh()
    })

    // Re-refresh when path becomes available from sync
    createEffect(() => {
      if (sync.data.path.directory || sync.data.path.worktree) {
        refresh()
      }
    })

    return {
      data: store,
      ready: true,
      refresh,
      get root() {
        return store.root
      },
      get exists() {
        return store.exists
      },
      get directories() {
        return store.directories
      },
      get plan() {
        return store.plan
      },
      get planExists() {
        return store.planExists
      },
      getDirectory(name: string) {
        return store.directories.find((d) => d.name === name)
      },
    }
  },
})
