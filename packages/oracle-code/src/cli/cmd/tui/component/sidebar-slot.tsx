import { createSignal, Show, For } from "solid-js"
import { useTheme } from "../context/theme"
import { useKV } from "../context/kv"

// View types available in sidebar
export type SidebarViewType =
  | "summary" // Default: session summary (original sidebar content)
  | "cognitive" // Cognitive state dashboard
  | "agents" // Agent lanes and status
  | "afs" // AFS browser
  | "state" // Shared state
  | "hivemind" // Hivemind entries
  | "metrics" // Coordination metrics
  | "tom" // Theory of mind

const VIEW_LABELS: Record<SidebarViewType, string> = {
  summary: "Summary",
  cognitive: "Cognitive",
  agents: "Agents",
  afs: "AFS",
  state: "State",
  hivemind: "Hivemind",
  metrics: "Metrics",
  tom: "ToM",
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

  const views: SidebarViewType[] = ["summary", "cognitive", "agents", "afs", "state", "hivemind", "metrics", "tom"]

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

  const [view, setViewRaw] = kv.signal<SidebarViewType>(key, defaultView)

  function setView(v: SidebarViewType) {
    // KV signal setter expects a Setter function or value
    setViewRaw(() => v)
  }

  return {
    view: view as () => SidebarViewType,
    setView,
  }
}
