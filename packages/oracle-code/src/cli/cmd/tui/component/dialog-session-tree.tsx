import { createMemo, For, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useSync } from "../context/sync"
import { useMetrics } from "../context/metrics"
import { useRoute } from "../context/route"

interface SessionNode {
  id: string
  title: string
  isActive: boolean
  children: SessionNode[]
  tokens: number
  messageCount: number
  depth: number
}

/**
 * Session tree dialog
 * Shows hierarchical view of parent/child session relationships
 */
export function DialogSessionTree() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const sync = useSync()
  const metrics = useMetrics()
  const route = useRoute()

  // Set dialog to large size
  dialog.setSize("large")

  // Build session tree
  const sessionTree = createMemo((): SessionNode[] => {
    const sessions = sync.data.session || []
    const statuses = sync.data.session_status || {}
    const sessionMetrics = metrics.sessionMetrics

    // Find root sessions (no parentID)
    const roots = sessions.filter((s) => !s.parentID)

    function buildNode(session: typeof sessions[0], depth: number): SessionNode {
      const children = sessions
        .filter((s) => s.parentID === session.id)
        .map((s) => buildNode(s, depth + 1))

      const sm = sessionMetrics[session.id]

      return {
        id: session.id,
        title: session.title,
        isActive: statuses[session.id]?.type === "busy",
        children,
        tokens: sm?.tokens.total || 0,
        messageCount: sm?.messageCount || 0,
        depth,
      }
    }

    return roots.map((r) => buildNode(r, 0))
  })

  // Flatten tree for display with proper indentation
  const flattenedTree = createMemo((): SessionNode[] => {
    const result: SessionNode[] = []

    function flatten(nodes: SessionNode[]) {
      for (const node of nodes) {
        result.push(node)
        flatten(node.children)
      }
    }

    flatten(sessionTree())
    return result
  })

  // Stats
  const totalSessions = createMemo(() => flattenedTree().length)
  const activeSessions = createMemo(() => flattenedTree().filter((n) => n.isActive).length)
  const totalSubagents = createMemo(() => flattenedTree().filter((n) => n.depth > 0).length)

  // Handle keyboard input
  useKeyboard((evt) => {
    if (evt.name === "q") {
      dialog.clear()
    }
  })

  // Navigate to session
  function navigateToSession(sessionID: string) {
    route.navigate({ type: "session", sessionID })
    dialog.clear()
  }

  // Format tokens
  function formatTokens(tokens: number) {
    if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`
    return tokens.toString()
  }

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1}>
      <box marginBottom={1}>
        <text fg={theme.text}>
          <b>Session Hierarchy</b>
        </text>
        <text fg={theme.textMuted}>
          {totalSessions()} total | {activeSessions()} active | {totalSubagents()} subagent{totalSubagents() !== 1 ? "s" : ""}
        </text>
      </box>

      <Show
        when={flattenedTree().length > 0}
        fallback={
          <box marginTop={1}>
            <text fg={theme.textMuted}>No sessions found. Start a conversation to see the session tree.</text>
          </box>
        }
      >
        <box>
          <For each={flattenedTree()}>
            {(node) => {
              const indent = "  ".repeat(node.depth)
              const prefix = node.depth === 0 ? "●" : "└─"
              const agentMatch = node.title.match(/@(\w+)/)
              const agentName = agentMatch?.[1]

              return (
                <box
                  flexDirection="row"
                  gap={1}
                  onMouseDown={() => navigateToSession(node.id)}
                  paddingTop={node.depth === 0 && flattenedTree().indexOf(node) > 0 ? 1 : 0}
                >
                  <text fg={theme.textMuted}>{indent}{prefix}</text>
                  <text fg={node.isActive ? theme.success : theme.textMuted}>
                    {node.isActive ? "●" : "○"}
                  </text>
                  <Show when={agentName}>
                    <text fg={theme.info}>@{agentName}</text>
                  </Show>
                  <text fg={theme.text} overflow="hidden">
                    {node.title.slice(0, 35)}{node.title.length > 35 ? "..." : ""}
                  </text>
                  <box flexGrow={1} />
                  <text fg={theme.textMuted}>
                    {formatTokens(node.tokens)} tok
                  </text>
                  <text fg={theme.textMuted}>
                    {node.messageCount} msg
                  </text>
                </box>
              )
            }}
          </For>
        </box>

        {/* Legend */}
        <box marginTop={1}>
          <text fg={theme.textMuted}>
            <b>Legend:</b>
          </text>
          <box flexDirection="row" gap={2} paddingLeft={1}>
            <text fg={theme.textMuted}>
              <span style={{ fg: theme.success }}>●</span> Active
            </text>
            <text fg={theme.textMuted}>
              <span style={{ fg: theme.textMuted }}>○</span> Idle
            </text>
            <text fg={theme.textMuted}>
              <span style={{ fg: theme.info }}>@name</span> Agent
            </text>
          </box>
        </box>

        {/* Coordination Overview */}
        <Show when={totalSubagents() > 0}>
          <box marginTop={1}>
            <text fg={theme.text}>
              <b>Coordination</b>
            </text>
            <box paddingLeft={1}>
              <text fg={theme.textMuted}>
                Active agents: {activeSessions()} / {totalSubagents()} subagents
              </text>
              <text fg={theme.textMuted}>
                Depth levels: {Math.max(...flattenedTree().map((n) => n.depth)) + 1}
              </text>
              <text fg={theme.textMuted}>
                Total tokens: {formatTokens(flattenedTree().reduce((sum, n) => sum + n.tokens, 0))}
              </text>
            </box>
          </box>
        </Show>
      </Show>

      {/* Footer */}
      <box marginTop={1}>
        <text fg={theme.textMuted}>
          Click a session to navigate | Press <b>ESC</b> or <b>q</b> to close
        </text>
      </box>
    </box>
  )
}
