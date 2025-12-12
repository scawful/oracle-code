import { Show, createMemo } from "solid-js"
import { useMetrics } from "../../context/metrics"
import { useTheme } from "../../context/theme"

/**
 * MetricsView - Coordination metrics pane view
 *
 * Displays agent coordination metrics based on the paper
 * "Towards a Science of Scaling Agent Systems" (arXiv:2512.08296)
 */

export interface MetricsViewProps {
  /** Whether this pane is currently active/focused */
  isActive?: boolean
}

export function MetricsView(props: MetricsViewProps) {
  const metrics = useMetrics()
  const { theme } = useTheme()

  const efficiencyColor = createMemo(() => {
    const status = metrics.efficiencyStatus
    return status === "success" ? theme.success : status === "warning" ? theme.warning : theme.error
  })

  const errorAmpColor = createMemo(() => {
    const status = metrics.errorAmplificationStatus
    return status === "success" ? theme.success : status === "warning" ? theme.warning : theme.error
  })

  const agentCountColor = createMemo(() => {
    const status = metrics.agentCountStatus
    return status === "success" ? theme.success : status === "warning" ? theme.warning : theme.error
  })

  const hasMetrics = createMemo(() => {
    return metrics.metrics.totalTurns > 0 || metrics.metrics.activeAgentCount > 0
  })

  // Progress bar rendering helper
  const renderBar = (value: number, max: number, width = 20) => {
    const filled = Math.round((value / max) * width)
    const empty = width - filled
    return `${"█".repeat(Math.max(0, filled))}${"░".repeat(Math.max(0, empty))}`
  }

  return (
    <box flexGrow={1} flexDirection="column" overflow="hidden">
      <Show
        when={hasMetrics()}
        fallback={
          <box flexGrow={1} justifyContent="center" alignItems="center">
            <text fg={theme.textMuted}>No metrics data yet.</text>
            <text fg={theme.textMuted} marginTop={1}>
              Metrics track coordination efficiency in multi-agent sessions.
            </text>
          </box>
        }
      >
        <scrollbox flexGrow={1} paddingLeft={1} paddingRight={1} paddingTop={1}>
          {/* Coordination Efficiency */}
          <box marginBottom={2}>
            <text fg={theme.text}>
              <b>Coordination Efficiency (Ec)</b>
            </text>
            <box flexDirection="row" gap={1} marginTop={1}>
              <text fg={efficiencyColor()}>
                {renderBar(metrics.metrics.coordinationEfficiency, 1)}
              </text>
              <text fg={efficiencyColor()}>{metrics.formatEfficiency(metrics.metrics.coordinationEfficiency)}</text>
            </box>
            <text fg={theme.textMuted} marginTop={1}>
              Measures task success relative to SAS baseline. Higher is better.
            </text>
          </box>

          {/* Error Amplification */}
          <box marginBottom={2}>
            <text fg={theme.text}>
              <b>Error Amplification (Ae)</b>
            </text>
            <box flexDirection="row" gap={1} marginTop={1}>
              <text fg={errorAmpColor()}>
                {renderBar(Math.min(metrics.metrics.errorAmplification, 20), 20)}
              </text>
              <text fg={errorAmpColor()}>{metrics.metrics.errorAmplification.toFixed(1)}x</text>
            </box>
            <text fg={theme.textMuted} marginTop={1}>
              How errors propagate across agents. Lower is better.
            </text>
            <Show when={metrics.metrics.errorAmplification > 10}>
              <text fg={theme.warning}> Warning: High error amplification!</text>
            </Show>
          </box>

          {/* Message Density */}
          <box marginBottom={2}>
            <text fg={theme.text}>
              <b>Message Density</b>
            </text>
            <box flexDirection="row" gap={1} marginTop={1}>
              <text fg={theme.info}>
                {renderBar(metrics.metrics.messageDensity, 1)}
              </text>
              <text fg={theme.info}>{(metrics.metrics.messageDensity * 100).toFixed(1)}%</text>
            </box>
            <text fg={theme.textMuted} marginTop={1}>
              Inter-agent messages per turn. Higher = more coordination overhead.
            </text>
          </box>

          {/* Active Agents */}
          <box marginBottom={2}>
            <text fg={theme.text}>
              <b>Active Agents</b>
            </text>
            <box flexDirection="row" gap={1} marginTop={1}>
              <text fg={agentCountColor()}>
                {renderBar(metrics.metrics.activeAgentCount, 10)}
              </text>
              <text fg={agentCountColor()}>{metrics.metrics.activeAgentCount}</text>
            </box>
            <text fg={theme.textMuted} marginTop={1}>
              Optimal range: 2-5 agents. More agents increase coordination overhead.
            </text>
          </box>

          {/* Summary Stats */}
          <box marginBottom={2}>
            <text fg={theme.text}>
              <b>Session Summary</b>
            </text>
            <box marginTop={1} paddingLeft={1}>
              <text fg={theme.textMuted}>Total Turns: {metrics.metrics.totalTurns}</text>
              <text fg={theme.textMuted}>Total Tokens: {metrics.formatTokens(metrics.metrics.totalTokens)}</text>
              <text fg={theme.textMuted}>Overhead: {metrics.formatOverhead(metrics.metrics.overheadPercent)}</text>
              <text fg={theme.textMuted}>
                Success/1K tokens: {metrics.metrics.successPer1KTokens.toFixed(2)}
              </text>
            </box>
          </box>

          {/* Task Analysis (if available) */}
          <Show when={metrics.taskAnalysis}>
            <box marginBottom={2}>
              <text fg={theme.text}>
                <b>Routing Recommendation</b>
              </text>
              <box marginTop={1} paddingLeft={1}>
                <text
                  fg={
                    metrics.taskAnalysis?.recommendedArchitecture === "single"
                      ? theme.success
                      : metrics.taskAnalysis?.recommendedArchitecture === "hybrid"
                        ? theme.warning
                        : theme.info
                  }
                >
                  {metrics.taskAnalysis?.recommendedArchitecture === "single"
                    ? "Single Agent"
                    : metrics.taskAnalysis?.recommendedArchitecture === "hybrid"
                      ? "Hybrid (Start Single)"
                      : "Multi-Agent"}
                </text>
                <text fg={theme.textMuted} marginTop={1}>
                  {metrics.taskAnalysis?.recommendationRationale}
                </text>
              </box>
            </box>
          </Show>

          {/* Thresholds Reference */}
          <box marginBottom={1}>
            <text fg={theme.textMuted}>
              <b>Reference Thresholds</b>
            </text>
            <box marginTop={1} paddingLeft={1}>
              <text fg={theme.textMuted}>• SAS Baseline: 30%</text>
              <text fg={theme.textMuted}>• Independent Ae: 17.2x</text>
              <text fg={theme.textMuted}>• Centralized Ae: 4.4x</text>
              <text fg={theme.textMuted}>• Decentralized Ae: 7.8x</text>
            </box>
          </box>

          {/* Last Updated */}
          <Show when={metrics.data.lastUpdated > 0}>
            <box marginTop={1}>
              <text fg={theme.textMuted}>
                Last updated: {new Date(metrics.data.lastUpdated).toLocaleTimeString()}
              </text>
            </box>
          </Show>
        </scrollbox>
      </Show>
    </box>
  )
}
