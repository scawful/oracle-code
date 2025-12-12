import { For, Show, createMemo, createSignal } from "solid-js"
import { useAgents } from "../../context/agents"
import { useTheme } from "../../context/theme"
import { useLocal } from "../../context/local"
import { useSync } from "../../context/sync"
import { useMetrics } from "../../context/metrics"

/**
 * AgentsView - Agent lanes pane view
 *
 * Displays active agent work lanes and coordination status.
 * Adapted from panel-agents.tsx for pane embedding.
 */

export interface AgentsViewProps {
  /** Whether this pane is currently active/focused */
  isActive?: boolean
}

interface AgentLane {
  id: string
  name: string
  status: "busy" | "idle" | "waiting"
  title: string
  messageCount: number
  elapsed: number
}

export function AgentsView(props: AgentsViewProps) {
  const agents = useAgents()
  const local = useLocal()
  const sync = useSync()
  const { theme } = useTheme()
  const metrics = useMetrics()

  const [selectedLane, setSelectedLane] = createSignal<string | null>(null)

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

  // Build lane data for all sessions
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

          const taskTitle = (session.title || "").replace(/@\w+:?\s*/, "").trim() || "working..."

          const timestamp = session.time?.updated || session.time?.created || Date.now()
          const elapsed = Math.max(0, Date.now() - timestamp)

          return {
            id: session.id,
            name: agentName,
            status: (status?.type === "busy" ? "busy" : "idle") as "busy" | "idle",
            title: taskTitle,
            messageCount: sessionMessages.length,
            elapsed,
          }
        })
        .sort((a, b) => {
          if (a.status === "busy" && b.status !== "busy") return -1
          if (a.status !== "busy" && b.status === "busy") return 1
          return a.elapsed - b.elapsed
        })
    } catch (error) {
      console.error("Error building agent lanes:", error)
      return []
    }
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

  const hasData = createMemo(() => {
    return subagents().length > 0 || lanes().length > 0
  })

  return (
    <box flexGrow={1} flexDirection="column" overflow="hidden">
      <Show
        when={hasData()}
        fallback={
          <box flexGrow={1} justifyContent="center" alignItems="center">
            <text fg={theme.textMuted}>No agents configured.</text>
            <text fg={theme.textMuted} marginTop={1}>
              Subagents appear here when spawned during multi-agent coordination.
            </text>
          </box>
        }
      >
        <scrollbox flexGrow={1} paddingLeft={1} paddingRight={1} paddingTop={1}>
          {/* Summary Header */}
          <box marginBottom={2}>
            <box flexDirection="row" gap={2}>
              <text fg={theme.text}>
                <b>Agent Lanes</b>
              </text>
              <Show when={activeSessions().length > 0}>
                <text fg={theme.success}>({activeSessions().length} active)</text>
              </Show>
            </box>

            {/* Compact metrics */}
            <Show when={metrics.metrics.totalTurns > 0}>
              <box flexDirection="row" gap={2} marginTop={1}>
                <text fg={efficiencyColor()}>
                  Ec: {metrics.formatEfficiency(metrics.metrics.coordinationEfficiency)}
                </text>
                <Show when={metrics.metrics.errorAmplification > 1}>
                  <text fg={errorAmpColor()}>Ae: {metrics.metrics.errorAmplification.toFixed(1)}x</text>
                </Show>
                <text fg={theme.textMuted}>Turns: {metrics.metrics.totalTurns}</text>
              </box>
            </Show>
          </box>

          {/* Agent Lanes */}
          <Show when={lanes().length > 0}>
            <For each={lanes()}>
              {(lane) => (
                <box
                  marginBottom={1}
                  onMouseDown={() => setSelectedLane(selectedLane() === lane.id ? null : lane.id)}
                >
                  {/* Lane header */}
                  <box flexDirection="row" gap={1}>
                    <text fg={theme.textMuted}>┌─</text>
                    <text fg={local.agent.color(lane.name)}>@{lane.name}</text>
                    <text fg={theme.textMuted}>{"─".repeat(Math.max(1, 30 - lane.name.length))}</text>
                  </box>

                  {/* Lane content */}
                  <box flexDirection="row" gap={1}>
                    <text fg={theme.textMuted}>│</text>
                    <text fg={lane.status === "busy" ? theme.success : theme.textMuted}>
                      {getStatusIcon(lane.status)}
                    </text>
                    <text fg={theme.text}>
                      {lane.title.length > 40 ? lane.title.slice(0, 37) + "..." : lane.title}
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

                  {/* Expanded details when selected */}
                  <Show when={selectedLane() === lane.id}>
                    <box flexDirection="row" gap={1}>
                      <text fg={theme.textMuted}>│</text>
                      <text fg={theme.textMuted}> Session: {lane.id.slice(0, 12)}...</text>
                    </box>
                  </Show>

                  {/* Lane footer */}
                  <text fg={theme.textMuted}>└{"─".repeat(36)}</text>
                </box>
              )}
            </For>
          </Show>

          {/* Available Subagents (when no active lanes) */}
          <Show when={lanes().length === 0 && subagents().length > 0}>
            <box marginBottom={2}>
              <text fg={theme.text}>
                <b>Available Subagents</b>
              </text>
              <box marginTop={1} flexDirection="row" flexWrap="wrap" gap={1}>
                <For each={subagents()}>
                  {(agent) => (
                    <box
                      paddingLeft={1}
                      paddingRight={1}
                      backgroundColor={theme.backgroundElement}
                    >
                      <text fg={local.agent.color(agent.name)}>@{agent.name}</text>
                    </box>
                  )}
                </For>
              </box>
              <text fg={theme.textMuted} marginTop={1}>
                Subagents will appear as lanes when spawned.
              </text>
            </box>
          </Show>

          {/* Session Metrics Summary */}
          <Show when={Object.keys(metrics.sessionMetrics).length > 0}>
            <box marginTop={2}>
              <text fg={theme.text}>
                <b>Session Breakdown</b>
              </text>
              <box marginTop={1}>
                <For each={Object.entries(metrics.sessionMetrics).slice(0, 5)}>
                  {([sessionId, sessionMetrics]) => (
                    <box flexDirection="row" gap={2} marginTop={1}>
                      <text fg={theme.info}>@{sessionMetrics.agentName}</text>
                      <text fg={theme.textMuted}>
                        {sessionMetrics.messageCount} msgs · {metrics.formatTokens(sessionMetrics.tokens.total)} tokens
                      </text>
                    </box>
                  )}
                </For>
                <Show when={Object.keys(metrics.sessionMetrics).length > 5}>
                  <text fg={theme.textMuted} marginTop={1}>
                    +{Object.keys(metrics.sessionMetrics).length - 5} more sessions
                  </text>
                </Show>
              </box>
            </box>
          </Show>
        </scrollbox>
      </Show>
    </box>
  )
}
