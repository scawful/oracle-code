import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "../../context/theme"
import { useAgents } from "../../context/agents"
import { useOrchestration, STRATEGY_INFO, type OrchestrationStrategy } from "../../context/orchestration"
import { useSync } from "../../context/sync"
import { useMetrics } from "../../context/metrics"
import { useLocal } from "../../context/local"
import { useDialog } from "../../ui/dialog"
import { useKeyboardMode } from "../../context/keyboard-mode"
import { useRenderer } from "@opentui/solid"
import { usePanes } from "../../context/panes"
import { usePromptRef } from "../../context/prompt"

/**
 * OrchestrationAgentsView - Unified orchestration and agent lanes dashboard
 *
 * Combines orchestration settings with agent lanes in a cohesive interface.
 * Features:
 * - Orchestration strategy and settings
 * - Agent lanes filtered to current session's subagents
 * - Multi-select for viewing multiple lanes side-by-side
 * - Real-time status updates
 */

export interface OrchestrationAgentsViewProps {
  paneId: string
  isActive?: boolean
  /** Current session ID to filter subagents */
  currentSessionId?: string
}

type TabName = "overview" | "lanes" | "config" | "metrics"

interface AgentLane {
  id: string
  sessionId: string
  name: string
  status: "busy" | "idle" | "waiting"
  title: string
  messageCount: number
  elapsed: number
  isCurrentSession: boolean
}

export function OrchestrationAgentsView(props: OrchestrationAgentsViewProps) {
  const { theme } = useTheme()
  const agents = useAgents()
  const orchestration = useOrchestration()
  const sync = useSync()
  const metrics = useMetrics()
  const local = useLocal()
  const dialog = useDialog()
  const keyboard = useKeyboardMode()
  const renderer = useRenderer()
  const panes = usePanes()
  const promptRef = usePromptRef()

  const ownerId = `orchestration-agents:${props.paneId}`
  const isPaneActive = createMemo(() => panes.activeId === props.paneId)
  const isActive = createMemo(() => props.isActive ?? isPaneActive())
  // Don't capture keyboard if prompt is focused (let user type in chat)
  const promptFocused = createMemo(() => promptRef.current?.focused ?? false)

  // Tab state
  const tabs: TabName[] = ["overview", "lanes", "config", "metrics"]
  const [activeTab, setActiveTab] = createSignal<TabName>("overview")
  const [selectedLaneIndex, setSelectedLaneIndex] = createSignal(0)
  const [selectedLanes, setSelectedLanes] = createSignal<Set<string>>(new Set<string>())

  function focusPane() {
    panes.setActive(props.paneId)
    setTimeout(() => renderer.currentFocusedRenderable?.blur(), 0)
  }

  // Keyboard ownership - only when pane is active AND prompt is not focused
  // This allows typing in chat while pane is visible (like Emacs buffer behavior)
  let ownsKeyboard = false
  createEffect(() => {
    const shouldOwn = isActive() && dialog.stack.length === 0 && !promptFocused()

    if (shouldOwn && !ownsKeyboard) {
      ownsKeyboard = true
      renderer.currentFocusedRenderable?.blur()
      keyboard.acquire(ownerId, {
        mode: "vim-navigation",
        priority: 50,
        onKey: (evt) => handleKeyboard(evt),
      })
    }

    if (!shouldOwn && ownsKeyboard) {
      ownsKeyboard = false
      keyboard.release(ownerId)
    }
  })
  onCleanup(() => {
    if (ownsKeyboard) keyboard.release(ownerId)
  })

  function handleKeyboard(evt: { name: string; ctrl?: boolean; shift?: boolean }): boolean {
    switch (evt.name) {
      case "h":
      case "left":
        cycleTab(-1)
        return true

      case "l":
      case "right":
        cycleTab(1)
        return true

      case "tab":
        cycleTab(evt.shift ? -1 : 1)
        return true

      case "j":
      case "down":
        if (activeTab() === "lanes") {
          setSelectedLaneIndex((i) => Math.min(i + 1, lanes().length - 1))
        }
        return true

      case "k":
      case "up":
        if (activeTab() === "lanes") {
          setSelectedLaneIndex((i) => Math.max(i - 1, 0))
        }
        return true

      case "return":
      case "o":
        if (activeTab() === "lanes") {
          openLaneInPane()
        }
        return true

      case "space":
        if (activeTab() === "lanes") {
          toggleLaneSelection()
        }
        return true

      case "a":
        if (activeTab() === "lanes") {
          selectAllLanes()
        }
        return true

      case "v":
        if (activeTab() === "lanes" && selectedLanes().size > 0) {
          viewSelectedLanes()
        }
        return true

      case "s":
        if (activeTab() === "config") {
          orchestration.cycleStrategy(1)
        }
        return true

      case "c":
        if (activeTab() === "config") {
          orchestration.toggleCritic()
        }
        return true

      case "+":
      case "=":
        if (activeTab() === "config") {
          orchestration.incrementMaxParallel()
        }
        return true

      case "-":
        if (activeTab() === "config") {
          orchestration.decrementMaxParallel()
        }
        return true

      case "1":
      case "2":
      case "3":
      case "4":
        const idx = parseInt(evt.name) - 1
        if (idx < tabs.length) {
          setActiveTab(tabs[idx])
        }
        return true

      case "r":
        agents.refresh()
        return true
    }

    return false
  }

  function cycleTab(direction: 1 | -1) {
    const currentIndex = tabs.indexOf(activeTab())
    let nextIndex = currentIndex + direction
    if (nextIndex < 0) nextIndex = tabs.length - 1
    if (nextIndex >= tabs.length) nextIndex = 0
    setActiveTab(tabs[nextIndex])
  }

  function toggleLaneSelection() {
    const lane = lanes()[selectedLaneIndex()]
    if (!lane) return
    setSelectedLanes((prev) => {
      const next = new Set(prev)
      if (next.has(lane.sessionId)) {
        next.delete(lane.sessionId)
      } else {
        next.add(lane.sessionId)
      }
      return next
    })
  }

  function selectAllLanes() {
    const allIds = lanes().map((l) => l.sessionId)
    setSelectedLanes(new Set<string>(allIds))
  }

  function openLaneInPane() {
    const lane = lanes()[selectedLaneIndex()]
    if (!lane) return
    panes.split("vertical", "chat")
    const newPaneId = panes.activeId
    if (newPaneId && newPaneId !== "main") {
      panes.setView(newPaneId, "chat", { sessionID: lane.sessionId })
    }
  }

  function viewSelectedLanes() {
    const selected = Array.from(selectedLanes())
    if (selected.length === 0) return

    // Create splits for each selected lane
    for (const sessionId of selected) {
      panes.split("vertical", "chat")
      const newPaneId = panes.activeId
      if (newPaneId && newPaneId !== "main") {
        panes.setView(newPaneId, "chat", { sessionID: sessionId })
      }
    }

    setSelectedLanes(new Set<string>())
  }

  // Build lane data from session data
  const lanes = createMemo((): AgentLane[] => {
    const sessions = sync.data.session || []
    const statuses = sync.data.session_status || {}
    const messages = sync.data.message || {}

    // Get subagent sessions
    const subagentSessions = sessions.filter((s) => s.parentID)

    return subagentSessions
      .map((session) => {
        const status = statuses[session.id]
        const sessionMessages = messages[session.id] || []
        const match = session.title?.match(/@(\w+)/)
        const agentName = match?.[1] || "agent"

        const taskTitle = (session.title || "").replace(/@\w+:?\s*/, "").trim() || "working..."
        const timestamp = session.time?.updated || session.time?.created || Date.now()
        const elapsed = Math.max(0, Date.now() - timestamp)

        // Check if this is a subagent of the current session
        const isCurrentSession = props.currentSessionId ? session.parentID === props.currentSessionId : true

        return {
          id: session.id,
          sessionId: session.id,
          name: agentName,
          status: (status?.type === "busy" ? "busy" : "idle") as "busy" | "idle",
          title: taskTitle,
          messageCount: sessionMessages.length,
          elapsed,
          isCurrentSession,
        }
      })
      .sort((a, b) => {
        // Current session's subagents first
        if (a.isCurrentSession && !b.isCurrentSession) return -1
        if (!a.isCurrentSession && b.isCurrentSession) return 1
        // Then busy first
        if (a.status === "busy" && b.status !== "busy") return -1
        if (a.status !== "busy" && b.status === "busy") return 1
        // Then by elapsed time
        return a.elapsed - b.elapsed
      })
  })

  // Filter to current session's subagents when filtering is enabled
  const [filterToCurrentSession, setFilterToCurrentSession] = createSignal(true)
  const filteredLanes = createMemo(() => {
    if (!filterToCurrentSession() || !props.currentSessionId) {
      return lanes()
    }
    return lanes().filter((l) => l.isCurrentSession)
  })

  // Stats
  const stats = createMemo(() => {
    const all = lanes()
    const current = filteredLanes()
    return {
      total: all.length,
      currentSession: current.length,
      busy: current.filter((l) => l.status === "busy").length,
      idle: current.filter((l) => l.status === "idle").length,
    }
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

  return (
    <box flexGrow={1} flexDirection="column" overflow="hidden" onMouseDown={focusPane}>
      {/* Tab Bar */}
      <box flexDirection="row" gap={1} paddingLeft={1} paddingRight={1} flexShrink={0}>
        <For each={tabs}>
          {(tab, index) => (
            <box
              onMouseDown={() => {
                focusPane()
                setActiveTab(tab)
              }}
            >
              <text
                fg={activeTab() === tab ? theme.info : theme.textMuted}
                attributes={activeTab() === tab ? TextAttributes.BOLD : undefined}
              >
                [{index() + 1}:{tab}]
              </text>
            </box>
          )}
        </For>
        <text fg={theme.textMuted}>|</text>
        <text fg={theme.info}>{orchestration.strategyInfo.shortName}</text>
        <Show when={stats().busy > 0}>
          <text fg={theme.success}>({stats().busy} active)</text>
        </Show>
        <Show when={orchestration.enableCritic}>
          <text fg={theme.error}>[CRIT]</text>
        </Show>
      </box>

      <scrollbox flexGrow={1} paddingLeft={1} paddingRight={1}>
        {/* Overview Tab */}
        <Show when={activeTab() === "overview"}>
          <OverviewTab
            theme={theme}
            orchestration={orchestration}
            stats={stats()}
            metrics={metrics}
            agents={agents}
            local={local}
          />
        </Show>

        {/* Lanes Tab */}
        <Show when={activeTab() === "lanes"}>
          <LanesTab
            theme={theme}
            lanes={filteredLanes()}
            selectedIndex={selectedLaneIndex()}
            selectedLanes={selectedLanes()}
            onSelectIndex={setSelectedLaneIndex}
            local={local}
            formatElapsed={formatElapsed}
            getStatusIcon={getStatusIcon}
            filterToCurrentSession={filterToCurrentSession()}
            onToggleFilter={() => setFilterToCurrentSession((v) => !v)}
            totalLanes={lanes().length}
          />
        </Show>

        {/* Config Tab */}
        <Show when={activeTab() === "config"}>
          <ConfigTab theme={theme} orchestration={orchestration} />
        </Show>

        {/* Metrics Tab */}
        <Show when={activeTab() === "metrics"}>
          <MetricsTab theme={theme} metrics={metrics} />
        </Show>
      </scrollbox>

      {/* Status bar */}
      <box
        height={1}
        backgroundColor={theme.backgroundElement}
        paddingLeft={1}
        paddingRight={1}
        flexDirection="row"
        justifyContent="space-between"
        flexShrink={0}
      >
        <box flexDirection="row" gap={2}>
          <text fg={theme.textMuted}>
            {stats().currentSession}/{stats().total} lanes
          </text>
          <Show when={selectedLanes().size > 0}>
            <text fg={theme.info}>{selectedLanes().size} selected</text>
          </Show>
        </box>
        <text fg={theme.textMuted}>
          {activeTab() === "lanes"
            ? "j/k:nav space:select a:all v:view o:open"
            : activeTab() === "config"
              ? "s:strategy c:critic +/-:parallel"
              : "h/l:tabs 1-4:jump r:refresh"}
        </text>
      </box>
    </box>
  )
}

/**
 * Overview tab - quick status summary
 */
function OverviewTab(props: {
  theme: any
  orchestration: ReturnType<typeof useOrchestration>
  stats: { total: number; currentSession: number; busy: number; idle: number }
  metrics: ReturnType<typeof useMetrics>
  agents: ReturnType<typeof useAgents>
  local: ReturnType<typeof useLocal>
}) {
  return (
    <box>
      {/* Strategy Summary */}
      <box marginBottom={1}>
        <text fg={props.theme.text} attributes={TextAttributes.BOLD}>
          Current Strategy
        </text>
        <box paddingLeft={1} flexDirection="row" gap={2}>
          <text fg={props.theme.info}>{props.orchestration.strategyInfo.name}</text>
          <text fg={props.theme.textMuted}>({props.orchestration.strategyInfo.errorAmp} error amp)</text>
        </box>
        <box paddingLeft={1}>
          <text fg={props.theme.textMuted}>{props.orchestration.strategyInfo.pros}</text>
        </box>
      </box>

      {/* Agent Status */}
      <box marginBottom={1}>
        <text fg={props.theme.text} attributes={TextAttributes.BOLD}>
          Agent Lanes
        </text>
        <box paddingLeft={1} flexDirection="row" gap={3}>
          <text fg={props.theme.success}>● {props.stats.busy} busy</text>
          <text fg={props.theme.textMuted}>○ {props.stats.idle} idle</text>
          <text fg={props.theme.textMuted}>/ {props.orchestration.maxParallel} max</text>
        </box>
        <Show when={props.stats.total > props.stats.currentSession}>
          <box paddingLeft={1}>
            <text fg={props.theme.warning}>
              {props.stats.total - props.stats.currentSession} lanes from other sessions
            </text>
          </box>
        </Show>
      </box>

      {/* Active Agents List */}
      <Show when={props.agents.activeAgents.length > 0}>
        <box marginBottom={1}>
          <text fg={props.theme.text} attributes={TextAttributes.BOLD}>
            Active Agents
          </text>
          <box paddingLeft={1} flexDirection="row" flexWrap="wrap" gap={1}>
            <For each={props.agents.activeAgents}>
              {(name) => (
                <box paddingLeft={1} paddingRight={1}>
                  <text fg={props.local.agent.color(name)}>@{name}</text>
                </box>
              )}
            </For>
          </box>
        </box>
      </Show>

      {/* Quick Metrics */}
      <Show when={props.metrics.metrics.totalTurns > 0}>
        <box marginBottom={1}>
          <text fg={props.theme.text} attributes={TextAttributes.BOLD}>
            Coordination Metrics
          </text>
          <box paddingLeft={1} flexDirection="row" gap={2}>
            <text fg={props.theme.textMuted}>
              Ec: {props.metrics.formatEfficiency(props.metrics.metrics.coordinationEfficiency)}
            </text>
            <Show when={props.metrics.metrics.errorAmplification > 1}>
              <text fg={props.metrics.metrics.errorAmplification > 5 ? props.theme.error : props.theme.warning}>
                Ae: {props.metrics.metrics.errorAmplification.toFixed(1)}x
              </text>
            </Show>
            <text fg={props.theme.textMuted}>Turns: {props.metrics.metrics.totalTurns}</text>
          </box>
        </box>
      </Show>

      {/* Critic Status */}
      <box>
        <box flexDirection="row" gap={2}>
          <text fg={props.theme.textMuted}>Critic:</text>
          <text fg={props.orchestration.enableCritic ? props.theme.error : props.theme.textMuted}>
            {props.orchestration.enableCritic ? "ENABLED (harsh)" : "disabled"}
          </text>
        </box>
        <box flexDirection="row" gap={2}>
          <text fg={props.theme.textMuted}>Mode:</text>
          <text fg={props.theme.text}>
            {props.orchestration.parallelMode === "concurrent" ? "Concurrent" : "Sequential"}
          </text>
        </box>
      </box>
    </box>
  )
}

/**
 * Lanes tab - agent lane list with multi-select
 */
function LanesTab(props: {
  theme: any
  lanes: AgentLane[]
  selectedIndex: number
  selectedLanes: Set<string>
  onSelectIndex: (i: number) => void
  local: ReturnType<typeof useLocal>
  formatElapsed: (ms: number) => string
  getStatusIcon: (status: string) => string
  filterToCurrentSession: boolean
  onToggleFilter: () => void
  totalLanes: number
}) {
  return (
    <box>
      {/* Filter Toggle */}
      <box flexDirection="row" gap={2} marginBottom={1}>
        <text fg={props.theme.textMuted}>Filter:</text>
        <box onMouseDown={props.onToggleFilter}>
          <text fg={props.filterToCurrentSession ? props.theme.info : props.theme.textMuted}>
            [{props.filterToCurrentSession ? "current session" : "all sessions"}]
          </text>
        </box>
        <text fg={props.theme.textMuted}>
          Showing {props.lanes.length}/{props.totalLanes}
        </text>
      </box>

      <Show when={props.lanes.length === 0}>
        <box padding={2}>
          <text fg={props.theme.textMuted}>No agent lanes active.</text>
          <text fg={props.theme.textMuted}>
            Subagents will appear here when spawned during multi-agent coordination.
          </text>
        </box>
      </Show>

      <Show when={props.lanes.length > 0}>
        <For each={props.lanes}>
          {(lane, index) => {
            const isSelected = () => index() === props.selectedIndex
            const isMultiSelected = () => props.selectedLanes.has(lane.sessionId)

            return (
              <box
                marginBottom={1}
                backgroundColor={isSelected() ? props.theme.backgroundElement : undefined}
                paddingLeft={1}
                paddingRight={1}
                onMouseDown={() => props.onSelectIndex(index())}
              >
                {/* Lane header */}
                <box flexDirection="row" gap={1}>
                  <text fg={isMultiSelected() ? props.theme.success : props.theme.textMuted}>
                    {isMultiSelected() ? "✓" : "○"}
                  </text>
                  <text fg={props.theme.textMuted}>┌─</text>
                  <text fg={props.local.agent.color(lane.name)}>@{lane.name}</text>
                  <text fg={props.theme.textMuted}>{"─".repeat(Math.max(1, 25 - lane.name.length))}</text>
                  <text fg={lane.status === "busy" ? props.theme.success : props.theme.textMuted}>
                    {props.getStatusIcon(lane.status)} {lane.status}
                  </text>
                </box>

                {/* Lane content */}
                <box flexDirection="row" gap={1}>
                  <text fg={props.theme.textMuted}>│</text>
                  <text fg={props.theme.text}>
                    {lane.title.length > 50 ? lane.title.slice(0, 47) + "..." : lane.title}
                  </text>
                </box>

                {/* Lane stats */}
                <box flexDirection="row" gap={1}>
                  <text fg={props.theme.textMuted}>│</text>
                  <text fg={props.theme.textMuted}>
                    {"  "}
                    {lane.messageCount} msgs · {props.formatElapsed(lane.elapsed)}
                  </text>
                  <Show when={!lane.isCurrentSession}>
                    <text fg={props.theme.warning}>(other session)</text>
                  </Show>
                </box>

                {/* Lane footer */}
                <text fg={props.theme.textMuted}>└{"─".repeat(40)}</text>
              </box>
            )
          }}
        </For>
      </Show>
    </box>
  )
}

/**
 * Config tab - orchestration settings
 */
function ConfigTab(props: { theme: any; orchestration: ReturnType<typeof useOrchestration> }) {
  const strategies: OrchestrationStrategy[] = ["centralized", "decentralized", "independent", "hierarchical", "debate"]

  return (
    <box>
      {/* Strategy Selection */}
      <box marginBottom={2}>
        <text fg={props.theme.text} attributes={TextAttributes.BOLD}>
          Strategy
        </text>
        <box paddingLeft={1}>
          <For each={strategies}>
            {(strategy) => {
              const info = STRATEGY_INFO[strategy]
              const isCurrent = () => props.orchestration.strategy === strategy

              return (
                <box
                  flexDirection="row"
                  gap={1}
                  paddingLeft={1}
                  backgroundColor={isCurrent() ? props.theme.backgroundElement : undefined}
                  onMouseDown={() => props.orchestration.setStrategy(strategy)}
                >
                  <text fg={isCurrent() ? props.theme.info : props.theme.textMuted}>{isCurrent() ? "●" : "○"}</text>
                  <text
                    fg={isCurrent() ? props.theme.text : props.theme.textMuted}
                    attributes={isCurrent() ? TextAttributes.BOLD : undefined}
                  >
                    {info.name}
                  </text>
                  <text fg={props.theme.textMuted}>({info.errorAmp})</text>
                </box>
              )
            }}
          </For>
        </box>
      </box>

      {/* Max Parallel */}
      <box marginBottom={2}>
        <text fg={props.theme.text} attributes={TextAttributes.BOLD}>
          Max Parallel Agents
        </text>
        <box paddingLeft={1} flexDirection="row" gap={2}>
          <box onMouseDown={() => props.orchestration.decrementMaxParallel()}>
            <text fg={props.theme.info}>[-]</text>
          </box>
          <text fg={props.orchestration.isOptimalAgentCount ? props.theme.success : props.theme.warning}>
            {props.orchestration.maxParallel}
          </text>
          <box onMouseDown={() => props.orchestration.incrementMaxParallel()}>
            <text fg={props.theme.info}>[+]</text>
          </box>
        </box>
        <Show when={props.orchestration.agentCountWarning}>
          <box paddingLeft={1}>
            <text fg={props.theme.warning}>{props.orchestration.agentCountWarning}</text>
          </box>
        </Show>
      </box>

      {/* Toggles */}
      <box marginBottom={2}>
        <text fg={props.theme.text} attributes={TextAttributes.BOLD}>
          Options
        </text>
        <box paddingLeft={1}>
          <box flexDirection="row" gap={2} onMouseDown={() => props.orchestration.toggleCritic()}>
            <text fg={props.orchestration.enableCritic ? props.theme.error : props.theme.textMuted}>
              [{props.orchestration.enableCritic ? "●" : "○"}] Harsh Critic
            </text>
          </box>
          <box flexDirection="row" gap={2} onMouseDown={() => props.orchestration.toggleAutoRoute()}>
            <text fg={props.orchestration.autoRoute ? props.theme.success : props.theme.textMuted}>
              [{props.orchestration.autoRoute ? "●" : "○"}] Auto-Route
            </text>
          </box>
          <box flexDirection="row" gap={2} onMouseDown={() => props.orchestration.toggleParallelMode()}>
            <text fg={props.theme.textMuted}>
              Mode: [{props.orchestration.parallelMode === "concurrent" ? "Concurrent" : "Sequential"}]
            </text>
          </box>
        </box>
      </box>
    </box>
  )
}

/**
 * Metrics tab - coordination metrics
 */
function MetricsTab(props: { theme: any; metrics: ReturnType<typeof useMetrics> }) {
  const efficiencyColor = createMemo(() => {
    const status = props.metrics.efficiencyStatus
    return status === "success" ? props.theme.success : status === "warning" ? props.theme.warning : props.theme.error
  })

  const errorAmpColor = createMemo(() => {
    const status = props.metrics.errorAmplificationStatus
    return status === "success" ? props.theme.success : status === "warning" ? props.theme.warning : props.theme.error
  })

  return (
    <box>
      <Show when={props.metrics.metrics.totalTurns === 0}>
        <text fg={props.theme.textMuted}>No coordination metrics yet.</text>
        <text fg={props.theme.textMuted}>Metrics will appear after multi-agent activity.</text>
      </Show>

      <Show when={props.metrics.metrics.totalTurns > 0}>
        {/* Efficiency */}
        <box marginBottom={1}>
          <text fg={props.theme.text} attributes={TextAttributes.BOLD}>
            Coordination Efficiency (Ec)
          </text>
          <box paddingLeft={1} flexDirection="row" gap={2}>
            <text fg={efficiencyColor()}>
              {props.metrics.formatEfficiency(props.metrics.metrics.coordinationEfficiency)}
            </text>
            <text fg={props.theme.textMuted}>(optimal: 1.0, good: &gt;0.7)</text>
          </box>
        </box>

        {/* Error Amplification */}
        <box marginBottom={1}>
          <text fg={props.theme.text} attributes={TextAttributes.BOLD}>
            Error Amplification (Ae)
          </text>
          <box paddingLeft={1} flexDirection="row" gap={2}>
            <text fg={errorAmpColor()}>{props.metrics.metrics.errorAmplification.toFixed(2)}x</text>
            <text fg={props.theme.textMuted}>(lower is better, &gt;5x is problematic)</text>
          </box>
        </box>

        {/* Totals */}
        <box marginBottom={1}>
          <text fg={props.theme.text} attributes={TextAttributes.BOLD}>
            Totals
          </text>
          <box paddingLeft={1}>
            <text fg={props.theme.textMuted}>Turns: {props.metrics.metrics.totalTurns}</text>
            <text fg={props.theme.textMuted}>
              Tokens: {props.metrics.formatTokens(props.metrics.metrics.totalTokens)}
            </text>
            <text fg={props.theme.textMuted}>Active: {props.metrics.metrics.activeAgentCount}</text>
          </box>
        </box>

        {/* Session Breakdown */}
        <Show when={Object.keys(props.metrics.sessionMetrics).length > 0}>
          <box>
            <text fg={props.theme.text} attributes={TextAttributes.BOLD}>
              Session Breakdown
            </text>
            <box paddingLeft={1}>
              <For each={Object.entries(props.metrics.sessionMetrics).slice(0, 5)}>
                {([sessionId, sessionMetrics]) => (
                  <box flexDirection="row" gap={2}>
                    <text fg={props.theme.info}>@{sessionMetrics.agentName}</text>
                    <text fg={props.theme.textMuted}>
                      {sessionMetrics.messageCount} msgs · {props.metrics.formatTokens(sessionMetrics.tokens.total)}{" "}
                      tokens
                    </text>
                  </box>
                )}
              </For>
            </box>
          </box>
        </Show>
      </Show>
    </box>
  )
}
