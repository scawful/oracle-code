import { createStore, produce } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { createMemo, createEffect, onCleanup, untrack } from "solid-js"
import { useSDK } from "./sdk"
import { useSync } from "./sync"
import { useKV } from "./kv"
import { AFS } from "@/afs"
import { Metacognition, Goals, Epistemic, Emotions } from "@/cognitive"
import fs from "fs"
import path from "path"

/**
 * Cognitive Protocol context for tracking metacognition, goals, and epistemic state
 *
 * IMPORTANT: This context uses the sync context to get the correct working directory
 * for the current session. This ensures that when loading an existing session, we
 * read cognitive state from the session's .context directory, not the server's.
 *
 * INITIALIZATION ORDER:
 * 1. Wait for sync.status === "complete" before attempting any AFS operations
 * 2. Only set up file watchers AFTER afsRoot is resolved
 * 3. Polling is configurable via KV (default 5000ms for lighter weight)
 */
export interface CognitiveContextData {
  // Metacognition state
  metacognition: Metacognition.MetacognitiveState | null

  // Goal hierarchy
  goals: Goals.GoalHierarchy | null

  // Epistemic state (knowledge, assumptions, unknowns)
  epistemic: Epistemic.EpistemicState | null

  // Emotional state (fears, curiosities, satisfactions, frustrations)
  emotional: Emotions.EmotionalState | null

  // AFS root (for reading state)
  afsRoot: string | null

  // Last update timestamp
  lastUpdated: number

  // Loading state
  loading: boolean

  // Initialization state - true when sync is complete and we've attempted first load
  initialized: boolean
}

// Default polling interval (5 seconds - lighter weight than previous 2s)
const DEFAULT_POLL_INTERVAL_MS = 5000
// Debounce for file watcher events
const FILE_WATCHER_DEBOUNCE_MS = 300
// Throttle for refresh calls
const REFRESH_THROTTLE_MS = 1000

export const { use: useCognitive, provider: CognitiveProvider } = createSimpleContext({
  name: "Cognitive",
  init: () => {
    const sdk = useSDK()
    const sync = useSync()
    const kv = useKV()

    const [store, setStore] = createStore<CognitiveContextData>({
      metacognition: null,
      goals: null,
      epistemic: null,
      emotional: null,
      afsRoot: null,
      lastUpdated: 0,
      loading: true,
      initialized: false,
    })

    // Configurable polling interval
    const [pollInterval] = kv.signal("tui.cognitive.poll_interval_ms", DEFAULT_POLL_INTERVAL_MS)

    // Track refresh state to prevent concurrent refreshes
    let refreshInProgress = false
    let refreshTimeout: ReturnType<typeof setTimeout> | null = null
    let lastRefresh = 0

    // Track file watcher for cleanup
    let fileWatcher: fs.FSWatcher | null = null
    let pollingInterval: ReturnType<typeof setInterval> | null = null

    // Track event unsubscribe functions
    const eventUnsubs: (() => void)[] = []

    /**
     * Check if sync is ready for cognitive operations
     */
    function isSyncReady(): boolean {
      return sync.data.status === "complete"
    }

    /**
     * Get the working directory from sync context
     */
    function getWorkingDirectory(): string {
      return sync.data.path.directory || sync.data.path.worktree || process.cwd()
    }

    /**
     * Refresh cognitive state from AFS
     * Debounced and throttled to prevent excessive refreshes
     */
    function refresh() {
      const now = Date.now()

      // Throttle: don't refresh more than once per REFRESH_THROTTLE_MS
      if (now - lastRefresh < REFRESH_THROTTLE_MS) {
        if (refreshTimeout) return // Already scheduled
        refreshTimeout = setTimeout(
          () => {
            refreshTimeout = null
            doRefresh()
          },
          REFRESH_THROTTLE_MS - (now - lastRefresh),
        )
        return
      }

      doRefresh()
    }

    async function doRefresh() {
      // Prevent concurrent refreshes
      if (refreshInProgress) return
      refreshInProgress = true
      lastRefresh = Date.now()

      try {
        // CRITICAL: Wait for sync to complete before any AFS operations
        if (!isSyncReady()) {
          setStore("loading", true)
          return
        }

        const startDir = getWorkingDirectory()
        const root = await AFS.findRoot(startDir)

        if (!root) {
          setStore(
            produce((draft) => {
              draft.afsRoot = null
              draft.metacognition = null
              draft.goals = null
              draft.epistemic = null
              draft.emotional = null
              draft.loading = false
              draft.initialized = true
            }),
          )
          return
        }

        // Read all cognitive state files in parallel
        const [metaState, goalHierarchy, epistemicState, emotionalState] = await Promise.all([
          Metacognition.read(root).catch(() => null),
          Goals.read(root).catch(() => null),
          Epistemic.read(root).catch(() => null),
          Emotions.read(root).catch(() => null),
        ])

        setStore(
          produce((draft) => {
            draft.afsRoot = root
            draft.metacognition = metaState
            draft.goals = goalHierarchy
            draft.epistemic = epistemicState
            draft.emotional = emotionalState
            draft.lastUpdated = Date.now()
            draft.loading = false
            draft.initialized = true
          }),
        )
      } catch (error) {
        console.error("Failed to refresh cognitive state:", error)
        setStore(
          produce((draft) => {
            draft.loading = false
            draft.initialized = true
          }),
        )
      } finally {
        refreshInProgress = false
      }
    }

    /**
     * Set up file watcher for cognitive state files
     * Only called when afsRoot is available
     */
    function setupFileWatcher(afsRoot: string) {
      // Clean up any existing watcher first
      cleanupFileWatcher()

      const scratchpadPath = path.join(afsRoot, "scratchpad")

      // Check if directory exists before watching
      if (!fs.existsSync(scratchpadPath)) return

      try {
        let debounceTimeout: ReturnType<typeof setTimeout> | null = null

        fileWatcher = fs.watch(scratchpadPath, { persistent: false }, (_eventType, filename) => {
          // Only refresh on cognitive state file changes
          if (
            filename &&
            (filename === "metacognition.json" ||
              filename === "goals.json" ||
              filename === "epistemic.json" ||
              filename === "emotions.json")
          ) {
            // Debounce rapid file changes
            if (debounceTimeout) clearTimeout(debounceTimeout)
            debounceTimeout = setTimeout(() => {
              debounceTimeout = null
              refresh()
            }, FILE_WATCHER_DEBOUNCE_MS)
          }
        })

        fileWatcher.on("error", () => {
          // Silently handle watcher errors (e.g., directory deleted)
          cleanupFileWatcher()
        })
      } catch {
        // Directory may not exist or be inaccessible, that's ok
      }
    }

    /**
     * Clean up file watcher
     */
    function cleanupFileWatcher() {
      if (fileWatcher) {
        try {
          fileWatcher.close()
        } catch {
          // Ignore close errors
        }
        fileWatcher = null
      }
    }

    /**
     * Set up polling interval
     */
    function setupPolling() {
      cleanupPolling()
      const interval = untrack(() => pollInterval())
      if (interval > 0) {
        pollingInterval = setInterval(refresh, interval)
      }
    }

    /**
     * Clean up polling interval
     */
    function cleanupPolling() {
      if (pollingInterval) {
        clearInterval(pollingInterval)
        pollingInterval = null
      }
    }

    /**
     * Set up SDK event listeners for refresh triggers
     */
    function setupEventListeners() {
      // Only refresh on tool completion, not every message update (reduces noise)
      eventUnsubs.push(
        sdk.event.on("message.part.updated", (event) => {
          const part = event.properties?.part
          if (part?.type === "tool" && (part.state?.status === "completed" || part.state?.status === "error")) {
            refresh()
          }
        }),
      )

      // Refresh when session becomes idle (agent finished working)
      eventUnsubs.push(sdk.event.on("session.idle", refresh))
    }

    /**
     * Clean up all resources
     */
    function cleanup() {
      cleanupFileWatcher()
      cleanupPolling()
      eventUnsubs.forEach((unsub) => unsub())
      eventUnsubs.length = 0
      if (refreshTimeout) {
        clearTimeout(refreshTimeout)
        refreshTimeout = null
      }
    }

    // EFFECT: Wait for sync to complete, then initialize
    createEffect(() => {
      const status = sync.data.status
      const dir = sync.data.path.directory
      const worktree = sync.data.path.worktree

      if (status === "complete" && (dir || worktree)) {
        // Sync is ready - do initial refresh
        refresh()

        // Set up event listeners (only once)
        if (eventUnsubs.length === 0) {
          setupEventListeners()
        }

        // Set up polling
        setupPolling()
      }
    })

    // EFFECT: Set up file watcher when afsRoot changes
    createEffect(() => {
      const afsRoot = store.afsRoot
      if (afsRoot) {
        setupFileWatcher(afsRoot)
      } else {
        cleanupFileWatcher()
      }
    })

    // EFFECT: Update polling interval when config changes
    createEffect(() => {
      const interval = pollInterval()
      // Only restart polling if we're already initialized
      if (store.initialized && interval > 0) {
        setupPolling()
      }
    })

    // Cleanup on unmount
    onCleanup(cleanup)

    // Derived values for metacognition
    const strategy = createMemo(() => store.metacognition?.currentStrategy || "incremental")
    const strategyEffectiveness = createMemo(() => store.metacognition?.strategyEffectiveness || 0.5)
    const cognitiveLoad = createMemo(() => {
      if (!store.metacognition) return 0
      return Math.round(store.metacognition.cognitiveLoad.current * 100)
    })
    const isSpinning = createMemo(() => {
      if (!store.metacognition) return false
      return Metacognition.isSpinning(store.metacognition)
    })
    const flowState = createMemo(() => store.metacognition?.flowState || false)
    const frustration = createMemo(() => {
      if (!store.metacognition) return 0
      return Math.round(store.metacognition.frustrationLevel * 100)
    })
    const progressStatus = createMemo(() => store.metacognition?.progressStatus || "making_progress")
    const shouldSeekHelp = createMemo(() => {
      if (!store.metacognition) return false
      return Metacognition.shouldSeekHelp(store.metacognition)
    })

    // Derived values for goals
    const primaryGoal = createMemo(() => store.goals?.primaryGoal?.description || null)
    const primaryGoalProgress = createMemo(() => {
      if (!store.goals?.primaryGoal) return 0
      return Math.round(store.goals.primaryGoal.progress * 100)
    })
    const activeSubgoals = createMemo(() => {
      if (!store.goals) return 0
      return store.goals.subgoals.filter((g) => g.status === "in_progress").length
    })
    const completedSubgoals = createMemo(() => {
      if (!store.goals) return 0
      return store.goals.subgoals.filter((g) => g.status === "completed").length
    })
    const totalSubgoals = createMemo(() => store.goals?.subgoals.length || 0)
    const hasConflicts = createMemo(() => {
      if (!store.goals) return false
      return store.goals.conflicts.some((c) => c.resolved === false)
    })
    const unresolvedConflicts = createMemo(() => {
      if (!store.goals) return 0
      return store.goals.conflicts.filter((c) => !c.resolved).length
    })

    // Derived values for epistemic state
    const goldenFactCount = createMemo(() => Object.keys(store.epistemic?.goldenFacts || {}).length)
    const workingFactCount = createMemo(() => Object.keys(store.epistemic?.workingFacts || {}).length)
    const maxGoldenFacts = createMemo(() => store.epistemic?.settings.maxGoldenFacts || 10)
    const maxWorkingFacts = createMemo(() => store.epistemic?.settings.maxWorkingFacts || 100)
    const avgConfidence = createMemo(() => {
      const facts = Object.values(store.epistemic?.workingFacts || {})
      if (facts.length === 0) return 100
      return Math.round((facts.reduce((sum, f) => sum + f.confidence, 0) / facts.length) * 100)
    })
    const assumptionCount = createMemo(() => Object.keys(store.epistemic?.assumptions || {}).length)
    const unvalidatedAssumptions = createMemo(
      () => Object.values(store.epistemic?.assumptions || {}).filter((a) => a.needsValidation).length,
    )
    const unknownCount = createMemo(() => store.epistemic?.unknowns.length || 0)
    const criticalUnknowns = createMemo(
      () => store.epistemic?.unknowns.filter((u) => u.importance === "critical").length || 0,
    )
    const contradictionCount = createMemo(() => store.epistemic?.contradictions.filter((c) => !c.resolved).length || 0)
    const hasEpistemicData = createMemo(() => goldenFactCount() > 0 || workingFactCount() > 0 || unknownCount() > 0)

    // Derived values for emotional state
    const mood = createMemo(() => store.emotional?.session.mood || "neutral")
    const anxietyLevel = createMemo(() => store.emotional?.session.anxietyLevel || 30)
    const confidenceLevel = createMemo(() => store.emotional?.session.confidenceLevel || 50)
    const fearCount = createMemo(() => Object.keys(store.emotional?.fears || {}).length)
    const curiosityCount = createMemo(() => Object.keys(store.emotional?.curiosities || {}).length)
    const satisfactionCount = createMemo(() => Object.keys(store.emotional?.satisfactions || {}).length)
    const frustrationCount = createMemo(() => Object.keys(store.emotional?.frustrations || {}).length)
    const isAnxious = createMemo(() => {
      if (!store.emotional) return false
      return store.emotional.session.anxietyLevel >= store.emotional.settings.anxietyThreshold
    })
    const isConfident = createMemo(() => {
      if (!store.emotional) return false
      return store.emotional.session.confidenceLevel >= store.emotional.settings.confidenceThreshold
    })
    const hasEmotionalData = createMemo(
      () => fearCount() > 0 || curiosityCount() > 0 || satisfactionCount() > 0 || frustrationCount() > 0,
    )
    const totalEmotionCount = createMemo(
      () => fearCount() + curiosityCount() + satisfactionCount() + frustrationCount(),
    )

    // Composite health metrics for quick overview
    const overallHealth = createMemo(() => {
      // Calculate overall health score 0-100 based on all metrics
      let score = 70 // Base score

      // Metacognition factors
      if (flowState()) score += 10
      if (isSpinning()) score -= 20
      if (shouldSeekHelp()) score -= 10
      score -= frustration() * 0.2 // Reduce score by frustration level
      score -= (cognitiveLoad() - 50) * 0.1 // Penalty for high load

      // Emotional factors
      if (isConfident()) score += 10
      if (isAnxious()) score -= 15
      score += (confidenceLevel() - 50) * 0.2
      score -= (anxietyLevel() - 30) * 0.2

      // Epistemic factors
      if (contradictionCount() > 0) score -= 5 * contradictionCount()
      if (criticalUnknowns() > 0) score -= 5 * criticalUnknowns()

      return Math.max(0, Math.min(100, Math.round(score)))
    })

    const healthStatus = createMemo(() => {
      const health = overallHealth()
      if (health >= 80) return "excellent"
      if (health >= 60) return "good"
      if (health >= 40) return "moderate"
      if (health >= 20) return "concerning"
      return "critical"
    })

    // Trend indicators based on recent changes
    const emotionalTrend = createMemo(() => {
      const anxiety = anxietyLevel()
      const confidence = confidenceLevel()
      if (confidence >= 70 && anxiety <= 40) return "positive"
      if (confidence <= 30 || anxiety >= 70) return "negative"
      return "stable"
    })

    // Session activity indicator
    const sessionActivity = createMemo(() => {
      const timeSinceUpdate = Date.now() - store.lastUpdated
      if (timeSinceUpdate < 5000) return "active"
      if (timeSinceUpdate < 30000) return "recent"
      if (timeSinceUpdate < 120000) return "idle"
      return "stale"
    })

    // Recommended actions based on current state
    const recommendedActions = createMemo(() => {
      const actions: string[] = []

      if (isSpinning()) {
        actions.push("Change approach - similar actions being repeated")
      }
      if (shouldSeekHelp()) {
        actions.push("Consider asking for clarification")
      }
      if (cognitiveLoad() > 80) {
        actions.push("Break task into smaller steps")
      }
      if (isAnxious()) {
        actions.push("Take cautious approach")
      }
      if (criticalUnknowns() > 0) {
        actions.push("Research missing information first")
      }
      if (contradictionCount() > 0) {
        actions.push("Resolve contradictions before proceeding")
      }
      if (unvalidatedAssumptions() > 2) {
        actions.push("Validate assumptions")
      }

      return actions
    })

    return {
      data: store,
      ready: true,
      refresh,

      // Raw state
      get metacognition() {
        return store.metacognition
      },
      get goals() {
        return store.goals
      },
      get epistemic() {
        return store.epistemic
      },
      get emotional() {
        return store.emotional
      },
      get hasData() {
        return (
          store.metacognition !== null || store.goals !== null || store.epistemic !== null || store.emotional !== null
        )
      },
      get loading() {
        return store.loading
      },
      get afsInitialized() {
        return store.afsRoot !== null
      },

      // Metacognition getters
      get strategy() {
        return strategy()
      },
      get strategyEffectiveness() {
        return strategyEffectiveness()
      },
      get cognitiveLoad() {
        return cognitiveLoad()
      },
      get isSpinning() {
        return isSpinning()
      },
      get flowState() {
        return flowState()
      },
      get frustration() {
        return frustration()
      },
      get progressStatus() {
        return progressStatus()
      },
      get shouldSeekHelp() {
        return shouldSeekHelp()
      },

      // Goal getters
      get primaryGoal() {
        return primaryGoal()
      },
      get primaryGoalProgress() {
        return primaryGoalProgress()
      },
      get activeSubgoals() {
        return activeSubgoals()
      },
      get completedSubgoals() {
        return completedSubgoals()
      },
      get totalSubgoals() {
        return totalSubgoals()
      },
      get hasConflicts() {
        return hasConflicts()
      },
      get unresolvedConflicts() {
        return unresolvedConflicts()
      },

      // Epistemic getters
      get goldenFactCount() {
        return goldenFactCount()
      },
      get workingFactCount() {
        return workingFactCount()
      },
      get maxGoldenFacts() {
        return maxGoldenFacts()
      },
      get maxWorkingFacts() {
        return maxWorkingFacts()
      },
      get avgConfidence() {
        return avgConfidence()
      },
      get assumptionCount() {
        return assumptionCount()
      },
      get unvalidatedAssumptions() {
        return unvalidatedAssumptions()
      },
      get unknownCount() {
        return unknownCount()
      },
      get criticalUnknowns() {
        return criticalUnknowns()
      },
      get contradictionCount() {
        return contradictionCount()
      },
      get hasEpistemicData() {
        return hasEpistemicData()
      },

      // Emotional getters
      get mood() {
        return mood()
      },
      get anxietyLevel() {
        return anxietyLevel()
      },
      get confidenceLevel() {
        return confidenceLevel()
      },
      get fearCount() {
        return fearCount()
      },
      get curiosityCount() {
        return curiosityCount()
      },
      get satisfactionCount() {
        return satisfactionCount()
      },
      get frustrationCount() {
        return frustrationCount()
      },
      get isAnxious() {
        return isAnxious()
      },
      get isConfident() {
        return isConfident()
      },
      get hasEmotionalData() {
        return hasEmotionalData()
      },
      get totalEmotionCount() {
        return totalEmotionCount()
      },

      // Composite health metrics
      get overallHealth() {
        return overallHealth()
      },
      get healthStatus() {
        return healthStatus()
      },
      get emotionalTrend() {
        return emotionalTrend()
      },
      get sessionActivity() {
        return sessionActivity()
      },
      get recommendedActions() {
        return recommendedActions()
      },

      // Health status color
      get healthColor() {
        const status = healthStatus()
        if (status === "excellent" || status === "good") return "success"
        if (status === "moderate") return "warning"
        return "error"
      },
      get trendColor() {
        const trend = emotionalTrend()
        if (trend === "positive") return "success"
        if (trend === "stable") return "muted"
        return "error"
      },
      get activityColor() {
        const activity = sessionActivity()
        if (activity === "active") return "success"
        if (activity === "recent") return "muted"
        if (activity === "idle") return "warning"
        return "error"
      },

      // Status colors
      get flowStateColor() {
        return flowState() ? "success" : "muted"
      },
      get cognitiveLoadColor() {
        const load = cognitiveLoad()
        if (load < 50) return "success"
        if (load < 80) return "warning"
        return "error"
      },
      get progressColor() {
        const status = progressStatus()
        if (status === "making_progress") return "success"
        if (status === "spinning") return "warning"
        return "error"
      },

      // Helper methods
      formatPercent(value: number) {
        return `${value}%`
      },
    }
  },
})
