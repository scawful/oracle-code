import { createStore, produce } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { createMemo, onMount, onCleanup } from "solid-js"
import { useSDK } from "./sdk"
import { useKV } from "./kv"
import { AFS } from "@/afs"
import { CognitiveIntegration, AnalysisTriggers, Emotions } from "@/cognitive"

/**
 * Analysis Gate Mode
 * - confirm-all: All triggers require user confirmation (default)
 * - auto-accept: All triggers are auto-accepted (flow-friendly)
 * - auto-deny: All triggers are silently ignored (quiet mode)
 */
export type GateMode = "confirm-all" | "auto-accept" | "auto-deny"

/**
 * Pending analysis waiting for user confirmation
 */
export interface PendingAnalysis {
  id: string
  trigger: AnalysisTriggers.AnalysisTrigger
  matchedConditions: string[]
  timestamp: string
  state: "pending" | "accepted" | "denied" | "expired"
}

/**
 * Statistics for analysis gate
 */
export interface GateStats {
  totalTriggered: number
  accepted: number
  denied: number
  autoAccepted: number
  expired: number
}

/**
 * Analysis Gate Context Data
 */
export interface AnalysisGateContextData {
  pending: PendingAnalysis[]
  mode: GateMode
  showNotifications: boolean
  expirationSeconds: number
  stats: GateStats
  lastUpdated: number
}

export const { use: useAnalysisGate, provider: AnalysisGateProvider } = createSimpleContext({
  name: "AnalysisGate",
  init: () => {
    const sdk = useSDK()
    const kv = useKV()

    const rawMode = kv.get("analysis.gate.mode", "confirm-all")
    const mode: GateMode =
      rawMode === "auto-accept" || rawMode === "auto-deny" || rawMode === "confirm-all"
        ? rawMode
        : "confirm-all"

    const rawExpiration = Number(kv.get("analysis.gate.expiration_seconds", 300))
    const expirationSeconds =
      Number.isFinite(rawExpiration) && rawExpiration > 0 ? Math.floor(rawExpiration) : 300

    const showNotifications = Boolean(kv.get("analysis.gate.show_notifications", true))

    const [store, setStore] = createStore<AnalysisGateContextData>({
      pending: [],
      mode,
      showNotifications,
      expirationSeconds,
      stats: {
        totalTriggered: 0,
        accepted: 0,
        denied: 0,
        autoAccepted: 0,
        expired: 0,
      },
      lastUpdated: 0,
    })

    /**
     * Refresh pending triggers from integration
     */
    async function refresh() {
      const pendingFromIntegration = CognitiveIntegration.getPendingTriggers()
      
      // Convert to our format
      const newPending: PendingAnalysis[] = pendingFromIntegration.map((t) => ({
        id: t.trigger.id + "-" + t.timestamp,
        trigger: t.trigger,
        matchedConditions: t.matchedConditions,
        timestamp: t.timestamp,
        state: "pending" as const,
      }))

      // Merge with existing, preserving state
      setStore(
        produce((draft) => {
          // Add new pending items
          for (const p of newPending) {
            const existing = draft.pending.find((x) => x.id === p.id)
            if (!existing) {
              // Handle based on mode
              if (draft.mode === "auto-accept") {
                p.state = "accepted"
                draft.stats.autoAccepted++
                draft.stats.totalTriggered++
                // Execute the analysis
                executeAnalysis(p)
              } else if (draft.mode === "auto-deny") {
                p.state = "denied"
                draft.stats.denied++
                draft.stats.totalTriggered++
              } else {
                draft.pending.push(p)
                draft.stats.totalTriggered++
              }
            }
          }

          // Expire old pending items
          const now = Date.now()
          for (const p of draft.pending) {
            if (p.state === "pending") {
              const age = now - new Date(p.timestamp).getTime()
              if (age > draft.expirationSeconds * 1000) {
                p.state = "expired"
                draft.stats.expired++
              }
            }
          }

          // Clean up old non-pending items
          draft.pending = draft.pending.filter(
            (p) => p.state === "pending" || now - new Date(p.timestamp).getTime() < 60000
          )

          draft.lastUpdated = now
        })
      )

      // Clear from integration
      for (const p of newPending) {
        CognitiveIntegration.clearPendingTrigger(p.trigger.id)
      }
    }

    /**
     * Execute an analysis (spawn subagent if needed)
     */
    async function executeAnalysis(analysis: PendingAnalysis) {
      const root = await AFS.findRoot()
      if (!root) return

      // Record emotion if specified
      if (analysis.trigger.suggestion.emotionToRecord) {
        const e = analysis.trigger.suggestion.emotionToRecord
        await Emotions.addEmotion(
          root,
          e.category,
          e.trigger,
          `Analysis trigger: ${analysis.trigger.name}`,
          e.intensity
        )
      }

      // TODO: Spawn subagent if subagentType is specified
      // This would need to integrate with the session/task system
      if (analysis.trigger.suggestion.subagentType) {
        console.log("Would spawn subagent:", analysis.trigger.suggestion.subagentType)
        // Integration with Task tool would go here
      }
    }

    /**
     * Accept a pending analysis
     */
    async function accept(id: string) {
      const analysis = store.pending.find((p) => p.id === id)
      if (!analysis || analysis.state !== "pending") return false

      setStore(
        produce((draft) => {
          const p = draft.pending.find((x) => x.id === id)
          if (p) {
            p.state = "accepted"
            draft.stats.accepted++
          }
        })
      )

      await executeAnalysis(analysis)
      return true
    }

    /**
     * Deny a pending analysis
     */
    function deny(id: string) {
      setStore(
        produce((draft) => {
          const p = draft.pending.find((x) => x.id === id)
          if (p && p.state === "pending") {
            p.state = "denied"
            draft.stats.denied++
          }
        })
      )
    }

    /**
     * Accept all pending analyses
     */
    async function acceptAll() {
      const pendingItems = store.pending.filter((p) => p.state === "pending")
      for (const item of pendingItems) {
        await accept(item.id)
      }
    }

    /**
     * Deny all pending analyses
     */
    function denyAll() {
      setStore(
        produce((draft) => {
          for (const p of draft.pending) {
            if (p.state === "pending") {
              p.state = "denied"
              draft.stats.denied++
            }
          }
        })
      )
    }

    /**
     * Set gate mode
     */
    function setMode(mode: GateMode) {
      setStore("mode", mode)
      kv.set("analysis.gate.mode", mode)
    }

    /**
     * Cycle through modes
     */
    function cycleMode() {
      const modes: GateMode[] = ["confirm-all", "auto-accept", "auto-deny"]
      const current = modes.indexOf(store.mode)
      const next = (current + 1) % modes.length
      setMode(modes[next])
    }

    /**
     * Enable/disable a specific trigger's auto-accept
     */
    async function setTriggerAutoAccept(triggerId: string, autoAccept: boolean) {
      const root = await AFS.findRoot()
      if (!root) return
      await AnalysisTriggers.setAutoAccept(root, triggerId, autoAccept)
    }

    /**
     * Disable a specific trigger
     */
    async function disableTrigger(triggerId: string) {
      const root = await AFS.findRoot()
      if (!root) return
      await AnalysisTriggers.disableTrigger(root, triggerId)
    }

    // Set up polling
    onMount(() => {
      refresh()
      const interval = setInterval(refresh, 2000) // Check every 2 seconds

      onCleanup(() => {
        clearInterval(interval)
      })
    })

    // Derived values
    const hasPending = createMemo(() => store.pending.some((p) => p.state === "pending"))
    const pendingCount = createMemo(() => store.pending.filter((p) => p.state === "pending").length)
    const currentPending = createMemo(() => store.pending.find((p) => p.state === "pending") || null)

    const modeLabel = createMemo(() => {
      switch (store.mode) {
        case "confirm-all":
          return "Confirm All"
        case "auto-accept":
          return "Auto Accept"
        case "auto-deny":
          return "Auto Deny"
      }
    })

    const modeShort = createMemo(() => {
      switch (store.mode) {
        case "confirm-all":
          return "CONF"
        case "auto-accept":
          return "AUTO"
        case "auto-deny":
          return "OFF"
      }
    })

    return {
      data: store,
      ready: true,
      refresh,

      // State getters
      get pending() {
        return store.pending.filter((p) => p.state === "pending")
      },
      get allPending() {
        return store.pending
      },
      get hasPending() {
        return hasPending()
      },
      get pendingCount() {
        return pendingCount()
      },
      get currentPending() {
        return currentPending()
      },
      get mode() {
        return store.mode
      },
      get modeLabel() {
        return modeLabel()
      },
      get modeShort() {
        return modeShort()
      },
      get stats() {
        return store.stats
      },
      get showNotifications() {
        return store.showNotifications
      },

      // Actions
      accept,
      deny,
      acceptAll,
      denyAll,
      setMode,
      cycleMode,
      setTriggerAutoAccept,
      disableTrigger,

      // Settings
      setShowNotifications(show: boolean) {
        setStore("showNotifications", show)
        kv.set("analysis.gate.show_notifications", show)
      },
      setExpirationSeconds(seconds: number) {
        const normalized = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 300
        setStore("expirationSeconds", normalized)
        kv.set("analysis.gate.expiration_seconds", normalized)
      },
    }
  },
})
