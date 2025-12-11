import { createStore } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { onMount } from "solid-js"
import { AFS } from "@/afs"

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
        const status = await AFS.getStatus()
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
