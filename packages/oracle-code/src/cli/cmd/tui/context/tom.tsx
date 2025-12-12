import { createStore, produce } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { createMemo, onMount, onCleanup } from "solid-js"
import { useSDK } from "./sdk"
import { useSync } from "./sync"
import { ToM } from "@/tom"

/**
 * Theory of Mind context for tracking agent belief states and common ground
 */
export interface ToMContextData {
  // Per-agent belief states
  beliefStates: Record<string, ToM.BeliefState>

  // Common ground across all agents
  commonGround: ToM.CommonGround

  // Model of user intent
  userIntent: ToM.UserIntentModel

  // Last update timestamp
  lastUpdated: number
}

export const { use: useToM, provider: ToMProvider } = createSimpleContext({
  name: "ToM",
  init: () => {
    const sdk = useSDK()
    const sync = useSync()

    const [store, setStore] = createStore<ToMContextData>({
      beliefStates: {},
      commonGround: ToM.createEmptyCommonGround(),
      userIntent: ToM.createEmptyUserIntent(),
      lastUpdated: 0,
    })

    /**
     * Extract belief states from session data
     */
    function refreshBeliefStates() {
      try {
        const sessions = sync.data.session || []
        const parts = sync.data.part || {}

        // Build belief states from all sessions (main + subagents)
        const newBeliefStates: Record<string, ToM.BeliefState> = {}

        for (const session of sessions) {
          // Determine agent name based on whether it's a subagent or main session
          const isSubagent = !!session.parentID
          let agentName: string

          if (isSubagent) {
            const agentMatch = session.title.match(/@(\w+)/)
            agentName = agentMatch?.[1] || "subagent"
          } else {
            agentName = "main"
          }

          let beliefState = ToM.createEmptyBeliefState(session.id, session.id, agentName)

          // Extract knowledge from shared state (if available)
          const stateData = sync.data.state
          if (stateData && stateData.entries) {
            // All agents share knowledge from the state entries
            for (const entry of stateData.entries) {
              beliefState = ToM.addKnowledge(
                beliefState,
                entry.key,
                entry.value,
                0.8, // Default confidence for state entries
                "shared"
              )
            }
          }

          // Extract goals from message parts (look for text parts with goal patterns)
          const sessionParts = parts[session.id] || []
          for (const part of sessionParts) {
            if (part.type === "text" && part.text) {
              const goalPatterns = [
                /(?:I will|I'll|Going to|My goal is to|Objective:)\s+([^.!?]+)/gi,
                /(?:Task|Goal|Objective):\s*([^.!?\n]+)/gi,
              ]

              for (const pattern of goalPatterns) {
                let match
                while ((match = pattern.exec(part.text)) !== null) {
                  const goalDesc = match[1].trim()
                  if (goalDesc.length > 5 && goalDesc.length < 200) {
                    beliefState = ToM.addGoal(beliefState, goalDesc, 1)
                  }
                }
              }
            }
          }

          newBeliefStates[session.id] = beliefState
        }

        // Build common ground from all belief states
        const allStates = Object.values(newBeliefStates)
        const commonGround = ToM.buildCommonGround(allStates)

        setStore(
          produce((draft) => {
            draft.beliefStates = newBeliefStates
            draft.commonGround = commonGround
            draft.lastUpdated = Date.now()
          })
        )
      } catch (error) {
        console.error("Failed to refresh belief states:", error)
      }
    }

    /**
     * Extract user intent from conversation
     */
    function analyzeUserIntent(sessionID: string) {
      try {
        const parts = sync.data.part[sessionID] || []
        const messages = sync.data.message[sessionID] || []
        const userMessages = messages.filter((m) => m.role === "user")

        if (userMessages.length === 0) {
          return
        }

        // Get text from parts for user messages
        let primaryIntent = ""
        const constraints: string[] = []

        // Find text parts from user messages
        for (const msg of userMessages) {
          const msgParts = parts.filter((p) => p.messageID === msg.id)
          for (const part of msgParts) {
            if (part.type === "text" && part.text) {
              if (!primaryIntent) {
                primaryIntent = part.text.slice(0, 200)
              }

              // Extract constraints
              const constraintPatterns = [
                /(?:must|should|need to|have to)\s+([^.!?,]+)/gi,
                /(?:don't|do not|never|avoid)\s+([^.!?,]+)/gi,
                /(?:make sure|ensure)\s+([^.!?,]+)/gi,
              ]

              for (const pattern of constraintPatterns) {
                let match
                while ((match = pattern.exec(part.text)) !== null) {
                  const constraint = match[0].trim()
                  if (constraint.length > 5 && constraint.length < 100) {
                    constraints.push(constraint)
                  }
                }
              }
            }
          }
        }

        // Calculate confidence based on message clarity
        const confidence = Math.min(
          1,
          0.5 + (primaryIntent.length > 20 ? 0.2 : 0) + (constraints.length > 0 ? 0.2 : 0)
        )

        setStore("userIntent", {
          primaryIntent,
          confidence,
          subIntents: [],
          constraints: [...new Set(constraints)].slice(0, 5),
          created: store.userIntent.created || Date.now(),
          lastUpdated: Date.now(),
        })
      } catch (error) {
        console.error("Failed to analyze user intent:", error)
      }
    }

    /**
     * Manually add knowledge to an agent's belief state
     */
    function addKnowledge(
      sessionID: string,
      key: string,
      value: unknown,
      confidence: number,
      source: ToM.KnowledgeSource
    ) {
      const existing = store.beliefStates[sessionID]
      if (!existing) return

      const updated = ToM.addKnowledge(existing, key, value, confidence, source)
      setStore("beliefStates", sessionID, updated)

      // Rebuild common ground
      const allStates = Object.values(store.beliefStates)
      const commonGround = ToM.buildCommonGround(allStates)
      setStore("commonGround", commonGround)
    }

    // Find and analyze the main session's user intent
    function refreshAll() {
      refreshBeliefStates()

      // Find main session (no parentID) and analyze its intent
      const sessions = sync.data.session || []
      const mainSession = sessions.find((s) => !s.parentID)
      if (mainSession) {
        analyzeUserIntent(mainSession.id)
      }
    }

    onMount(() => {
      refreshAll()

      // Refresh on relevant events - store unsubscribe functions
      const unsubs = [
        sdk.event.on("session.created", refreshAll),
        sdk.event.on("session.updated", refreshAll),
        sdk.event.on("session.deleted", refreshAll),
        sdk.event.on("message.updated", refreshAll),
        sdk.event.on("message.part.updated", refreshAll),
      ]

      // Cleanup: call all unsubscribe functions
      onCleanup(() => {
        unsubs.forEach((unsub) => unsub())
      })
    })

    // Derived values
    const syncStatus = createMemo(() => store.commonGround.syncStatus)
    const divergenceCount = createMemo(() => store.commonGround.divergences.length)
    const highSeverityDivergences = createMemo(() =>
      store.commonGround.divergences.filter((d) => d.severity === "high")
    )

    return {
      data: store,
      ready: true,
      refresh: refreshBeliefStates,
      analyzeIntent: analyzeUserIntent,
      addKnowledge,

      // Getters
      get beliefStates() {
        return store.beliefStates
      },
      get commonGround() {
        return store.commonGround
      },
      get userIntent() {
        return store.userIntent
      },

      // Status indicators
      get syncStatus() {
        return syncStatus()
      },
      get divergenceCount() {
        return divergenceCount()
      },
      get highSeverityDivergences() {
        return highSeverityDivergences()
      },
      get syncStatusColor() {
        return ToM.getSyncStatusColor(syncStatus())
      },

      // Helper methods
      getBeliefState(sessionID: string) {
        return store.beliefStates[sessionID]
      },

      hasUnsyncedBeliefs() {
        return store.commonGround.syncStatus !== "synchronized"
      },

      getActiveGoals(sessionID: string) {
        const state = store.beliefStates[sessionID]
        if (!state) return []
        return state.goals.filter((g) => g.status === "active")
      },

      getSharedFacts() {
        return store.commonGround.sharedFacts
      },

      // Formatting helpers
      formatConfidence(value: number) {
        return `${(value * 100).toFixed(0)}%`
      },
    }
  },
})
