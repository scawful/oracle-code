import { createMemo, createSignal, For, Show } from "solid-js"
import { useSync } from "../context/sync"
import { useTheme } from "../context/theme"
import { useRoute } from "../context/route"
import { useLocal } from "../context/local"
import type { Session } from "@oracle-code/sdk/v2"

/**
 * SubagentTabBar - Shows tabs for main session and active subagents
 *
 * Appears above the main chat area when the current session has subagents.
 * Provides a clear visual hierarchy showing:
 * - Main session always first with a distinct marker
 * - Active subagents as additional tabs
 * - Completed subagents are removed from tabs but accessible via Agents sidebar
 *
 * Click to switch between sessions, keyboard nav via which-key (SPC a n/p)
 */

interface SubagentTabBarProps {
  sessionId: string
}

export function SubagentTabBar(props: SubagentTabBarProps) {
  const sync = useSync()
  const { theme } = useTheme()
  const route = useRoute()
  const local = useLocal()

  // Get the current session
  const currentSession = createMemo(() => sync.session.get(props.sessionId))

  // Get the root/main session (traverse up parent chain)
  const mainSession = createMemo(() => {
    let session = currentSession()
    if (!session) return null

    // Walk up the parent chain to find the root
    while (session?.parentID) {
      const parent = sync.session.get(session.parentID)
      if (!parent) break
      session = parent
    }
    return session
  })

  // Get all active subagents of the main session
  const activeSubagents = createMemo(() => {
    const main = mainSession()
    if (!main) return []

    const statuses = sync.data.session_status || {}

    // Get all sessions that are children of main and are currently busy or recently active
    return sync.data.session
      .filter((s) => {
        if (s.parentID !== main.id) return false
        const status = statuses[s.id]
        // Show if busy, or if idle but was created recently (within last 5 minutes)
        if (status?.type === "busy") return true
        // Show idle subagents for a grace period so they don't instantly disappear
        const fiveMinutesAgo = Date.now() - 5 * 60 * 1000
        return s.time.updated > fiveMinutesAgo
      })
      .sort((a, b) => a.time.created - b.time.created) // Oldest first
  })

  // Check if we should show the tab bar
  const shouldShow = createMemo(() => {
    const subagents = activeSubagents()
    return subagents.length > 0
  })

  // Get the currently active session ID (what we're viewing)
  const activeSessionId = createMemo(() => {
    if (route.data.type !== "session") return null
    return route.data.sessionID
  })

  // Extract agent type from session title (e.g., "@explore: find files...")
  function extractAgentName(session: Session): string {
    const match = session.title.match(/@(\w+)/)
    return match?.[1] || "agent"
  }

  // Get status indicator for a session
  function getStatusIndicator(sessionId: string): string {
    const status = sync.data.session_status?.[sessionId]
    if (status?.type === "busy") return "*" // Working
    return "" // Idle
  }

  // Navigate to a session
  function navigateTo(sessionId: string) {
    route.navigate({ type: "session", sessionID: sessionId })
  }

  // Get agent color from title (extract @agentname and look up color)
  function getAgentColor(session: Session) {
    const agentName = extractAgentName(session)
    return local.agent.color(agentName) ?? theme.accent
  }

  // Track hover state for each tab
  const [hoveredTab, setHoveredTab] = createSignal<string | null>(null)

  return (
    <Show when={shouldShow()}>
      <box
        height={1}
        flexDirection="row"
        flexShrink={0}
        gap={0}
        backgroundColor={theme.backgroundPanel}
        paddingLeft={1}
      >
        {/* Main session tab - always first */}
        <Show when={mainSession()}>
          {(main) => {
            const isActive = () => activeSessionId() === main().id
            const isHovered = () => hoveredTab() === main().id
            return (
              <box
                flexDirection="row"
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={isActive() ? theme.backgroundElement : isHovered() ? theme.border : undefined}
                onMouseDown={() => navigateTo(main().id)}
                onMouseOver={() => setHoveredTab(main().id)}
                onMouseOut={() => setHoveredTab(null)}
              >
                <text fg={isActive() ? theme.primary : theme.text}>
                  <Show
                    when={isActive()}
                    fallback={
                      <>
                        <span style={{ fg: theme.success }}>*</span> Main{getStatusIndicator(main().id)}
                      </>
                    }
                  >
                    <b>
                      <span style={{ fg: theme.success }}>*</span> Main{getStatusIndicator(main().id)}
                    </b>
                  </Show>
                </text>
              </box>
            )
          }}
        </Show>

        {/* Separator */}
        <Show when={activeSubagents().length > 0}>
          <text fg={theme.border}> | </text>
        </Show>

        {/* Subagent tabs */}
        <For each={activeSubagents()}>
          {(subagent) => {
            const isActive = () => activeSessionId() === subagent.id
            const isHovered = () => hoveredTab() === subagent.id
            const agentName = () => extractAgentName(subagent)
            const status = () => getStatusIndicator(subagent.id)
            const agentColor = () => getAgentColor(subagent)

            return (
              <box
                flexDirection="row"
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={isActive() ? theme.backgroundElement : isHovered() ? theme.border : undefined}
                onMouseDown={() => navigateTo(subagent.id)}
                onMouseOver={() => setHoveredTab(subagent.id)}
                onMouseOut={() => setHoveredTab(null)}
              >
                <text fg={isActive() ? agentColor() : theme.textMuted}>
                  <Show
                    when={isActive()}
                    fallback={
                      <>
                        @{agentName()}
                        {status()}
                      </>
                    }
                  >
                    <b>
                      @{agentName()}
                      {status()}
                    </b>
                  </Show>
                </text>
              </box>
            )
          }}
        </For>

        {/* Right-side indicator showing count if many subagents */}
        <Show when={activeSubagents().length > 3}>
          <box flexGrow={1} />
          <text fg={theme.textMuted} paddingRight={1}>
            {activeSubagents().length} agents
          </text>
        </Show>
      </box>
    </Show>
  )
}

/**
 * Hook to get subagent navigation functions for which-key integration
 */
export function useSubagentNavigation(sessionId: string) {
  const sync = useSync()
  const route = useRoute()

  // Get main session
  const mainSession = createMemo(() => {
    let session = sync.session.get(sessionId)
    if (!session) return null

    while (session?.parentID) {
      const parent = sync.session.get(session.parentID)
      if (!parent) break
      session = parent
    }
    return session
  })

  // Get ordered list of sessions (main + subagents)
  const allSessions = createMemo(() => {
    const main = mainSession()
    if (!main) return []

    const subagents = sync.data.session
      .filter((s) => s.parentID === main.id)
      .sort((a, b) => a.time.created - b.time.created)

    return [main, ...subagents]
  })

  // Get current index in the session list
  const currentIndex = createMemo(() => {
    const sessions = allSessions()
    const current = route.data.type === "session" ? route.data.sessionID : null
    return sessions.findIndex((s) => s.id === current)
  })

  // Navigate to next subagent
  function nextSubagent() {
    const sessions = allSessions()
    const idx = currentIndex()
    if (idx < 0 || sessions.length === 0) return

    const nextIdx = (idx + 1) % sessions.length
    route.navigate({ type: "session", sessionID: sessions[nextIdx].id })
  }

  // Navigate to previous subagent
  function prevSubagent() {
    const sessions = allSessions()
    const idx = currentIndex()
    if (idx < 0 || sessions.length === 0) return

    const prevIdx = (idx - 1 + sessions.length) % sessions.length
    route.navigate({ type: "session", sessionID: sessions[prevIdx].id })
  }

  // Navigate to main session
  function goToMain() {
    const main = mainSession()
    if (main) {
      route.navigate({ type: "session", sessionID: main.id })
    }
  }

  return {
    nextSubagent,
    prevSubagent,
    goToMain,
    get hasSubagents() {
      return allSessions().length > 1
    },
    get isOnMain() {
      const main = mainSession()
      const current = route.data.type === "session" ? route.data.sessionID : null
      return main?.id === current
    },
    get subagentCount() {
      return Math.max(0, allSessions().length - 1)
    },
  }
}
