import { createMemo, For, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useMetrics } from "../context/metrics"
import { useSync } from "../context/sync"
import { AgentMetrics } from "@/metrics"

/**
 * Full metrics dashboard dialog
 * Shows detailed coordination metrics, per-session breakdown, and task analysis
 */
export function DialogMetrics() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const metrics = useMetrics()

  // Set dialog to large size for full dashboard view
  dialog.setSize("large")

  const sessionMetricsList = createMemo(() => {
    return Object.values(metrics.sessionMetrics).sort(
      (a, b) => b.timing.started - a.timing.started
    )
  })

  const efficiencyStatus = createMemo(() => metrics.efficiencyStatus)
  const errorAmpStatus = createMemo(() => metrics.errorAmplificationStatus)

  const statusColor = (status: "success" | "warning" | "error") => {
    return status === "success" ? theme.success : status === "warning" ? theme.warning : theme.error
  }

  // Analyze current task when dialog opens
  const taskAnalysis = createMemo(() => {
    if (!metrics.taskAnalysis) {
      metrics.analyzeTask()
    }
    return metrics.taskAnalysis
  })

  // Handle keyboard input
  useKeyboard((evt) => {
    if (evt.name === "q") {
      dialog.clear()
    }
  })

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1}>
      <box marginBottom={1}>
        <text fg={theme.text}>
          <b>Coordination Metrics</b>
        </text>
        <text fg={theme.textMuted}>
          Based on "Towards a Science of Scaling Agent Systems" (arXiv:2512.08296)
        </text>
      </box>

      {/* Main Metrics Grid */}
      <box flexDirection="row" gap={2} marginBottom={1}>
        {/* Efficiency Column */}
        <box flexGrow={1}>
          <text fg={theme.text}>
            <b>Efficiency</b>
          </text>
          <box flexDirection="row" gap={1}>
            <text fg={statusColor(efficiencyStatus())}>●</text>
            <text fg={theme.text}>
              Ec: {metrics.formatEfficiency(metrics.metrics.coordinationEfficiency)}
            </text>
          </box>
          <text fg={theme.textMuted}>SAS baseline: {metrics.formatEfficiency(AgentMetrics.Thresholds.efficiency.sas)}</text>
          <text fg={theme.textMuted}>Success/1K: {metrics.metrics.successPer1KTokens.toFixed(1)}</text>
        </box>

        {/* Error Column */}
        <box flexGrow={1}>
          <text fg={theme.text}>
            <b>Errors</b>
          </text>
          <box flexDirection="row" gap={1}>
            <text fg={statusColor(errorAmpStatus())}>●</text>
            <text fg={theme.text}>Ae: {metrics.metrics.errorAmplification.toFixed(1)}x</text>
          </box>
          <text fg={theme.textMuted}>SAS: 1.0x</text>
          <text fg={theme.textMuted}>
            {metrics.metrics.errorAmplification <= AgentMetrics.Thresholds.errorAmplification.centralized
              ? "Centralized-level"
              : metrics.metrics.errorAmplification <= AgentMetrics.Thresholds.errorAmplification.decentralized
                ? "Decentralized-level"
                : "Independent-level"}
          </text>
        </box>

        {/* Resource Column */}
        <box flexGrow={1}>
          <text fg={theme.text}>
            <b>Resources</b>
          </text>
          <text fg={theme.textMuted}>Tokens: {metrics.formatTokens(metrics.metrics.totalTokens)}</text>
          <text fg={theme.textMuted}>Turns: {metrics.metrics.totalTurns}</text>
          <text fg={theme.textMuted}>Overhead: {metrics.formatOverhead(metrics.metrics.overheadPercent)}</text>
        </box>
      </box>

      {/* Agent Count */}
      <box marginBottom={1}>
        <box flexDirection="row" gap={1}>
          <text fg={theme.text}>
            <b>Active Agents:</b>
          </text>
          <text fg={statusColor(metrics.agentCountStatus)}>
            {metrics.metrics.activeAgentCount}
          </text>
          <text fg={theme.textMuted}>
            (optimal: {AgentMetrics.Thresholds.optimalAgentCountMin}-{AgentMetrics.Thresholds.optimalAgentCountMax})
          </text>
        </box>
        <box flexDirection="row" gap={1}>
          <text fg={theme.textMuted}>Message Density:</text>
          <text fg={theme.text}>{metrics.metrics.messageDensity.toFixed(2)} msg/turn</text>
          <text fg={theme.textMuted}>(plateau: ~0.40)</text>
        </box>
        <box flexDirection="row" gap={1}>
          <text fg={theme.textMuted}>Redundancy:</text>
          <text fg={metrics.metrics.redundancy > 0.5 ? theme.warning : theme.text}>
            {(metrics.metrics.redundancy * 100).toFixed(0)}%
          </text>
          <text fg={theme.textMuted}>(high &gt;50% hurts)</text>
        </box>
      </box>

      {/* Task Analysis */}
      <Show when={taskAnalysis()}>
        <box marginTop={1} marginBottom={1}>
          <text fg={theme.text}>
            <b>Routing Recommendation</b>
          </text>
          <box flexDirection="row" gap={1}>
            <text fg={theme.text}>Architecture:</text>
            <text
              fg={
                taskAnalysis()!.recommendedArchitecture === "single"
                  ? theme.success
                  : taskAnalysis()!.recommendedArchitecture === "centralized"
                    ? theme.info
                    : theme.warning
              }
            >
              {taskAnalysis()!.recommendedArchitecture.toUpperCase()}
            </text>
            <text fg={theme.textMuted}>({(taskAnalysis()!.confidence * 100).toFixed(0)}% conf)</text>
          </box>
          <text fg={theme.textMuted} wrapMode="word">
            {taskAnalysis()!.recommendationRationale}
          </text>
          <box marginTop={1} flexDirection="row" gap={2}>
            <text fg={theme.textMuted}>
              Decomposability: {(taskAnalysis()!.decomposability * 100).toFixed(0)}%
            </text>
            <text fg={theme.textMuted}>
              Complexity: {(taskAnalysis()!.domainComplexity * 100).toFixed(0)}%
            </text>
            <text fg={taskAnalysis()!.toolHeavy ? theme.warning : theme.textMuted}>
              Tools: {taskAnalysis()!.toolCount} {taskAnalysis()!.toolHeavy ? "(heavy)" : ""}
            </text>
          </box>
        </box>
      </Show>

      {/* Per-Session Breakdown */}
      <Show when={sessionMetricsList().length > 0}>
        <box marginTop={1}>
          <text fg={theme.text}>
            <b>Session Breakdown</b> ({sessionMetricsList().length} sessions)
          </text>
          <For each={sessionMetricsList().slice(0, 8)}>
            {(session) => (
              <box flexDirection="row" gap={1} marginTop={1}>
                <text fg={session.parentID ? theme.textMuted : theme.text}>
                  {session.parentID ? "└─" : "●"}
                </text>
                <text fg={theme.text}>@{session.agentName}</text>
                <text fg={theme.textMuted}>
                  {metrics.formatTokens(session.tokens.total)} tokens
                </text>
                <text fg={theme.textMuted}>{session.messageCount} msgs</text>
                <Show when={session.timing.duration}>
                  <text fg={theme.textMuted}>
                    {Math.round(session.timing.duration! / 1000)}s
                  </text>
                </Show>
              </box>
            )}
          </For>
          <Show when={sessionMetricsList().length > 8}>
            <text fg={theme.textMuted} marginTop={1}>
              ... and {sessionMetricsList().length - 8} more sessions
            </text>
          </Show>
        </box>
      </Show>

      {/* Warning Section */}
      <Show when={metrics.shouldWarnAboutMAS()}>
        <box
          marginTop={1}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={1}
          paddingRight={1}
          backgroundColor={theme.warning + "33"}
        >
          <text fg={theme.warning}>
            <b>MAS Warning</b>
          </text>
          <text fg={theme.textMuted} wrapMode="word">
            Current baseline ({metrics.formatEfficiency(metrics.metrics.successRate)}) may exceed threshold
            for multi-agent benefits. Consider single-agent approach.
          </text>
        </box>
      </Show>

      {/* Footer */}
      <box marginTop={1}>
        <text fg={theme.textMuted}>
          Press <b>ESC</b> or <b>q</b> to close
        </text>
      </box>
    </box>
  )
}
