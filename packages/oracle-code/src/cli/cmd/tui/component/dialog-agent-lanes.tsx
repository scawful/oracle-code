import { createMemo, createSignal, For, Show, onCleanup } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useSync } from "../context/sync"
import { useAgents } from "../context/agents"
import { useOrchestration } from "../context/orchestration"
import { useKeyboardMode, useKeyboardOwnership } from "../context/keyboard-mode"

interface AgentLane {
  id: string
  name: string
  sessionId: string
  status: "busy" | "idle" | "waiting"
  title: string
  lastActivity: number
  messageCount: number
}

/**
 * Multi-agent lanes visualization
 * Shows parallel agent execution with status for each lane
 */
export function DialogAgentLanes() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const sync = useSync()
  const agents = useAgents()
  const orchestration = useOrchestration()
  const keyboard = useKeyboardMode()

  dialog.setSize("large")

  const [selectedLane, setSelectedLane] = createSignal(0)
  const [viewMode, setViewMode] = createSignal<"lanes" | "detail">("lanes")

  // Keyboard handling
  useKeyboardOwnership(
    "agent-lanes",
    {
      mode: "vim-navigation",
      priority: 100,
      onKey: (evt) => {
        handleKeyboard(evt)
        return true
      },
    },
    keyboard,
  )

  function handleKeyboard(evt: { name: string; ctrl?: boolean; shift?: boolean }) {
    const lanes = agentLanes()

    switch (evt.name) {
      case "q":
      case "escape":
        if (viewMode() === "detail") {
          setViewMode("lanes")
        } else {
          dialog.clear()
        }
        break

      case "j":
      case "down":
        if (lanes.length > 0) {
          setSelectedLane((i) => Math.min(i + 1, lanes.length - 1))
        }
        break

      case "k":
      case "up":
        if (lanes.length > 0) {
          setSelectedLane((i) => Math.max(i - 1, 0))
        }
        break

      case "l":
      case "right":
      case "return":
        if (lanes.length > 0 && viewMode() === "lanes") {
          setViewMode("detail")
        }
        break

      case "h":
      case "left":
        if (viewMode() === "detail") {
          setViewMode("lanes")
        }
        break

      case "r":
        agents.refresh()
        break
    }
  }

  // Build agent lanes from session data
  const agentLanes = createMemo(() => {
    const sessions = sync.data.session || []
    const statuses = sync.data.session_status || {}
    const messages = sync.data.message || {}

    // Get subagent sessions (those with parentID)
    const subagentSessions = sessions.filter((s) => s.parentID)

    const lanes: AgentLane[] = subagentSessions.map((session) => {
      const status = statuses[session.id]
      const sessionMessages = messages[session.id] || []

      // Extract agent name from title (e.g., "@explorer: task description")
      const match = session.title.match(/@(\w+)/)
      const agentName = match?.[1] || "unknown"

      return {
        id: session.id,
        name: agentName,
        sessionId: session.id,
        status: status?.type === "busy" ? "busy" : "idle",
        title: session.title,
        lastActivity: session.time.updated || session.time.created,
        messageCount: sessionMessages.length,
      }
    })

    // Sort by status (busy first) then by last activity
    return lanes.sort((a, b) => {
      if (a.status === "busy" && b.status !== "busy") return -1
      if (a.status !== "busy" && b.status === "busy") return 1
      return b.lastActivity - a.lastActivity
    })
  })

  // Get the currently selected lane
  const currentLane = createMemo(() => {
    const lanes = agentLanes()
    const idx = selectedLane()
    return lanes[idx] || null
  })

  // Get messages for current lane
  const currentLaneMessages = createMemo(() => {
    const lane = currentLane()
    if (!lane) return []
    const messages = sync.data.message[lane.sessionId] || []
    return messages.slice(-10) // Last 10 messages
  })

  // Summary stats
  const stats = createMemo(() => {
    const lanes = agentLanes()
    return {
      total: lanes.length,
      busy: lanes.filter((l) => l.status === "busy").length,
      idle: lanes.filter((l) => l.status === "idle").length,
    }
  })

  const getStatusColor = (status: string) => {
    switch (status) {
      case "busy":
        return theme.success
      case "idle":
        return theme.textMuted
      case "waiting":
        return theme.warning
      default:
        return theme.text
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "busy":
        return "●"
      case "idle":
        return "○"
      case "waiting":
        return "◐"
      default:
        return "?"
    }
  }

  const formatTime = (timestamp: number) => {
    const diff = Date.now() - timestamp
    if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
    return `${Math.floor(diff / 3600000)}h ago`
  }

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1}>
      {/* Header */}
      <box flexDirection="row" justifyContent="space-between" marginBottom={1}>
        <box flexDirection="row" gap={2}>
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            Agent Lanes
          </text>
          <text fg={theme.info}>
            {stats().busy}/{stats().total} active
          </text>
          <text fg={theme.textMuted}>
            [{orchestration.strategyInfo.shortName}]
          </text>
        </box>
        <text fg={theme.textMuted}>
          {viewMode() === "lanes" ? "q:close j/k:nav l:detail r:refresh" : "q/h:back"}
        </text>
      </box>

      {/* Strategy Info Bar */}
      <box flexDirection="row" gap={2} marginBottom={1}>
        <text fg={theme.textMuted}>Strategy:</text>
        <text fg={theme.info}>{orchestration.strategyInfo.name}</text>
        <text fg={theme.textMuted}>|</text>
        <text fg={theme.textMuted}>Max Parallel:</text>
        <text fg={orchestration.isOptimalAgentCount ? theme.success : theme.warning}>
          {orchestration.maxParallel}
        </text>
        <text fg={theme.textMuted}>|</text>
        <text fg={theme.textMuted}>Mode:</text>
        <text fg={theme.info}>
          {orchestration.parallelMode === "concurrent" ? "Concurrent" : "Sequential"}
        </text>
      </box>

      {/* Divider */}
      <box marginBottom={1}>
        <text fg={theme.textMuted}>{"─".repeat(60)}</text>
      </box>

      <Show when={agentLanes().length === 0}>
        <box paddingTop={2} paddingBottom={2}>
          <text fg={theme.textMuted}>No active agent sessions</text>
          <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
            Agent lanes will appear here when subagents are spawned
          </text>
        </box>
      </Show>

      <Show when={agentLanes().length > 0}>
        {/* Lanes View */}
        <Show when={viewMode() === "lanes"}>
          <box maxHeight={15}>
            <For each={agentLanes()}>
              {(lane, index) => {
                const isSelected = () => index() === selectedLane()

                return (
                  <box
                    flexDirection="row"
                    gap={1}
                    backgroundColor={isSelected() ? theme.backgroundElement : undefined}
                    paddingLeft={1}
                    paddingRight={1}
                    onMouseDown={() => {
                      setSelectedLane(index())
                      setViewMode("detail")
                    }}
                  >
                    {/* Lane number */}
                    <text fg={theme.textMuted}>{(index() + 1).toString().padStart(2, " ")}.</text>

                    {/* Status indicator */}
                    <text fg={getStatusColor(lane.status)}>{getStatusIcon(lane.status)}</text>

                    {/* Agent name */}
                    <text
                      fg={isSelected() ? theme.info : theme.text}
                      attributes={isSelected() ? TextAttributes.BOLD : undefined}
                    >
                      @{lane.name.padEnd(12)}
                    </text>

                    {/* Title (truncated) */}
                    <text fg={theme.textMuted}>
                      {lane.title.length > 35 ? lane.title.slice(0, 32) + "..." : lane.title.padEnd(35)}
                    </text>

                    {/* Message count */}
                    <text fg={theme.textMuted}>[{lane.messageCount} msgs]</text>

                    {/* Last activity */}
                    <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
                      {formatTime(lane.lastActivity)}
                    </text>
                  </box>
                )
              }}
            </For>
          </box>

          {/* Footer */}
          <box marginTop={1} flexDirection="row" justifyContent="space-between">
            <text fg={theme.textMuted}>
              {selectedLane() + 1}/{agentLanes().length} lanes
            </text>
            <Show when={orchestration.enableCritic}>
              <text fg={theme.error}>CRITIC ENABLED</text>
            </Show>
          </box>
        </Show>

        {/* Detail View */}
        <Show when={viewMode() === "detail" && currentLane()}>
          <box>
            {/* Lane Header */}
            <box flexDirection="row" gap={2} marginBottom={1}>
              <text fg={getStatusColor(currentLane()!.status)}>
                {getStatusIcon(currentLane()!.status)}
              </text>
              <text fg={theme.info} attributes={TextAttributes.BOLD}>
                @{currentLane()!.name}
              </text>
              <text fg={theme.textMuted}>
                ({currentLane()!.status})
              </text>
            </box>

            {/* Task title */}
            <box paddingLeft={2} marginBottom={1}>
              <text fg={theme.text}>{currentLane()!.title}</text>
            </box>

            {/* Session info */}
            <box paddingLeft={2} flexDirection="row" gap={2} marginBottom={1}>
              <text fg={theme.textMuted}>Session:</text>
              <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
                {currentLane()!.sessionId.slice(0, 8)}...
              </text>
              <text fg={theme.textMuted}>|</text>
              <text fg={theme.textMuted}>Messages:</text>
              <text fg={theme.text}>{currentLane()!.messageCount}</text>
              <text fg={theme.textMuted}>|</text>
              <text fg={theme.textMuted}>Last:</text>
              <text fg={theme.text}>{formatTime(currentLane()!.lastActivity)}</text>
            </box>

            {/* Recent messages */}
            <box marginTop={1}>
              <text fg={theme.text} attributes={TextAttributes.BOLD}>
                Recent Activity
              </text>
              <box
                backgroundColor={theme.backgroundElement}
                paddingTop={1}
                paddingBottom={1}
                paddingLeft={2}
                paddingRight={2}
                marginTop={1}
                maxHeight={10}
              >
                <Show when={currentLaneMessages().length === 0}>
                  <text fg={theme.textMuted}>No messages yet</text>
                </Show>
                <For each={currentLaneMessages()}>
                  {(msg) => (
                    <box flexDirection="row" gap={1}>
                      <text fg={msg.role === "user" ? theme.info : theme.success}>
                        {msg.role === "user" ? "→" : "←"}
                      </text>
                      <text fg={theme.textMuted}>
                        {msg.role.padEnd(9)}
                      </text>
                      <text fg={theme.text}>
                        {/* Show first line of content or tool use summary */}
                        {msg.id.slice(0, 8)}...
                      </text>
                    </box>
                  )}
                </For>
              </box>
            </box>
          </box>
        </Show>
      </Show>

      {/* Research note */}
      <box marginTop={1}>
        <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
          Optimal: 3-4 parallel agents (quality degrades beyond)
        </text>
      </box>
    </box>
  )
}
