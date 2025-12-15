import { Match, Switch, Show, createMemo, For } from "solid-js"
import {
  usePanes,
  getActiveTab,
  type PaneLeaf,
  type PaneViewType,
  type PaneTab,
  type FloatingPane,
} from "@tui/context/panes"
import { useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { useKeybind } from "@tui/context/keybind"
import { TextAttributes } from "@opentui/core"

// Import real view components
import { HomeView } from "./views/home-view"
import { ToMView } from "./views/tom-view"
import { MetricsView } from "./views/metrics-view"
import { OrchestrationAgentsView } from "./views/orchestration-agents-view"
import { AFSView } from "./views/afs-view"
import { OutcomesView } from "./views/outcomes-view"
import { ChatView } from "./views/chat-view"
import { MessagesView } from "./views/messages-view"
import { CognitiveView } from "./views/cognitive-view"
import { HivemindView } from "./views/hivemind-view"
import { StateView } from "./views/state-view"
import { TodoView } from "./views/todo-view"
import { PlanView } from "./views/plan-view"

/**
 * PaneView - Individual pane wrapper with view type switching
 *
 * Renders the appropriate view component based on the pane's active tab.
 * Also handles:
 * - Active pane border highlighting
 * - Click to focus
 * - Tab bar when multiple tabs
 * - View header with type indicator
 */

interface PaneViewProps {
  pane: PaneLeaf
  sessionID: string
  isActive: boolean
  isMaximized?: boolean
}

export function PaneView(props: PaneViewProps) {
  const panes = usePanes()
  const { theme } = useTheme()

  // Get the active tab for this pane
  const activeTab = createMemo(() => getActiveTab(props.pane))

  const chatSessionID = createMemo(() => {
    const tab = activeTab()
    const fromTab = tab.sessionID
    const fromLegacyMetadata = (tab.metadata as any)?.sessionID
    return (fromTab || fromLegacyMetadata || props.sessionID) as string
  })

  // Check if we have multiple tabs
  const hasTabs = createMemo(() => props.pane.tabs && props.pane.tabs.length > 1)

  const borderColor = createMemo(() => {
    if (props.isMaximized) return theme.warning
    return props.isActive ? theme.primary : theme.border
  })

  // Enhanced border style for active pane
  const borderChars = createMemo(() => {
    if (props.isActive) {
      // Double-line border for active pane
      return {
        topLeft: "╔",
        topRight: "╗",
        bottomLeft: "╚",
        bottomRight: "╝",
        horizontal: "═",
        vertical: "║",
        // Additional chars for completeness
        bottomT: "╩",
        topT: "╦",
        cross: "╬",
        leftT: "╠",
        rightT: "╣",
      }
    }
    return undefined // Use default single-line border
  })

  return (
    <box
      flexGrow={1}
      flexShrink={1}
      flexBasis={0}
      width="100%"
      height="100%"
      onMouseDown={() => panes.setActive(props.pane.id)}
      borderColor={borderColor()}
      border={["top", "bottom", "left", "right"]}
      customBorderChars={borderChars()}
      overflow="hidden"
      flexDirection="column"
    >
      {/* Tab bar when multiple tabs */}
      <Show when={hasTabs()}>
        <TabBar tabs={props.pane.tabs || []} activeIndex={props.pane.activeTabIndex} isActive={props.isActive} />
      </Show>

      {/* View header (single tab mode) */}
      <Show when={!hasTabs()}>
        <PaneHeader viewType={activeTab().viewType} isActive={props.isActive} isMaximized={props.isMaximized} />
      </Show>

      {/* View content based on active tab */}
      <box flexGrow={1} overflow="hidden">
        <Switch fallback={<PlaceholderView viewType={activeTab().viewType} />}>
          <Match when={activeTab().viewType === "home"}>
            <HomeView paneId={props.pane.id} isActive={props.isActive} />
          </Match>
          <Match when={activeTab().viewType === "chat"}>
            <ChatView sessionID={chatSessionID()} isActive={props.isActive} />
          </Match>
          <Match when={activeTab().viewType === "afs"}>
            <AFSView paneId={props.pane.id} isActive={props.isActive} />
          </Match>
          <Match when={activeTab().viewType === "tom"}>
            <ToMView isActive={props.isActive} />
          </Match>
          <Match when={activeTab().viewType === "metrics"}>
            <MetricsView isActive={props.isActive} />
          </Match>
          <Match when={activeTab().viewType === "agents"}>
            <OrchestrationAgentsView
              paneId={props.pane.id}
              isActive={props.isActive}
              currentSessionId={chatSessionID()}
            />
          </Match>
          <Match when={activeTab().viewType === "outcomes"}>
            <OutcomesView paneId={props.pane.id} isActive={props.isActive} />
          </Match>
          <Match when={activeTab().viewType === "messages"}>
            <MessagesView paneId={props.pane.id} isActive={props.isActive} />
          </Match>
          <Match when={activeTab().viewType === "cognitive"}>
            <CognitiveView paneId={props.pane.id} isActive={props.isActive} />
          </Match>
          <Match when={activeTab().viewType === "hivemind"}>
            <HivemindView paneId={props.pane.id} isActive={props.isActive} />
          </Match>
          <Match when={activeTab().viewType === "state"}>
            <StateView paneId={props.pane.id} isActive={props.isActive} />
          </Match>
          <Match when={activeTab().viewType === "todo"}>
            <TodoView paneId={props.pane.id} isActive={props.isActive} sessionID={chatSessionID()} />
          </Match>
          <Match when={activeTab().viewType === "plan"}>
            <PlanView paneId={props.pane.id} isActive={props.isActive} />
          </Match>
        </Switch>
      </box>
    </box>
  )
}

/**
 * Tab bar showing all tabs in the pane
 */
function TabBar(props: { tabs: PaneTab[]; activeIndex: number; isActive: boolean }) {
  const { theme } = useTheme()
  const panes = usePanes()
  const keybind = useKeybind()

  const getTabIcon = (viewType: PaneViewType): string => {
    const icons: Record<PaneViewType, string> = {
      home: "󰋜",
      chat: "󰭻",
      afs: "󰉋",
      tom: "󰘨",
      metrics: "󰄪",
      agents: "󰀏",
      outcomes: "󰄩",
      todo: "󰄬",
      messages: "󰍡",
      cognitive: "󰠭",
      hivemind: "󰛶",
      state: "󰈙",
      plan: "󰙅",
    }
    return icons[viewType] || "󰈔"
  }

  const getTabLabel = (tab: PaneTab): string => {
    if (tab.label) return tab.label
    const labels: Record<PaneViewType, string> = {
      home: "*home*",
      chat: "Chat",
      afs: "AFS",
      tom: "ToM",
      metrics: "Metrics",
      agents: "Agents",
      outcomes: "Outcomes",
      todo: "Todo",
      messages: "Messages",
      cognitive: "Cognitive",
      hivemind: "Hivemind",
      state: "State",
      plan: "Plan",
    }
    return labels[tab.viewType] || tab.viewType
  }

  return (
    <box
      height={1}
      backgroundColor={props.isActive ? theme.backgroundPanel : theme.background}
      flexDirection="row"
      alignItems="center"
      flexShrink={0}
      gap={0}
    >
      <For each={props.tabs}>
        {(tab, index) => {
          const isTabActive = () => index() === props.activeIndex
          return (
            <box
              paddingLeft={1}
              paddingRight={1}
              onMouseDown={(e) => {
                e.stopPropagation()
                panes.goToTab(index())
              }}
              backgroundColor={isTabActive() ? theme.backgroundPanel : theme.background}
            >
              <text
                fg={isTabActive() ? theme.primary : theme.textMuted}
                attributes={isTabActive() ? TextAttributes.BOLD : undefined}
              >
                {getTabIcon(tab.viewType)} {getTabLabel(tab)}
              </text>
            </box>
          )
        }}
      </For>
      <box flexGrow={1} />
      <Show when={props.isActive}>
        <box paddingRight={1}>
          <text fg={theme.textMuted}>{keybind.print("leader")} t</text>
        </box>
      </Show>
    </box>
  )
}

/**
 * Header bar showing the view type with focus indicator
 */
function PaneHeader(props: { viewType: PaneViewType; isActive: boolean; isMaximized?: boolean }) {
  const { theme } = useTheme()
  const keybind = useKeybind()

  const viewLabel = createMemo(() => {
    const labels: Record<PaneViewType, string> = {
      home: "*home*",
      chat: "Chat",
      afs: "AFS Browser",
      tom: "Theory of Mind",
      metrics: "Metrics",
      agents: "Agents",
      outcomes: "Outcomes",
      todo: "Todo",
      messages: "Messages",
      cognitive: "Cognitive",
      hivemind: "Hivemind",
      state: "State",
      plan: "Plan",
    }
    return labels[props.viewType] || props.viewType
  })

  const icon = createMemo(() => {
    const icons: Record<PaneViewType, string> = {
      home: "󰋜",
      chat: "󰭻",
      afs: "󰉋",
      tom: "󰘨",
      metrics: "󰄪",
      agents: "󰀏",
      outcomes: "󰄩",
      todo: "󰄬",
      messages: "󰍡",
      cognitive: "󰠭",
      hivemind: "󰛶",
      state: "󰈙",
      plan: "󰙅",
    }
    return icons[props.viewType] || "󰈔"
  })

  // Focus indicator character
  const focusIndicator = createMemo(() => {
    if (props.isMaximized) return "◈" // Diamond for maximized
    if (props.isActive) return "●" // Filled circle for active
    return "○" // Empty circle for inactive
  })

  return (
    <box
      height={1}
      backgroundColor={props.isActive ? theme.backgroundPanel : theme.background}
      paddingLeft={1}
      paddingRight={1}
      flexDirection="row"
      alignItems="center"
      justifyContent="space-between"
      flexShrink={0}
    >
      <box flexDirection="row" gap={1}>
        <text fg={props.isActive ? theme.primary : theme.textMuted}>{focusIndicator()}</text>
        <text fg={props.isActive ? theme.primary : theme.textMuted} attributes={TextAttributes.BOLD}>
          {icon()} {viewLabel()}
        </text>
      </box>
      <box flexDirection="row" gap={1}>
        <Show when={props.isMaximized}>
          <text fg={theme.warning}>[MAX]</text>
        </Show>
        <Show when={props.isActive && !props.isMaximized}>
          <text fg={theme.textMuted}>{keybind.print("leader")} w</text>
        </Show>
      </box>
    </box>
  )
}

/**
 * Generic placeholder for views not yet implemented
 */
function PlaceholderView(props: { viewType: PaneViewType }) {
  const { theme } = useTheme()

  return (
    <box flexGrow={1} justifyContent="center" alignItems="center">
      <text fg={theme.textMuted}>{props.viewType} view - Coming soon</text>
    </box>
  )
}

/**
 * FloatingPaneOverlay - Renders floating panes as overlays
 *
 * This component should be rendered as a sibling to the main pane tree,
 * positioned absolutely to overlay on top of the tree panes.
 */
export function FloatingPaneOverlay(props: { sessionID: string }) {
  const panes = usePanes()
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()

  // Sort floating panes by z-index for proper stacking
  const sortedFloating = createMemo(() => {
    return [...panes.floating].sort((a, b) => a.zIndex - b.zIndex)
  })

  return (
    <For each={sortedFloating()}>
      {(floating) => {
        const isActive = () => panes.activeId === floating.pane.id
        const activeTab = createMemo(() => getActiveTab(floating.pane))
        const chatSessionID = createMemo(() => {
          const tab = activeTab()
          const fromTab = tab.sessionID
          const fromLegacyMetadata = (tab.metadata as any)?.sessionID
          return (fromTab || fromLegacyMetadata || props.sessionID) as string
        })

        // Calculate absolute position based on percentage
        const left = () => Math.floor(dimensions().width * floating.x)
        const top = () => Math.floor(dimensions().height * floating.y)
        const width = () => Math.floor(dimensions().width * floating.width)
        const height = () => Math.floor(dimensions().height * floating.height)

        const borderColor = () => (isActive() ? theme.warning : theme.border)

        return (
          <box
            position="absolute"
            left={left()}
            top={top()}
            width={width()}
            height={height()}
            onMouseDown={() => panes.bringToFront(floating.pane.id)}
            borderColor={borderColor()}
            border={["top", "bottom", "left", "right"]}
            customBorderChars={
              isActive()
                ? {
                    topLeft: "╔",
                    topRight: "╗",
                    bottomLeft: "╚",
                    bottomRight: "╝",
                    horizontal: "═",
                    vertical: "║",
                    bottomT: "╩",
                    topT: "╦",
                    cross: "╬",
                    leftT: "╠",
                    rightT: "╣",
                  }
                : undefined
            }
            backgroundColor={theme.background}
            overflow="hidden"
            flexDirection="column"
          >
            {/* Floating pane header with float indicator */}
            <FloatingPaneHeader pane={floating.pane} isActive={isActive()} />

            {/* View content */}
            <box flexGrow={1} overflow="hidden">
              <Switch fallback={<PlaceholderView viewType={getActiveTab(floating.pane).viewType} />}>
                <Match when={getActiveTab(floating.pane).viewType === "home"}>
                  <HomeView paneId={floating.pane.id} isActive={isActive()} />
                </Match>
                <Match when={getActiveTab(floating.pane).viewType === "chat"}>
                  <ChatView sessionID={chatSessionID()} isActive={isActive()} />
                </Match>
                <Match when={getActiveTab(floating.pane).viewType === "afs"}>
                  <AFSView paneId={floating.pane.id} isActive={isActive()} />
                </Match>
                <Match when={getActiveTab(floating.pane).viewType === "tom"}>
                  <ToMView isActive={isActive()} />
                </Match>
                <Match when={getActiveTab(floating.pane).viewType === "metrics"}>
                  <MetricsView isActive={isActive()} />
                </Match>
                <Match when={getActiveTab(floating.pane).viewType === "agents"}>
                  <OrchestrationAgentsView
                    paneId={floating.pane.id}
                    isActive={isActive()}
                    currentSessionId={chatSessionID()}
                  />
                </Match>
                <Match when={getActiveTab(floating.pane).viewType === "outcomes"}>
                  <OutcomesView paneId={floating.pane.id} isActive={isActive()} />
                </Match>
                <Match when={getActiveTab(floating.pane).viewType === "messages"}>
                  <MessagesView paneId={floating.pane.id} isActive={isActive()} />
                </Match>
                <Match when={getActiveTab(floating.pane).viewType === "cognitive"}>
                  <CognitiveView paneId={floating.pane.id} isActive={isActive()} />
                </Match>
                <Match when={getActiveTab(floating.pane).viewType === "hivemind"}>
                  <HivemindView paneId={floating.pane.id} isActive={isActive()} />
                </Match>
                <Match when={getActiveTab(floating.pane).viewType === "state"}>
                  <StateView paneId={floating.pane.id} isActive={isActive()} />
                </Match>
                <Match when={getActiveTab(floating.pane).viewType === "todo"}>
                  <TodoView paneId={floating.pane.id} isActive={isActive()} sessionID={chatSessionID()} />
                </Match>
                <Match when={getActiveTab(floating.pane).viewType === "plan"}>
                  <PlanView paneId={floating.pane.id} isActive={isActive()} />
                </Match>
              </Switch>
            </box>
          </box>
        )
      }}
    </For>
  )
}

/**
 * Header for floating panes - shows float indicator
 */
function FloatingPaneHeader(props: { pane: PaneLeaf; isActive: boolean }) {
  const { theme } = useTheme()
  const keybind = useKeybind()
  const activeTab = createMemo(() => getActiveTab(props.pane))

  const icon = createMemo(() => {
    const icons: Record<PaneViewType, string> = {
      home: "󰋜",
      chat: "󰭻",
      afs: "󰉋",
      tom: "󰘨",
      metrics: "󰄪",
      agents: "󰀏",
      outcomes: "󰄩",
      todo: "󰄬",
      messages: "󰍡",
      cognitive: "󰠭",
      hivemind: "󰛶",
      state: "󰈙",
      plan: "󰙅",
    }
    return icons[activeTab().viewType] || "󰈔"
  })

  const label = createMemo(() => {
    const labels: Record<PaneViewType, string> = {
      home: "*home*",
      chat: "Chat",
      afs: "AFS",
      tom: "ToM",
      metrics: "Metrics",
      agents: "Agents",
      outcomes: "Outcomes",
      todo: "Todo",
      messages: "Messages",
      cognitive: "Cognitive",
      hivemind: "Hivemind",
      state: "State",
      plan: "Plan",
    }
    return labels[activeTab().viewType] || activeTab().viewType
  })

  return (
    <box
      height={1}
      backgroundColor={props.isActive ? theme.backgroundPanel : theme.background}
      paddingLeft={1}
      paddingRight={1}
      flexDirection="row"
      alignItems="center"
      justifyContent="space-between"
      flexShrink={0}
    >
      <box flexDirection="row" gap={1}>
        <text fg={theme.warning}>󰀁</text>
        <text fg={props.isActive ? theme.primary : theme.textMuted} attributes={TextAttributes.BOLD}>
          {icon()} {label()}
        </text>
      </box>
      <box flexDirection="row" gap={1}>
        <text fg={theme.warning}>[FLOAT]</text>
        <Show when={props.isActive}>
          <text fg={theme.textMuted}>{keybind.print("leader")} w f</text>
        </Show>
      </box>
    </box>
  )
}
