import { createStore } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { onMount, onCleanup } from "solid-js"
import { useSDK } from "./sdk"
import { useSync } from "./sync"

export interface AgentsContextData {
  activeAgents: string[]
  subagentSessionCount: number
  lastUpdated: number
}

export const { use: useAgents, provider: AgentsProvider } = createSimpleContext({
  name: "Agents",
  init: () => {
    const sdk = useSDK()
    const sync = useSync()

    const [store, setStore] = createStore<AgentsContextData>({
      activeAgents: [],
      subagentSessionCount: 0,
      lastUpdated: 0,
    })

    function refresh() {
      try {
        // Get sessions from sync provider
        const sessions = sync.data.session || []
        const statuses = sync.data.session_status || {}

        // Filter for subagent sessions (those with parentID)
        const subagentSessions = sessions.filter((s) => s.parentID)

        // Find active agent names from busy subagent sessions
        const activeAgentNames = [
          ...new Set(
            subagentSessions
              .filter((s) => statuses[s.id]?.type === "busy")
              .map((s) => {
                const match = s.title.match(/@(\w+)/)
                return match?.[1]
              })
              .filter(Boolean),
          ),
        ] as string[]

        setStore({
          activeAgents: activeAgentNames,
          subagentSessionCount: subagentSessions.length,
          lastUpdated: Date.now(),
        })
      } catch (error) {
        console.error("Failed to refresh agents state:", error)
      }
    }

    onMount(() => {
      refresh()

      // Listen for session events
      const unsubs = [
        sdk.event.on("session.created", refresh),
        sdk.event.on("session.updated", refresh),
        sdk.event.on("session.deleted", refresh),
        sdk.event.on("session.status", refresh),
      ]

      // Cleanup: unsubscribe from all events
      onCleanup(() => {
        for (const unsub of unsubs) unsub()
      })
    })

    return {
      data: store,
      ready: true,
      refresh,
      get activeAgents() {
        return store.activeAgents
      },
      get subagentSessionCount() {
        return store.subagentSessionCount
      },
      isAgentActive(agentName: string) {
        return store.activeAgents.includes(agentName)
      },
      getSubagentSessions() {
        const sessions = sync.data.session || []
        return sessions.filter((s) => s.parentID)
      },
      getAgentSessions(agentName: string) {
        const sessions = sync.data.session || []
        return sessions.filter((s) => s.parentID && s.title.includes(`@${agentName}`))
      },
    }
  },
})
