import { createStore, produce } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { createMemo, onMount, onCleanup } from "solid-js"
import { useSDK } from "./sdk"
import { useSync } from "./sync"
import { AgentMetrics } from "@/metrics"
import type { AssistantMessage } from "@oracle-code/sdk/v2"

/**
 * Metrics context for tracking agent coordination metrics
 * Based on "Towards a Science of Scaling Agent Systems" (arXiv:2512.08296)
 */
export interface MetricsContextData {
  // Per-session metrics
  sessionMetrics: Record<string, AgentMetrics.SessionMetrics>

  // Aggregated coordination metrics
  aggregatedMetrics: AgentMetrics.CoordinationMetrics

  // Task analysis for routing
  taskAnalysis: AgentMetrics.TaskAnalysis | null

  // Last update timestamp
  lastUpdated: number
}

export const { use: useMetrics, provider: MetricsProvider } = createSimpleContext({
  name: "Metrics",
  init: () => {
    const sdk = useSDK()
    const sync = useSync()

    const [store, setStore] = createStore<MetricsContextData>({
      sessionMetrics: {},
      aggregatedMetrics: AgentMetrics.createEmptyMetrics(),
      taskAnalysis: null,
      lastUpdated: 0,
    })

    /**
     * Calculate coordination metrics from session data
     */
    function calculateMetrics() {
      try {
        const sessions = sync.data.session || []
        const statuses = sync.data.session_status || {}
        const messages = sync.data.message || {}

        // Get subagent sessions (those with parentID)
        const subagentSessions = sessions.filter((s) => s.parentID)
        const activeSessions = subagentSessions.filter((s) => statuses[s.id]?.type === "busy")

        // Calculate total tokens and turns across all sessions
        let totalTokens = 0
        let totalTurns = 0
        let totalToolCalls = 0
        let successfulToolCalls = 0
        let interAgentMessages = 0

        // Track per-session metrics
        const newSessionMetrics: Record<string, AgentMetrics.SessionMetrics> = {}

        for (const session of sessions) {
          const sessionMessages = messages[session.id] || []

          // Extract agent name from title
          const agentMatch = session.title.match(/@(\w+)/)
          const agentName = agentMatch?.[1] || "unknown"

          // Calculate tokens for this session
          let sessionInputTokens = 0
          let sessionOutputTokens = 0

          for (const msg of sessionMessages) {
            if (msg.role === "assistant") {
              const assistantMsg = msg as AssistantMessage
              sessionInputTokens += assistantMsg.tokens.input || 0
              sessionOutputTokens += assistantMsg.tokens.output || 0
              totalTurns++
            }
          }

          const sessionTotalTokens = sessionInputTokens + sessionOutputTokens
          totalTokens += sessionTotalTokens

          // Count inter-agent messages (messages in subagent sessions)
          if (session.parentID) {
            interAgentMessages += sessionMessages.length
          }

          // Create session metrics
          newSessionMetrics[session.id] = {
            sessionID: session.id,
            parentID: session.parentID,
            agentName,
            tokens: {
              input: sessionInputTokens,
              output: sessionOutputTokens,
              total: sessionTotalTokens,
            },
            timing: {
              started: session.time.created,
              completed: session.time.archived,
              duration: session.time.archived ? session.time.archived - session.time.created : undefined,
            },
            toolCalls: [], // Would need tool call tracking to populate
            errors: [],
            messageCount: sessionMessages.length,
            interAgentMessages: session.parentID ? sessionMessages.length : 0,
          }
        }

        // Calculate coordination metrics
        const activeAgentCount = activeSessions.length
        const sasBaseline = AgentMetrics.Thresholds.efficiency.sas

        // Message density: inter-agent messages per turn
        const messageDensity = totalTurns > 0 ? interAgentMessages / totalTurns : 0

        // Coordination efficiency: approximated based on active agents and message patterns
        // Ec = success / (turns / SAS_turns)
        // We estimate based on agent count and message density
        let coordinationEfficiency = sasBaseline
        if (activeAgentCount > 0) {
          // Multi-agent overhead reduces efficiency
          const overheadFactor = 1 + activeAgentCount * 0.3
          coordinationEfficiency = sasBaseline / overheadFactor
        }

        // Error amplification: based on architecture type
        // Independent: 17.2x, Centralized: 4.4x, Decentralized: 7.8x
        // We estimate based on message density (higher = more coordinated = lower amplification)
        let errorAmplification = 1.0
        if (activeAgentCount > 0) {
          if (messageDensity > 0.3) {
            errorAmplification = AgentMetrics.Thresholds.errorAmplification.centralized
          } else if (messageDensity > 0.1) {
            errorAmplification = AgentMetrics.Thresholds.errorAmplification.decentralized
          } else {
            errorAmplification = AgentMetrics.Thresholds.errorAmplification.independent
          }
        }

        // Overhead percentage
        const sasTokensEstimate = totalTokens / (1 + activeAgentCount * 0.5)
        const overheadPercent = sasTokensEstimate > 0 ? ((totalTokens - sasTokensEstimate) / sasTokensEstimate) * 100 : 0

        // Success per 1K tokens (approximated)
        // In a real implementation, this would track actual task success
        const successRate = coordinationEfficiency // Using efficiency as proxy
        const successPer1KTokens = totalTokens > 0 ? (successRate * 1000) / (totalTokens / 1000) : 0

        // Redundancy: approximated based on subagent count
        // Higher agent count = more potential redundancy
        const redundancy = Math.min(0.6, activeAgentCount * 0.15)

        setStore(
          produce((draft) => {
            draft.sessionMetrics = newSessionMetrics
            draft.aggregatedMetrics = {
              coordinationEfficiency,
              errorAmplification,
              messageDensity,
              redundancy,
              overheadPercent,
              successPer1KTokens,
              activeAgentCount,
              totalTurns,
              totalTokens,
              successRate,
              lastUpdated: Date.now(),
            }
            draft.lastUpdated = Date.now()
          }),
        )
      } catch (error) {
        console.error("Failed to calculate metrics:", error)
      }
    }

    /**
     * Analyze current task for routing recommendation
     */
    function analyzeCurrentTask(params?: { toolCount?: number; isSequential?: boolean; requiresExploration?: boolean }) {
      const tools = sync.data.mcp || {}
      const toolCount = params?.toolCount ?? Object.keys(tools).length + 10 // Base tools + MCP

      // Estimate baseline from current efficiency
      const estimatedBaseline = store.aggregatedMetrics.coordinationEfficiency || 0.3

      const analysis = AgentMetrics.analyzeTask({
        toolCount,
        estimatedBaseline,
        isSequential: params?.isSequential ?? false,
        requiresExploration: params?.requiresExploration ?? false,
      })

      setStore("taskAnalysis", analysis)
      return analysis
    }

    onMount(() => {
      calculateMetrics()

      // Recalculate on relevant events
      const unsubs = [
        sdk.event.on("session.created", calculateMetrics),
        sdk.event.on("session.updated", calculateMetrics),
        sdk.event.on("session.deleted", calculateMetrics),
        sdk.event.on("session.status", calculateMetrics),
        sdk.event.on("message.updated", calculateMetrics),
      ]

      // Cleanup: unsubscribe from all events
      onCleanup(() => {
        for (const unsub of unsubs) unsub()
      })
    })

    // Derived values
    const efficiencyStatus = createMemo(() => AgentMetrics.getEfficiencyStatus(store.aggregatedMetrics.coordinationEfficiency))

    const errorAmplificationStatus = createMemo(() =>
      AgentMetrics.getErrorAmplificationStatus(store.aggregatedMetrics.errorAmplification),
    )

    const agentCountStatus = createMemo(() => AgentMetrics.getAgentCountStatus(store.aggregatedMetrics.activeAgentCount))

    return {
      data: store,
      ready: true,
      refresh: calculateMetrics,
      analyzeTask: analyzeCurrentTask,

      // Getters for components
      get metrics() {
        return store.aggregatedMetrics
      },
      get taskAnalysis() {
        return store.taskAnalysis
      },
      get sessionMetrics() {
        return store.sessionMetrics
      },

      // Status indicators
      get efficiencyStatus() {
        return efficiencyStatus()
      },
      get errorAmplificationStatus() {
        return errorAmplificationStatus()
      },
      get agentCountStatus() {
        return agentCountStatus()
      },

      // Helper methods
      getSessionMetrics(sessionID: string) {
        return store.sessionMetrics[sessionID]
      },

      isOptimalAgentCount() {
        const count = store.aggregatedMetrics.activeAgentCount
        return count >= AgentMetrics.Thresholds.optimalAgentCountMin && count <= AgentMetrics.Thresholds.optimalAgentCountMax
      },

      shouldWarnAboutMAS() {
        // Warn if baseline is high (>45%) or error amplification is high
        return (
          store.aggregatedMetrics.successRate > AgentMetrics.Thresholds.sasBaselineThreshold ||
          store.aggregatedMetrics.errorAmplification > AgentMetrics.Thresholds.errorAmplificationCritical
        )
      },

      // Formatting helpers
      formatEfficiency(value: number) {
        return `${(value * 100).toFixed(1)}%`
      },

      formatOverhead(value: number) {
        return `${value.toFixed(0)}%`
      },

      formatTokens(value: number) {
        if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`
        if (value >= 1000) return `${(value / 1000).toFixed(1)}K`
        return value.toString()
      },
    }
  },
})
