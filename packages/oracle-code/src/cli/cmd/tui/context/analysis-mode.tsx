import { createStore } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { batch, createMemo } from "solid-js"

/**
 * Analysis modes for enhanced agent collaboration insights
 *
 * Local modes work without backend, backend modes support persistence via halext sync
 */
export type AnalysisMode =
  | "none"
  | "eval"
  | "tom"
  | "metrics"
  | "critic"
  | "emotional"
  | "review" // Code review mode
  | "documentation" // Documentation quality check
  | "security" // Security vulnerability scan
  | "performance" // Performance analysis

export interface AnalysisModeInfo {
  id: AnalysisMode
  name: string
  shortName: string
  description: string
  color: string
}

export const ANALYSIS_MODES: AnalysisModeInfo[] = [
  {
    id: "none",
    name: "Standard",
    shortName: "STD",
    description: "Normal operation without analysis overlays",
    color: "textMuted",
  },
  {
    id: "eval",
    name: "Evaluation",
    shortName: "EVAL",
    description: "Analyze prompt quality, response quality, and information gain",
    color: "warning",
  },
  {
    id: "tom",
    name: "Theory of Mind",
    shortName: "ToM",
    description: "Track agent beliefs, common ground, and divergences",
    color: "info",
  },
  {
    id: "metrics",
    name: "Metrics",
    shortName: "MTX",
    description: "Show coordination efficiency, error amplification, and overhead",
    color: "success",
  },
  {
    id: "critic",
    name: "Harsh Critic",
    shortName: "CRIT",
    description: "Brutally honest code review - no sugar coating",
    color: "error",
  },
  {
    id: "emotional",
    name: "Emotional Valence",
    shortName: "EMO",
    description: "Track emotional state, fears, satisfactions, and mood",
    color: "info",
  },
  {
    id: "review",
    name: "Code Review",
    shortName: "REV",
    description: "Automated code review with actionable suggestions",
    color: "info",
  },
  {
    id: "documentation",
    name: "Documentation",
    shortName: "DOC",
    description: "Check documentation coverage and quality",
    color: "success",
  },
  {
    id: "security",
    name: "Security",
    shortName: "SEC",
    description: "Scan for security vulnerabilities and best practices",
    color: "error",
  },
  {
    id: "performance",
    name: "Performance",
    shortName: "PERF",
    description: "Analyze performance bottlenecks and optimization opportunities",
    color: "warning",
  },
]

export interface AnalysisModeContextData {
  currentMode: AnalysisMode
  // Eval mode settings
  eval: {
    showPromptAnalysis: boolean
    showResponseQuality: boolean
    showTokenBreakdown: boolean
    showInformationGain: boolean
  }
  // ToM mode settings
  tom: {
    showBeliefStates: boolean
    showCommonGround: boolean
    showDivergences: boolean
    showUserIntent: boolean
  }
  // Metrics mode settings
  metrics: {
    showEfficiency: boolean
    showErrorAmplification: boolean
    showOverhead: boolean
    showAgentCount: boolean
  }
  // Critic mode settings
  critic: {
    intensity: "mild" | "harsh" | "brutal"
    allowProfanity: boolean
    focusAreas: ("logic" | "style" | "performance" | "security" | "architecture")[]
    showPraise: boolean
    autoReview: boolean
  }
  // Emotional mode settings
  emotional: {
    showMoodIndicator: boolean
    showAnxietyLevel: boolean
    showConfidenceLevel: boolean
    showRecentEmotions: boolean
    autoRecordFromTools: boolean
  }
}

export const { use: useAnalysisMode, provider: AnalysisModeProvider } = createSimpleContext({
  name: "AnalysisMode",
  init: () => {
    const [store, setStore] = createStore<AnalysisModeContextData>({
      currentMode: "none",
      eval: {
        showPromptAnalysis: true,
        showResponseQuality: true,
        showTokenBreakdown: true,
        showInformationGain: true,
      },
      tom: {
        showBeliefStates: true,
        showCommonGround: true,
        showDivergences: true,
        showUserIntent: true,
      },
      metrics: {
        showEfficiency: true,
        showErrorAmplification: true,
        showOverhead: true,
        showAgentCount: true,
      },
      critic: {
        intensity: "harsh",
        allowProfanity: false,
        focusAreas: ["logic", "style", "performance", "security", "architecture"],
        showPraise: false,
        autoReview: false,
      },
      emotional: {
        showMoodIndicator: true,
        showAnxietyLevel: true,
        showConfidenceLevel: true,
        showRecentEmotions: true,
        autoRecordFromTools: true,
      },
    })

    const currentModeInfo = createMemo(
      () => ANALYSIS_MODES.find((m) => m.id === store.currentMode) || ANALYSIS_MODES[0],
    )

    const isActive = createMemo(() => store.currentMode !== "none")

    return {
      data: store,

      // Current mode
      get mode() {
        return store.currentMode
      },
      get modeInfo() {
        return currentModeInfo()
      },
      get isActive() {
        return isActive()
      },

      // Mode checks
      isEvalMode() {
        return store.currentMode === "eval"
      },
      isToMMode() {
        return store.currentMode === "tom"
      },
      isMetricsMode() {
        return store.currentMode === "metrics"
      },
      isCriticMode() {
        return store.currentMode === "critic"
      },
      isEmotionalMode() {
        return store.currentMode === "emotional"
      },

      // Mode switching
      setMode(mode: AnalysisMode) {
        setStore("currentMode", mode)
      },

      cycle(direction: 1 | -1 = 1) {
        batch(() => {
          const modes = ANALYSIS_MODES.map((m) => m.id)
          const currentIndex = modes.indexOf(store.currentMode)
          let nextIndex = currentIndex + direction
          if (nextIndex < 0) nextIndex = modes.length - 1
          if (nextIndex >= modes.length) nextIndex = 0
          setStore("currentMode", modes[nextIndex])
        })
      },

      toggle(mode: AnalysisMode) {
        if (store.currentMode === mode) {
          setStore("currentMode", "none")
        } else {
          setStore("currentMode", mode)
        }
      },

      // Settings access
      get evalSettings() {
        return store.eval
      },
      get tomSettings() {
        return store.tom
      },
      get metricsSettings() {
        return store.metrics
      },
      get criticSettings() {
        return store.critic
      },
      get emotionalSettings() {
        return store.emotional
      },

      // Settings updates
      updateEvalSettings(settings: Partial<typeof store.eval>) {
        for (const [key, value] of Object.entries(settings)) {
          setStore("eval", key as keyof typeof store.eval, value)
        }
      },
      updateToMSettings(settings: Partial<typeof store.tom>) {
        for (const [key, value] of Object.entries(settings)) {
          setStore("tom", key as keyof typeof store.tom, value)
        }
      },
      updateMetricsSettings(settings: Partial<typeof store.metrics>) {
        for (const [key, value] of Object.entries(settings)) {
          setStore("metrics", key as keyof typeof store.metrics, value)
        }
      },
      updateCriticSettings(settings: Partial<typeof store.critic>) {
        for (const [key, value] of Object.entries(settings)) {
          setStore("critic", key as keyof typeof store.critic, value as any)
        }
      },
      updateEmotionalSettings(settings: Partial<typeof store.emotional>) {
        for (const [key, value] of Object.entries(settings)) {
          setStore("emotional", key as keyof typeof store.emotional, value as any)
        }
      },

      // Get all modes for UI
      getAllModes() {
        return ANALYSIS_MODES
      },
    }
  },
})
