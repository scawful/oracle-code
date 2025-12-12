import { createStore, produce } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { createMemo, onMount, onCleanup } from "solid-js"
import { useSDK } from "./sdk"
import { AFS } from "@/afs"
import { Metacognition, Goals, Epistemic, Emotions, CognitiveIntegration } from "@/cognitive"

/**
 * Cognitive Protocol context for tracking metacognition, goals, and epistemic state
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
}

export const { use: useCognitive, provider: CognitiveProvider } = createSimpleContext({
  name: "Cognitive",
  init: () => {
    const sdk = useSDK()

    const [store, setStore] = createStore<CognitiveContextData>({
      metacognition: null,
      goals: null,
      epistemic: null,
      emotional: null,
      afsRoot: null,
      lastUpdated: 0,
      loading: true,
    })

    /**
     * Refresh cognitive state from AFS
     */
    async function refresh() {
      try {
        const root = await AFS.findRoot()
        if (!root) {
          setStore(
            produce((draft) => {
              draft.afsRoot = null
              draft.metacognition = null
              draft.goals = null
              draft.epistemic = null
              draft.emotional = null
              draft.loading = false
            })
          )
          return
        }

        const [metaState, goalHierarchy, epistemicState, emotionalState] = await Promise.all([
          Metacognition.read(root),
          Goals.read(root),
          Epistemic.read(root),
          Emotions.read(root),
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
          })
        )
      } catch (error) {
        console.error("Failed to refresh cognitive state:", error)
        setStore("loading", false)
      }
    }

    // Set up polling and event listeners
    onMount(() => {
      // Initial load
      refresh()

      // Refresh on relevant events
      const unsubs = [
        sdk.event.on("message.updated", refresh),
        sdk.event.on("message.part.updated", refresh),
      ]

      // Poll periodically (every 5 seconds) for file changes
      const interval = setInterval(refresh, 5000)

      onCleanup(() => {
        unsubs.forEach((unsub) => unsub())
        clearInterval(interval)
      })
    })

    // Derived values for metacognition
    const strategy = createMemo(() => store.metacognition?.currentStrategy || "incremental")
    const strategyEffectiveness = createMemo(
      () => store.metacognition?.strategyEffectiveness || 0.5
    )
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
    const progressStatus = createMemo(
      () => store.metacognition?.progressStatus || "making_progress"
    )
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
    const goldenFactCount = createMemo(() => 
      Object.keys(store.epistemic?.goldenFacts || {}).length
    )
    const workingFactCount = createMemo(() => 
      Object.keys(store.epistemic?.workingFacts || {}).length
    )
    const maxGoldenFacts = createMemo(() => 
      store.epistemic?.settings.maxGoldenFacts || 10
    )
    const maxWorkingFacts = createMemo(() => 
      store.epistemic?.settings.maxWorkingFacts || 100
    )
    const avgConfidence = createMemo(() => {
      const facts = Object.values(store.epistemic?.workingFacts || {})
      if (facts.length === 0) return 100
      return Math.round(facts.reduce((sum, f) => sum + f.confidence, 0) / facts.length * 100)
    })
    const assumptionCount = createMemo(() => 
      Object.keys(store.epistemic?.assumptions || {}).length
    )
    const unvalidatedAssumptions = createMemo(() => 
      Object.values(store.epistemic?.assumptions || {}).filter(a => a.needsValidation).length
    )
    const unknownCount = createMemo(() => 
      store.epistemic?.unknowns.length || 0
    )
    const criticalUnknowns = createMemo(() => 
      store.epistemic?.unknowns.filter(u => u.importance === "critical").length || 0
    )
    const contradictionCount = createMemo(() => 
      store.epistemic?.contradictions.filter(c => !c.resolved).length || 0
    )
    const hasEpistemicData = createMemo(() => 
      goldenFactCount() > 0 || workingFactCount() > 0 || unknownCount() > 0
    )

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
    const hasEmotionalData = createMemo(() => 
      fearCount() > 0 || curiosityCount() > 0 || satisfactionCount() > 0 || frustrationCount() > 0
    )
    const totalEmotionCount = createMemo(() => 
      fearCount() + curiosityCount() + satisfactionCount() + frustrationCount()
    )

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
        return store.metacognition !== null || store.goals !== null || store.epistemic !== null || store.emotional !== null
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
