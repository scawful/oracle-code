import { Show, createSignal, createMemo, createResource } from "solid-js"
import { useTheme } from "../context/theme"
import { useAgents } from "../context/agents"
import { useMetrics } from "../context/metrics"
import { useAnalysisMode } from "../context/analysis-mode"
import { useDialog } from "../ui/dialog"
import { useOrchestration } from "../context/orchestration"
import { DialogOrchestration } from "./dialog-orchestration"
import { DialogAgentLanes } from "./dialog-agent-lanes"
import { DialogHivemind } from "./dialog-hivemind"
import { CognitiveIntegration } from "@/cognitive"

/**
 * Compact orchestration panel for sidebar
 * Shows current strategy, agent count, and quick controls
 * Uses shared OrchestrationContext for state synchronization with DialogOrchestration
 */
export function OrchestrationPanel() {
  const { theme } = useTheme()
  const agents = useAgents()
  const metrics = useMetrics()
  const analysisMode = useAnalysisMode()
  const dialog = useDialog()
  const orchestration = useOrchestration()

  const [expanded, setExpanded] = createSignal(false)

  // Only show if there's multi-agent activity or user has expanded
  const shouldShow = createMemo(() => {
    return agents.activeAgents.length > 0 || agents.subagentSessionCount > 0 || expanded()
  })

  // Agent count status
  const agentCountStatus = createMemo(() => {
    const count = agents.activeAgents.length
    if (count === 0) return "idle"
    if (count <= 4) return "optimal"
    return "warning"
  })

  const agentCountColor = createMemo(() => {
    const status = agentCountStatus()
    return status === "optimal" ? theme.success : status === "warning" ? theme.warning : theme.textMuted
  })

  // Error amplification warning
  const errorAmpWarning = createMemo(() => {
    const ae = metrics.metrics.errorAmplification
    if (ae > 10) return "critical"
    if (ae > 5) return "warning"
    return null
  })

  function cycleStrategy() {
    orchestration.cycleStrategy(1)
  }

  function toggleCritic() {
    const newState = orchestration.toggleCritic()
    // Sync with analysis mode
    if (newState) {
      analysisMode.setMode("critic")
    } else if (analysisMode.isCriticMode()) {
      analysisMode.setMode("none")
    }
  }

  function openFullDialog() {
    dialog.replace(() => <DialogOrchestration />)
  }

  function openLanesDialog() {
    dialog.replace(() => <DialogAgentLanes />)
  }

  function openHivemindDialog() {
    dialog.replace(() => <DialogHivemind />)
  }

  // Load hivemind summary
  const [hivemindSummary] = createResource(async () => {
    return CognitiveIntegration.getHivemindSummary()
  })

  return (
    <Show when={shouldShow()}>
      <box marginTop={1}>
        <box flexDirection="row" gap={1} onMouseDown={() => setExpanded(!expanded())}>
          <text fg={theme.text}>{expanded() ? "▼" : "▶"}</text>
          <text fg={theme.text}>
            <b>Orchestration</b>
          </text>
          <Show when={!expanded()}>
            {/* Compact summary when collapsed */}
            <text fg={theme.info}>{orchestration.strategyInfo.shortName}</text>
            <Show when={agents.activeAgents.length > 0}>
              <text fg={agentCountColor()}>({agents.activeAgents.length})</text>
            </Show>
            <Show when={orchestration.enableCritic}>
              <text fg={theme.error}>CRIT</text>
            </Show>
          </Show>
          <Show when={expanded() && agents.activeAgents.length > 0}>
            <text fg={agentCountColor()}>({agents.activeAgents.length})</text>
          </Show>
          <Show when={errorAmpWarning()}>
            <text fg={errorAmpWarning() === "critical" ? theme.error : theme.warning}>⚠</text>
          </Show>
        </box>

        <Show when={expanded()}>
          {/* Strategy Quick Toggle */}
          <box paddingLeft={1} marginTop={1} flexDirection="row" gap={1}>
            <text fg={theme.textMuted}>Strategy:</text>
            <box
              onMouseDown={(e) => {
                e.stopPropagation()
                cycleStrategy()
              }}
            >
              <text fg={theme.info}>[{orchestration.strategyInfo.shortName}]</text>
            </box>
            <text fg={theme.textMuted}>({orchestration.strategyInfo.errorAmp})</text>
          </box>

          {/* Agent Count */}
          <box paddingLeft={1} flexDirection="row" gap={1}>
            <text fg={theme.textMuted}>Agents:</text>
            <text fg={agentCountColor()}>{agents.activeAgents.length}</text>
            <text fg={theme.textMuted}>/ {orchestration.maxParallel} max</text>
          </box>

          {/* Execution Mode */}
          <box paddingLeft={1} flexDirection="row" gap={1}>
            <text fg={theme.textMuted}>Mode:</text>
            <text fg={orchestration.parallelMode === "concurrent" ? theme.info : theme.textMuted}>
              {orchestration.parallelMode === "concurrent" ? "Concurrent" : "Sequential"}
            </text>
          </box>

          {/* Critic Toggle */}
          <box paddingLeft={1} flexDirection="row" gap={1}>
            <text fg={theme.textMuted}>Critic:</text>
            <box
              onMouseDown={(e) => {
                e.stopPropagation()
                toggleCritic()
              }}
            >
              <text fg={orchestration.enableCritic ? theme.error : theme.textMuted}>
                [{orchestration.enableCritic ? "ON" : "off"}]
              </text>
            </box>
            <Show when={orchestration.enableCritic}>
              <text fg={theme.textMuted}>(harsh mode)</text>
            </Show>
          </box>

          {/* Auto Route indicator */}
          <Show when={orchestration.autoRoute}>
            <box paddingLeft={1} flexDirection="row" gap={1}>
              <text fg={theme.success}>● Auto-routing enabled</text>
            </box>
          </Show>

          {/* Error Amplification Warning */}
          <Show when={errorAmpWarning()}>
            <box paddingLeft={1} marginTop={1}>
              <text fg={errorAmpWarning() === "critical" ? theme.error : theme.warning}>
                Ae: {metrics.metrics.errorAmplification.toFixed(1)}x
                {errorAmpWarning() === "critical" ? " CRITICAL" : " high"}
              </text>
            </box>
          </Show>

          {/* Dialog buttons */}
          <box paddingLeft={1} marginTop={1} flexDirection="row" gap={2}>
            <box
              onMouseDown={(e) => {
                e.stopPropagation()
                openLanesDialog()
              }}
            >
              <text fg={theme.info}>[Lanes]</text>
            </box>
            <box
              onMouseDown={(e) => {
                e.stopPropagation()
                openFullDialog()
              }}
            >
              <text fg={theme.info}>[Dashboard]</text>
            </box>
          </box>

          {/* Hivemind Section */}
          <Show when={hivemindSummary()}>
            <box marginTop={1}>
              <box flexDirection="row" gap={1}>
                <text fg={theme.text}>
                  <b>Hivemind</b>
                </text>
                <text fg={theme.textMuted}>
                  ({hivemindSummary()!.project.total} entries)
                </text>
              </box>
              <box paddingLeft={1} flexDirection="row" gap={2}>
                <text fg={theme.success}>★{hivemindSummary()!.project.golden}</text>
                <Show when={hivemindSummary()!.project.decaying > 0}>
                  <text fg={theme.warning}>◐{hivemindSummary()!.project.decaying}</text>
                </Show>
                <Show when={hivemindSummary()!.project.contested > 0}>
                  <text fg={theme.error}>⚡{hivemindSummary()!.project.contested}</text>
                </Show>
                <Show when={hivemindSummary()!.project.councils > 0}>
                  <text fg={theme.info}>⏳{hivemindSummary()!.project.councils}</text>
                </Show>
              </box>
              <box
                paddingLeft={1}
                marginTop={1}
                onMouseDown={(e) => {
                  e.stopPropagation()
                  openHivemindDialog()
                }}
              >
                <text fg={theme.info}>[Hivemind Dashboard]</text>
              </box>
            </box>
          </Show>
        </Show>
      </box>
    </Show>
  )
}
