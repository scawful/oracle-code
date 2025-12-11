import { For, Show, createMemo, createSignal } from "solid-js"
import { useSwarm } from "../context/swarm"
import { useTheme } from "../context/theme"
import { useLocal } from "../context/local"
import { useSync } from "../context/sync"

export function SwarmPanel() {
  const swarm = useSwarm()
  const local = useLocal()
  const sync = useSync()
  const { theme } = useTheme()

  const [expanded, setExpanded] = createSignal(true)

  const subagents = createMemo(() => {
    return local.agent.list().filter((a) => a.mode === "subagent")
  })

  const subagentSessions = createMemo(() => {
    return swarm.getSubagentSessions()
  })

  const activeSessions = createMemo(() => {
    const statuses = sync.data.session_status || {}
    return subagentSessions().filter((s) => statuses[s.id]?.type === "busy")
  })

  // Only show if there are subagents or subagent sessions
  const shouldShow = createMemo(() => {
    return subagents().length > 0 || subagentSessions().length > 0
  })

  return (
    <Show when={shouldShow()}>
      <box marginTop={1}>
        <box flexDirection="row" gap={1} onMouseDown={() => setExpanded(!expanded())}>
          <text fg={theme.text}>{expanded() ? "▼" : "▶"}</text>
          <text fg={theme.text}>
            <b>Swarm</b>
          </text>
          <Show when={activeSessions().length > 0}>
            <text fg={theme.success}>({activeSessions().length} active)</text>
          </Show>
        </box>

        <Show when={expanded()}>
          {/* Active Sessions */}
          <Show when={activeSessions().length > 0}>
            <box paddingLeft={1} marginTop={1}>
              <text fg={theme.textMuted}>Active Tasks</text>
              <For each={activeSessions().slice(0, 5)}>
                {(session) => {
                  const agentMatch = session.title.match(/@(\w+)/)
                  const agentName = agentMatch?.[1] || "unknown"
                  return (
                    <box flexDirection="row" gap={1} paddingLeft={1}>
                      <text fg={theme.success}>●</text>
                      <text fg={local.agent.color(agentName)}>@{agentName}</text>
                      <text fg={theme.textMuted}>{session.title.slice(0, 25)}...</text>
                    </box>
                  )
                }}
              </For>
              <Show when={activeSessions().length > 5}>
                <text fg={theme.textMuted} paddingLeft={1}>
                  ... and {activeSessions().length - 5} more
                </text>
              </Show>
            </box>
          </Show>

          {/* Available Subagents */}
          <Show when={subagents().length > 0}>
            <box paddingLeft={1} marginTop={1}>
              <text fg={theme.textMuted}>Subagents</text>
              <For each={subagents()}>
                {(agent) => (
                  <box flexDirection="row" gap={1} paddingLeft={1}>
                    <text fg={swarm.isAgentActive(agent.name) ? theme.success : theme.textMuted}>
                      {swarm.isAgentActive(agent.name) ? "●" : "○"}
                    </text>
                    <text fg={local.agent.color(agent.name)}>@{agent.name}</text>
                  </box>
                )}
              </For>
            </box>
          </Show>

          {/* Summary stats */}
          <Show when={subagentSessions().length > 0}>
            <box paddingLeft={1} marginTop={1}>
              <text fg={theme.textMuted}>
                {subagentSessions().length} subagent session{subagentSessions().length !== 1 ? "s" : ""}
              </text>
            </box>
          </Show>
        </Show>
      </box>
    </Show>
  )
}
