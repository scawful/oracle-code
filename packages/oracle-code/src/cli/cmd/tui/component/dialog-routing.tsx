import { createMemo, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useMetrics } from "../context/metrics"
import { AgentMetrics } from "@/metrics"

/**
 * Routing recommendation dialog
 * Shows task analysis and architecture recommendations based on research paper
 */
export function DialogRouting() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const metrics = useMetrics()

  // Analyze task when dialog opens
  const analysis = createMemo(() => {
    return metrics.analyzeTask()
  })

  const archColor = (arch: string) => {
    switch (arch) {
      case "single":
        return theme.success
      case "centralized":
        return theme.info
      case "decentralized":
        return theme.warning
      case "hybrid":
        return theme.error
      default:
        return theme.text
    }
  }

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
          <b>Routing Recommendation</b>
        </text>
        <text fg={theme.textMuted}>
          Based on "Towards a Science of Scaling Agent Systems" (arXiv:2512.08296)
        </text>
      </box>

      <Show when={analysis()}>
        {/* Main Recommendation */}
        <box marginBottom={1}>
          <box flexDirection="row" gap={1}>
            <text fg={theme.text}>
              <b>Recommended Architecture:</b>
            </text>
            <text fg={archColor(analysis()!.recommendedArchitecture)}>
              <b>{analysis()!.recommendedArchitecture.toUpperCase()}</b>
            </text>
          </box>
          <box flexDirection="row" gap={1}>
            <text fg={theme.textMuted}>Confidence:</text>
            <text fg={theme.text}>{(analysis()!.confidence * 100).toFixed(0)}%</text>
          </box>
        </box>

        {/* Rationale */}
        <box marginBottom={1}>
          <text fg={theme.text}>
            <b>Rationale</b>
          </text>
          <text fg={theme.textMuted} wrapMode="word">
            {analysis()!.recommendationRationale}
          </text>
        </box>

        {/* Task Analysis */}
        <box marginBottom={1}>
          <text fg={theme.text}>
            <b>Task Analysis</b>
          </text>
          <box paddingLeft={1}>
            <box flexDirection="row" gap={1}>
              <text fg={theme.textMuted}>Decomposability:</text>
              <text fg={analysis()!.decomposability > 0.5 ? theme.success : theme.warning}>
                {(analysis()!.decomposability * 100).toFixed(0)}%
              </text>
              <text fg={theme.textMuted}>(higher = more parallelizable)</text>
            </box>
            <box flexDirection="row" gap={1}>
              <text fg={theme.textMuted}>Domain Complexity:</text>
              <text fg={analysis()!.domainComplexity > 0.5 ? theme.warning : theme.success}>
                {(analysis()!.domainComplexity * 100).toFixed(0)}%
              </text>
            </box>
            <box flexDirection="row" gap={1}>
              <text fg={theme.textMuted}>Tool Count:</text>
              <text fg={analysis()!.toolHeavy ? theme.warning : theme.text}>
                {analysis()!.toolCount} {analysis()!.toolHeavy ? "(tool-heavy, >8)" : ""}
              </text>
            </box>
            <box flexDirection="row" gap={1}>
              <text fg={theme.textMuted}>SAS Baseline:</text>
              <text fg={analysis()!.singleAgentBaseline > 0.45 ? theme.warning : theme.success}>
                {(analysis()!.singleAgentBaseline * 100).toFixed(0)}%
              </text>
              <text fg={theme.textMuted}>(threshold: 45%)</text>
            </box>
          </box>
        </box>

        {/* Warnings */}
        <Show when={analysis()!.singleAgentBaseline > AgentMetrics.Thresholds.sasBaselineThreshold}>
          <box
            marginBottom={1}
            paddingTop={1}
            paddingBottom={1}
            paddingLeft={1}
            paddingRight={1}
            backgroundColor={theme.warning + "33"}
          >
            <text fg={theme.warning}>
              <b>Capability Ceiling Warning</b>
            </text>
            <text fg={theme.textMuted} wrapMode="word">
              Single-agent baseline ({(analysis()!.singleAgentBaseline * 100).toFixed(0)}%) exceeds 45% threshold.
              Multi-agent systems typically yield negative returns above this threshold due to coordination overhead.
            </text>
          </box>
        </Show>

        <Show when={analysis()!.toolHeavy}>
          <box
            marginBottom={1}
            paddingTop={1}
            paddingBottom={1}
            paddingLeft={1}
            paddingRight={1}
            backgroundColor={theme.info + "33"}
          >
            <text fg={theme.info}>
              <b>Tool-Heavy Task</b>
            </text>
            <text fg={theme.textMuted} wrapMode="word">
              Tasks with &gt;8 tools show significant MAS penalty (beta=-0.330).
              Efficiency penalties compound with coordination complexity.
            </text>
          </box>
        </Show>

        {/* Architecture Comparison */}
        <box marginTop={1}>
          <text fg={theme.text}>
            <b>Architecture Trade-offs</b>
          </text>
          <box paddingLeft={1}>
            <text fg={theme.success}>Single Agent (SAS)</text>
            <text fg={theme.textMuted} paddingLeft={1}>
              Ec: {(AgentMetrics.Thresholds.efficiency.sas * 100).toFixed(0)}% | Ae: 1.0x | Best for sequential tasks
            </text>

            <text fg={theme.info}>Centralized</text>
            <text fg={theme.textMuted} paddingLeft={1}>
              Ec: {(AgentMetrics.Thresholds.efficiency.centralized * 100).toFixed(0)}% | Ae: 4.4x | +81% on parallelizable tasks
            </text>

            <text fg={theme.warning}>Decentralized</text>
            <text fg={theme.textMuted} paddingLeft={1}>
              Ec: {(AgentMetrics.Thresholds.efficiency.decentralized * 100).toFixed(0)}% | Ae: 7.8x | +9.2% on exploration tasks
            </text>

            <text fg={theme.textMuted}>Hybrid</text>
            <text fg={theme.textMuted} paddingLeft={1}>
              Ec: {(AgentMetrics.Thresholds.efficiency.hybrid * 100).toFixed(0)}% | Highest overhead (515%)
            </text>
          </box>
        </box>

        {/* Key Thresholds */}
        <box marginTop={1}>
          <text fg={theme.text}>
            <b>Key Thresholds</b>
          </text>
          <box paddingLeft={1}>
            <text fg={theme.textMuted}>Optimal agent count: 3-4</text>
            <text fg={theme.textMuted}>Message density plateau: ~0.40 msg/turn</text>
            <text fg={theme.textMuted}>MAS benefit threshold: SAS baseline &lt;45%</text>
            <text fg={theme.textMuted}>Tool-heavy: &gt;8 tools</text>
          </box>
        </box>
      </Show>

      <Show when={!analysis()}>
        <text fg={theme.textMuted}>Unable to analyze task. Try again later.</text>
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
