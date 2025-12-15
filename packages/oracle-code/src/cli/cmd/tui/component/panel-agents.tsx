import { For, Show, createMemo, createSignal } from "solid-js"
import { useAgents } from "../context/agents"
import { useTheme } from "../context/theme"
import { useLocal } from "../context/local"
import { useSync } from "../context/sync"
import { useMetrics } from "../context/metrics"
import { useDialog } from "../ui/dialog"
import { useOrchestration } from "../context/orchestration"
import { useAnalysisMode } from "../context/analysis-mode"
import { DialogAgentLanes } from "./dialog-agent-lanes"
import { DialogOrchestration } from "./dialog-orchestration"

interface AgentLane {
  id: string
  name: string
  status: "busy" | "idle" | "waiting"
  title: string
  messageCount: number
  elapsed: number
}

/**
 * AgentsPanel - Unified agent orchestration and coordination panel
 *
 * Shows:
 * - Agent lanes (active subagent sessions)
 * - Orchestration strategy controls
 * - Analysis mode indicator
 * - Coordination metrics (Ec, Ae)
 */
export function AgentsPanel() {
  const agents = useAgents()
  const local = useLocal()
  const sync = useSync()
  const { theme } = useTheme()
  const metrics = useMetrics()
  const dialog = useDialog()
  const orchestration = useOrchestration()
  const analysisMode = useAnalysisMode()

  const [expanded, setExpanded] = createSignal(true)

  const subagents = createMemo(() => {
    return local.agent.list().filter((a) => a.mode === "subagent")
  })

  const subagentSessions = createMemo(() => {
    return agents.getSubagentSessions()
  })

  const activeSessions = createMemo(() => {
    const statuses = sync.data.session_status || {}
    return subagentSessions().filter((s) => statuses[s.id]?.type === "busy")
  })

  // Build lane data for active sessions
  const lanes = createMemo((): AgentLane[] => {
    try {
      const statuses = sync.data.session_status || {}
      const messages = sync.data.message || {}
      const sessions = subagentSessions()

      if (!sessions || sessions.length === 0) return []

      return sessions
        .map((session) => {
          const status = statuses[session.id]
          const sessionMessages = messages[session.id] || []
          const match = session.title?.match(/@(\w+)/)
          const agentName = match?.[1] || "agent"

          // Extract task description (remove @agent prefix)
          const taskTitle = (session.title || "").replace(/@\w+:?\s*/, "").trim() || "working..."

          // Ensure elapsed is never negative (clock skew protection)
          const timestamp = session.time?.updated || session.time?.created || Date.now()
          const elapsed = Math.max(0, Date.now() - timestamp)

          return {
            id: session.id,
            name: agentName,
            status: status?.type === "busy" ? ("busy" as const) : ("idle" as const),
            title: taskTitle,
            messageCount: sessionMessages.length,
            elapsed,
          }
        })
        .sort((a, b) => {
          // Busy first, then by most recent
          if (a.status === "busy" && b.status !== "busy") return -1
          if (a.status !== "busy" && b.status === "busy") return 1
          return a.elapsed - b.elapsed
        })
    } catch (error) {
      // Defensive: return empty array on any error
      console.error("Error building agent lanes:", error)
      return []
    }
  })

  // Only show if there are subagents or subagent sessions
  const shouldShow = createMemo(() => {
    return subagents().length > 0 || subagentSessions().length > 0
  })

  // Metrics status colors
  const efficiencyColor = createMemo(() => {
    const status = metrics.efficiencyStatus
    return status === "success" ? theme.success : status === "warning" ? theme.warning : theme.error
  })

  const errorAmpColor = createMemo(() => {
    const status = metrics.errorAmplificationStatus
    return status === "success" ? theme.success : status === "warning" ? theme.warning : theme.error
  })

  // Error amplification warning level
  const errorAmpWarning = createMemo(() => {
    const ae = metrics.metrics.errorAmplification
    if (ae > 10) return "critical"
    if (ae > 5) return "warning"
    return null
  })

  const formatElapsed = (ms: number) => {
    if (ms < 60000) return `${Math.floor(ms / 1000)}s`
    if (ms < 3600000) return `${Math.floor(ms / 60000)}m`
    return `${Math.floor(ms / 3600000)}h`
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "busy":
        return "●"
      case "waiting":
        return "◐"
      case "idle":
        return "○"
      default:
        return "○"
    }
  }

  const openLanesDialog = () => {
    dialog.replace(() => <DialogAgentLanes />)
  }

  const openOrchestrationDialog = () => {
    dialog.replace(() => <DialogOrchestration />)
  }

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

  return (
    <Show when={shouldShow()}>
      <box marginTop={1}>
        <box flexDirection="row" gap={1} onMouseDown={() => setExpanded(!expanded())}>
          <text fg={theme.text}>{expanded() ? "▼" : "▶"}</text>
          <text fg={theme.text}>
            <b>Agents</b>
          </text>
          <Show when={activeSessions().length > 0}>
            <text fg={theme.success}>({activeSessions().length} active)</text>
          </Show>
          <Show when={!expanded() && orchestration.enableCritic}>
            <text fg={theme.error}>CRIT</text>
          </Show>
          <Show when={!expanded() && errorAmpWarning()}>
            <text fg={errorAmpWarning() === "critical" ? theme.error : theme.warning}>⚠</text>
          </Show>
        </box>

        <Show when={expanded()}>
          {/* Agent Lanes - Visual representation of active work */}
          <Show when={lanes().length > 0}>
            <box paddingLeft={1} marginTop={1}>
              <For each={lanes().slice(0, 4)}>
                {(lane) => (
                  <box marginBottom={1}>
                    {/* Lane header */}
                    <box flexDirection="row" gap={1}>
                      <text fg={theme.textMuted}>┌─</text>
                      <text fg={local.agent.color(lane.name)}>@{lane.name}</text>
                      <text fg={theme.textMuted}>{"─".repeat(Math.max(1, 20 - lane.name.length))}</text>
                    </box>
                    {/* Lane content */}
                    <box flexDirection="row" gap={1}>
                      <text fg={theme.textMuted}>│</text>
                      <text fg={lane.status === "busy" ? theme.success : theme.textMuted}>
                        {getStatusIcon(lane.status)}
                      </text>
                      <text fg={theme.text}>
                        {lane.title.length > 22 ? lane.title.slice(0, 19) + "..." : lane.title}
                      </text>
                    </box>
                    {/* Lane stats */}
                    <box flexDirection="row" gap={1}>
                      <text fg={theme.textMuted}>│</text>
                      <text fg={theme.textMuted}>
                        {"  "}
                        {lane.messageCount} msgs · {formatElapsed(lane.elapsed)}
                      </text>
                    </box>
                    {/* Lane footer */}
                    <text fg={theme.textMuted}>└{"─".repeat(26)}</text>
                  </box>
                )}
              </For>
              <Show when={lanes().length > 4}>
                <box flexDirection="row" gap={1} onMouseDown={openLanesDialog}>
                  <text fg={theme.info}>[+{lanes().length - 4} more lanes]</text>
                </box>
              </Show>
            </box>
          </Show>

          {/* Available Subagents (when no active lanes) */}
          <Show when={lanes().length === 0 && subagents().length > 0}>
            <box paddingLeft={1} marginTop={1}>
              <text fg={theme.textMuted}>Available</text>
              <box paddingLeft={1}>
                <For each={subagents()}>
                  {(agent) => <text fg={local.agent.color(agent.name)}>@{agent.name} </text>}
                </For>
              </box>
            </box>
          </Show>

          {/* Orchestration Controls */}
          <Show when={lanes().length > 0}>
            <text fg={theme.textMuted} marginTop={1}>
              ─ Orchestration
            </text>
            <box paddingLeft={1}>
              <box flexDirection="row" gap={1}>
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
              <box flexDirection="row" gap={1}>
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
              </box>
              <Show when={orchestration.autoRoute}>
                <text fg={theme.success}>● Auto-routing enabled</text>
              </Show>
            </box>
          </Show>

          {/* Analysis Mode Indicator */}
          <Show when={analysisMode.isActive}>
            <text fg={theme.textMuted} marginTop={1}>
              ─ Analysis
            </text>
            <box paddingLeft={1}>
              <text fg={theme.info}>{analysisMode.modeInfo.name} mode active</text>
            </box>
          </Show>

          {/* Compact Coordination Metrics */}
          <Show when={lanes().length > 0 || (metrics?.metrics?.totalTurns ?? 0) > 0}>
            <text fg={theme.textMuted} marginTop={1}>
              ─ Metrics
            </text>
            <box paddingLeft={1} flexDirection="row" gap={1}>
              <text fg={efficiencyColor()}>
                Ec:{metrics?.formatEfficiency?.(metrics?.metrics?.coordinationEfficiency ?? 0) ?? "N/A"}
              </text>
              <Show when={(metrics?.metrics?.errorAmplification ?? 0) > 1}>
                <text fg={errorAmpColor()}>Ae:{(metrics?.metrics?.errorAmplification ?? 0).toFixed(1)}x</text>
              </Show>
              <Show when={(metrics?.metrics?.activeAgentCount ?? 0) > 4}>
                <text fg={theme.warning}>[{metrics?.metrics?.activeAgentCount ?? 0} agents]</text>
              </Show>
            </box>
            <Show when={errorAmpWarning()}>
              <box paddingLeft={1}>
                <text fg={errorAmpWarning() === "critical" ? theme.error : theme.warning}>
                  ⚠ Error amplification {errorAmpWarning() === "critical" ? "CRITICAL" : "high"}
                </text>
              </box>
            </Show>
          </Show>

          {/* Dialog links */}
          <Show when={lanes().length > 0}>
            <box paddingLeft={1} marginTop={1} flexDirection="row" gap={2}>
              <box onMouseDown={openLanesDialog}>
                <text fg={theme.info}>[Lanes]</text>
              </box>
              <box onMouseDown={openOrchestrationDialog}>
                <text fg={theme.info}>[Orchestration]</text>
              </box>
            </box>
          </Show>
        </Show>
      </box>
    </Show>
  )
}
