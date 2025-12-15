import { createSignal, Show, For } from "solid-js"
import { useTheme } from "../context/theme"
import { useKV } from "../context/kv"

/**
 * Sidebar View Types (Consolidated for v0.3)
 *
 * Previous views: summary, cognitive, agents, afs, state, hivemind, metrics, tom
 * Consolidated to: summary, cognitive, knowledge, agents, afs, state
 *
 * - "knowledge" combines hivemind + ToM + epistemic facts
 * - "agents" combines agent lanes + orchestration + metrics
 * - "cognitive" focuses on health, mood, warnings, analysis mode
 */
export type SidebarViewType =
  | "summary" // Default: session summary (tokens, todos, files)
  | "cognitive" // Health, mood, warnings, analysis mode
  | "knowledge" // Hivemind + ToM facts + epistemic state
  | "agents" // Agent lanes + orchestration strategy + metrics
  | "afs" // AFS browser
  | "state" // Shared state

const VIEW_LABELS: Record<SidebarViewType, string> = {
  summary: "Summary",
  cognitive: "Cognitive",
  knowledge: "Knowledge",
  agents: "Agents",
  afs: "AFS",
  state: "State",
}

// Legacy view type aliases for backwards compatibility
export type LegacySidebarViewType = "hivemind" | "metrics" | "tom"
export function migrateLegacyView(view: string): SidebarViewType {
  switch (view) {
    case "hivemind":
    case "tom":
      return "knowledge"
    case "metrics":
      return "agents"
    default:
      return view as SidebarViewType
  }
}

interface SidebarHeaderProps {
  currentView: SidebarViewType
  onViewChange: (view: SidebarViewType) => void
}

/**
 * SidebarHeader - Clickable header with dropdown to switch views
 */
export function SidebarHeader(props: SidebarHeaderProps) {
  const { theme } = useTheme()
  const [dropdownOpen, setDropdownOpen] = createSignal(false)

  const views: SidebarViewType[] = ["summary", "cognitive", "knowledge", "agents", "afs", "state"]

  return (
    <box position="relative" flexShrink={0}>
      {/* Header bar with current view and dropdown trigger */}
      <box
        flexDirection="row"
        justifyContent="space-between"
        paddingBottom={1}
        onMouseDown={() => setDropdownOpen(!dropdownOpen())}
      >
        <text fg={theme.text}>
          <b>{VIEW_LABELS[props.currentView]}</b>
        </text>
        <text fg={theme.textMuted}>{dropdownOpen() ? "^" : "v"}</text>
      </box>

      {/* Dropdown menu */}
      <Show when={dropdownOpen()}>
        <box
          position="absolute"
          top={1}
          left={0}
          right={0}
          backgroundColor={theme.backgroundElement}
          border={["top", "bottom", "left", "right"]}
          borderColor={theme.border}
          zIndex={100}
        >
          <For each={views}>
            {(view) => {
              const isActive = () => view === props.currentView
              return (
                <box
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={isActive() ? theme.backgroundPanel : undefined}
                  onMouseDown={() => {
                    props.onViewChange(view)
                    setDropdownOpen(false)
                  }}
                >
                  <text fg={isActive() ? theme.primary : theme.text}>
                    {isActive() ? "* " : "  "}
                    {VIEW_LABELS[view]}
                  </text>
                </box>
              )
            }}
          </For>
        </box>
      </Show>
    </box>
  )
}

/**
 * Hook to manage sidebar view state (persisted via KV)
 */
export function useSidebarView(side: "left" | "right" = "right") {
  const kv = useKV()
  const key = `tui.sidebar.${side}.view`
  const defaultView: SidebarViewType = side === "right" ? "summary" : "afs"

  const [rawView, setViewRaw] = kv.signal<string>(key, defaultView)

  // Migrate legacy views to new consolidated views
  const view = () => migrateLegacyView(rawView())

  function setView(v: SidebarViewType) {
    setViewRaw(() => v)
  }

  return {
    view,
    setView,
  }
}
