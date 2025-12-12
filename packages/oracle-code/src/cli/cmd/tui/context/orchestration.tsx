import { createStore } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { createMemo } from "solid-js"

/**
 * Orchestration strategies based on research paper (arXiv:2512.08296)
 */
export type OrchestrationStrategy =
  | "independent" // Agents work separately, results merged (17.2x error amp)
  | "centralized" // Coordinator dispatches to specialists (+81% on parallelizable)
  | "decentralized" // Agents communicate peer-to-peer (+9.2% on dynamic)
  | "hierarchical" // Tree structure with delegation
  | "debate" // Agents argue, synthesize consensus

export interface OrchestrationConfig {
  strategy: OrchestrationStrategy
  maxParallel: number
  enableCritic: boolean
  autoRoute: boolean
  parallelMode: "concurrent" | "sequential"
}

export interface StrategyInfo {
  name: string
  shortName: string
  pros: string
  cons: string
  improvement: string
  errorAmp: string
}

export const STRATEGY_INFO: Record<OrchestrationStrategy, StrategyInfo> = {
  independent: {
    name: "Independent",
    shortName: "Indep",
    pros: "Simple, no coordination overhead",
    cons: "17.2x error amplification",
    improvement: "Varies",
    errorAmp: "17.2x",
  },
  centralized: {
    name: "Centralized",
    shortName: "Ctrl",
    pros: "Best for parallelizable tasks",
    cons: "Coordinator bottleneck",
    improvement: "+81% on finance tasks",
    errorAmp: "4.4x",
  },
  decentralized: {
    name: "Decentralized",
    shortName: "Decntr",
    pros: "Good for dynamic exploration",
    cons: "7.8x error amplification",
    improvement: "+9.2% on web tasks",
    errorAmp: "7.8x",
  },
  hierarchical: {
    name: "Hierarchical",
    shortName: "Hier",
    pros: "Scales to many agents",
    cons: "Complex communication paths",
    improvement: "Variable",
    errorAmp: "~5x",
  },
  debate: {
    name: "Debate",
    shortName: "Debate",
    pros: "Synthesizes multiple perspectives",
    cons: "Higher token usage",
    improvement: "Quality-focused",
    errorAmp: "~3x",
  },
}

const STRATEGIES: OrchestrationStrategy[] = [
  "centralized",
  "decentralized",
  "independent",
  "hierarchical",
  "debate",
]

export const { use: useOrchestration, provider: OrchestrationProvider } = createSimpleContext({
  name: "Orchestration",
  init: () => {
    const [config, setConfig] = createStore<OrchestrationConfig>({
      strategy: "centralized",
      maxParallel: 3,
      enableCritic: false,
      autoRoute: false,
      parallelMode: "concurrent",
    })

    const strategyInfo = createMemo(() => STRATEGY_INFO[config.strategy])

    const isOptimalAgentCount = createMemo(() => config.maxParallel >= 1 && config.maxParallel <= 4)

    const agentCountWarning = createMemo(() => {
      if (config.maxParallel > 4) {
        return "Research shows 3-4 agents optimal. Beyond this, per-agent quality degrades."
      }
      return null
    })

    return {
      // Config access
      get config() {
        return config
      },
      get strategy() {
        return config.strategy
      },
      get strategyInfo() {
        return strategyInfo()
      },
      get maxParallel() {
        return config.maxParallel
      },
      get enableCritic() {
        return config.enableCritic
      },
      get autoRoute() {
        return config.autoRoute
      },
      get parallelMode() {
        return config.parallelMode
      },

      // Computed
      get isOptimalAgentCount() {
        return isOptimalAgentCount()
      },
      get agentCountWarning() {
        return agentCountWarning()
      },

      // Mutations
      setStrategy(strategy: OrchestrationStrategy) {
        setConfig("strategy", strategy)
      },

      cycleStrategy(direction: 1 | -1 = 1) {
        const currentIndex = STRATEGIES.indexOf(config.strategy)
        let nextIndex = currentIndex + direction
        if (nextIndex < 0) nextIndex = STRATEGIES.length - 1
        if (nextIndex >= STRATEGIES.length) nextIndex = 0
        setConfig("strategy", STRATEGIES[nextIndex])
      },

      setMaxParallel(count: number) {
        setConfig("maxParallel", Math.max(1, Math.min(8, count)))
      },

      incrementMaxParallel() {
        setConfig("maxParallel", Math.min(config.maxParallel + 1, 8))
      },

      decrementMaxParallel() {
        setConfig("maxParallel", Math.max(config.maxParallel - 1, 1))
      },

      setEnableCritic(enabled: boolean) {
        setConfig("enableCritic", enabled)
      },

      toggleCritic() {
        const newValue = !config.enableCritic
        setConfig("enableCritic", newValue)
        return newValue // Return the NEW value after toggle
      },

      setAutoRoute(enabled: boolean) {
        setConfig("autoRoute", enabled)
      },

      toggleAutoRoute() {
        setConfig("autoRoute", !config.autoRoute)
      },

      setParallelMode(mode: "concurrent" | "sequential") {
        setConfig("parallelMode", mode)
      },

      toggleParallelMode() {
        setConfig("parallelMode", config.parallelMode === "concurrent" ? "sequential" : "concurrent")
      },

      // Get all strategies for UI
      getAllStrategies() {
        return STRATEGIES
      },

      getStrategyInfo(strategy: OrchestrationStrategy) {
        return STRATEGY_INFO[strategy]
      },
    }
  },
})
