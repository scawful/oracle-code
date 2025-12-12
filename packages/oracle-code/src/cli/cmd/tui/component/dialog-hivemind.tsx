import { createMemo, createSignal, createResource, For, Show, onCleanup } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useKeyboardMode, useKeyboardOwnership } from "../context/keyboard-mode"
import { HivemindStore, HivemindDecay, type HivemindEntry, type HivemindState } from "@/cognitive/hivemind"
import { AFS } from "@/afs"

type TabName = "overview" | "fears" | "satisfactions" | "knowledge" | "decisions" | "preferences" | "councils"

/**
 * Hivemind Dashboard Dialog
 * 
 * Full-featured dialog for viewing and managing the Hivemind shared learning system.
 * Shows cross-session learnings organized by category with decay status.
 */
export function DialogHivemind(props: { initialTab?: TabName }) {
  const { theme } = useTheme()
  const dialog = useDialog()
  const keyboard = useKeyboardMode()

  dialog.setSize("large")

  const [activeTab, setActiveTab] = createSignal<TabName>(props.initialTab ?? "overview")
  const [cursorIndex, setCursorIndex] = createSignal(0)
  const [refreshTrigger, setRefreshTrigger] = createSignal(0)

  // Load hivemind state
  const [hivemindState, { refetch }] = createResource(
    () => refreshTrigger(),
    async () => {
      const root = await AFS.findRoot()
      if (!root) return null
      return HivemindStore.getState(root)
    }
  )

  // Load decay warnings
  const [decayWarnings] = createResource(
    () => refreshTrigger(),
    async () => {
      const root = await AFS.findRoot()
      if (!root) return []
      return HivemindDecay.getDecayWarnings(root)
    }
  )

  const tabs: TabName[] = ["overview", "fears", "satisfactions", "knowledge", "decisions", "preferences", "councils"]

  // Use the keyboard ownership helper
  useKeyboardOwnership(
    "hivemind-dialog",
    {
      mode: "vim-navigation",
      priority: 100,
      onKey: (evt) => {
        handleKeyboard(evt)
        return true
      },
    },
    keyboard
  )

  function handleKeyboard(evt: { name: string; ctrl?: boolean; shift?: boolean }) {
    switch (evt.name) {
      case "q":
      case "escape":
        dialog.clear()
        break

      case "j":
      case "down":
        setCursorIndex((i) => i + 1)
        break

      case "k":
      case "up":
        setCursorIndex((i) => Math.max(i - 1, 0))
        break

      case "h":
      case "left":
        cycleTab(-1)
        break

      case "l":
      case "right":
        cycleTab(1)
        break

      case "tab":
        cycleTab(1)
        break

      case "r":
        // Refresh
        setRefreshTrigger((t) => t + 1)
        refetch()
        break

      case "1":
      case "2":
      case "3":
      case "4":
      case "5":
      case "6":
      case "7":
        const idx = parseInt(evt.name) - 1
        if (idx < tabs.length) {
          setActiveTab(tabs[idx])
          setCursorIndex(0)
        }
        break
    }
  }

  function cycleTab(direction: 1 | -1) {
    const currentIndex = tabs.indexOf(activeTab())
    let nextIndex = currentIndex + direction
    if (nextIndex < 0) nextIndex = tabs.length - 1
    if (nextIndex >= tabs.length) nextIndex = 0
    setActiveTab(tabs[nextIndex])
    setCursorIndex(0)
  }

  // Get entries for current tab
  const currentEntries = createMemo(() => {
    const state = hivemindState()
    if (!state) return []
    
    switch (activeTab()) {
      case "fears": return state.fears
      case "satisfactions": return state.satisfactions
      case "knowledge": return state.knowledge
      case "decisions": return state.decisions
      case "preferences": return state.preferences
      case "councils": return state.councils as any[]
      default: return []
    }
  })

  // Summary stats
  const stats = createMemo(() => {
    const state = hivemindState()
    if (!state) return null
    return state.manifest.stats
  })

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1}>
      {/* Header */}
      <box flexDirection="row" justifyContent="space-between" marginBottom={1}>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Hivemind - Cross-Session Learning
        </text>
        <text fg={theme.textMuted}>q:close h/l:tabs j/k:nav r:refresh 1-7:jump</text>
      </box>

      {/* Tab Bar */}
      <box flexDirection="row" gap={1} marginBottom={1}>
        <For each={tabs}>
          {(tab, index) => (
            <box
              onMouseDown={() => {
                setActiveTab(tab)
                setCursorIndex(0)
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
      </box>

      {/* Loading State */}
      <Show when={hivemindState.loading}>
        <text fg={theme.textMuted}>Loading hivemind...</text>
      </Show>

      {/* Error State */}
      <Show when={hivemindState.error}>
        <text fg={theme.error}>Error loading hivemind: {String(hivemindState.error)}</text>
      </Show>

      {/* No AFS State */}
      <Show when={!hivemindState.loading && !hivemindState() && !hivemindState.error}>
        <text fg={theme.warning}>AFS not initialized. Run 'ocode afs init' to enable hivemind.</text>
      </Show>

      {/* Content */}
      <Show when={hivemindState()}>
        {/* Overview Tab */}
        <Show when={activeTab() === "overview"}>
          <OverviewTab state={hivemindState()!} warnings={decayWarnings() || []} theme={theme} />
        </Show>

        {/* Entry List Tabs */}
        <Show when={activeTab() !== "overview" && activeTab() !== "councils"}>
          <EntryListTab
            entries={currentEntries()}
            theme={theme}
            cursorIndex={cursorIndex()}
            onCursorChange={setCursorIndex}
          />
        </Show>

        {/* Councils Tab */}
        <Show when={activeTab() === "councils"}>
          <CouncilsTab councils={hivemindState()!.councils} theme={theme} cursorIndex={cursorIndex()} />
        </Show>
      </Show>
    </box>
  )
}

/**
 * Overview tab showing summary stats
 */
function OverviewTab(props: { state: HivemindState; warnings: HivemindEntry[]; theme: any }) {
  const stats = () => props.state.manifest.stats

  return (
    <box>
      {/* Stats Summary */}
      <text fg={props.theme.text} attributes={TextAttributes.BOLD}>
        Summary
      </text>
      <box paddingLeft={1} marginBottom={1}>
        <box flexDirection="row" gap={2}>
          <text fg={props.theme.textMuted}>Total Entries:</text>
          <text fg={props.theme.text}>{stats().totalEntries}</text>
        </box>
        <box flexDirection="row" gap={2}>
          <text fg={props.theme.textMuted}>Golden (Permanent):</text>
          <text fg={props.theme.success}>{stats().goldenCount}</text>
        </box>
        <box flexDirection="row" gap={2}>
          <text fg={props.theme.textMuted}>Decaying:</text>
          <text fg={stats().decayingCount > 0 ? props.theme.warning : props.theme.textMuted}>
            {stats().decayingCount}
          </text>
        </box>
        <box flexDirection="row" gap={2}>
          <text fg={props.theme.textMuted}>Contested:</text>
          <text fg={stats().contestedCount > 0 ? props.theme.error : props.theme.textMuted}>
            {stats().contestedCount}
          </text>
        </box>
      </box>

      {/* By Category */}
      <text fg={props.theme.text} attributes={TextAttributes.BOLD}>
        By Category
      </text>
      <box paddingLeft={1} marginBottom={1}>
        <For each={Object.entries(stats().entriesByCategory)}>
          {([category, count]) => (
            <box flexDirection="row" gap={2}>
              <text fg={props.theme.textMuted}>{category}:</text>
              <text fg={props.theme.text}>{count as number}</text>
            </box>
          )}
        </For>
      </box>

      {/* Decay Warnings */}
      <Show when={props.warnings.length > 0}>
        <text fg={props.theme.warning} attributes={TextAttributes.BOLD}>
          Decay Warnings ({props.warnings.length})
        </text>
        <box paddingLeft={1}>
          <For each={props.warnings.slice(0, 5)}>
            {(entry) => (
              <box flexDirection="row" gap={1}>
                <text fg={props.theme.warning}>●</text>
                <text fg={props.theme.text}>{entry.key}</text>
                <text fg={props.theme.textMuted}>({entry.category})</text>
              </box>
            )}
          </For>
          <Show when={props.warnings.length > 5}>
            <text fg={props.theme.textMuted}>...and {props.warnings.length - 5} more</text>
          </Show>
        </box>
      </Show>

      {/* Active Councils */}
      <Show when={props.state.councils.filter((c) => c.status === "voting" || c.status === "debating").length > 0}>
        <text fg={props.theme.info} attributes={TextAttributes.BOLD}>
          Active Councils
        </text>
        <box paddingLeft={1}>
          <For each={props.state.councils.filter((c) => c.status === "voting" || c.status === "debating")}>
            {(council) => (
              <box flexDirection="row" gap={1}>
                <text fg={props.theme.info}>●</text>
                <text fg={props.theme.text}>{council.entryKey}</text>
                <text fg={props.theme.textMuted}>({council.status})</text>
              </box>
            )}
          </For>
        </box>
      </Show>

      {/* Config Info */}
      <box marginTop={1}>
        <text fg={props.theme.textMuted} attributes={TextAttributes.DIM}>
          Global Enabled: {props.state.manifest.globalEnabled ? "Yes" : "No"} | Last Sync:{" "}
          {new Date(props.state.manifest.lastSync).toLocaleString()}
        </text>
      </box>
    </box>
  )
}

/**
 * Entry list tab for fears, satisfactions, etc.
 */
function EntryListTab(props: {
  entries: HivemindEntry[]
  theme: any
  cursorIndex: number
  onCursorChange: (index: number) => void
}) {
  return (
    <box>
      <Show when={props.entries.length === 0}>
        <text fg={props.theme.textMuted}>No entries in this category.</text>
      </Show>

      <Show when={props.entries.length > 0}>
        <For each={props.entries}>
          {(entry, index) => (
            <box
              backgroundColor={props.cursorIndex === index() ? props.theme.backgroundElement : undefined}
              paddingLeft={1}
              paddingRight={1}
              marginBottom={entry.id === props.entries[props.cursorIndex]?.id ? 1 : 0}
            >
              <box flexDirection="row" gap={1}>
                <text fg={getStatusColor(entry.status, props.theme)}>
                  {getStatusIcon(entry.status)}
                </text>
                <text fg={props.theme.text} attributes={TextAttributes.BOLD}>
                  {entry.key}
                </text>
                <text fg={props.theme.textMuted}>
                  ({Math.round(entry.confidence * 100)}%)
                </text>
                <Show when={entry.scope === "global"}>
                  <text fg={props.theme.info}>[GLOBAL]</text>
                </Show>
              </box>

              {/* Show details when selected */}
              <Show when={props.cursorIndex === index()}>
                <box paddingLeft={2}>
                  <text fg={props.theme.text}>{entry.value}</text>
                  <box flexDirection="row" gap={2} marginTop={1}>
                    <text fg={props.theme.textMuted}>Source: {entry.source.agentRole}</text>
                    <text fg={props.theme.textMuted}>
                      Accessed: {entry.decay.accessCount}x
                    </text>
                    <Show when={entry.decay.decayRate > 0}>
                      <text fg={props.theme.textMuted}>
                        Decay: {Math.round(entry.decay.decayRate * 100)}%/day
                      </text>
                    </Show>
                  </box>
                  <text fg={props.theme.textMuted} attributes={TextAttributes.DIM}>
                    {entry.source.promotionReason}
                  </text>
                </box>
              </Show>
            </box>
          )}
        </For>
      </Show>
    </box>
  )
}

/**
 * Councils tab
 */
function CouncilsTab(props: { councils: any[]; theme: any; cursorIndex: number }) {
  return (
    <box>
      <Show when={props.councils.length === 0}>
        <text fg={props.theme.textMuted}>No council sessions.</text>
      </Show>

      <Show when={props.councils.length > 0}>
        <For each={props.councils}>
          {(council, index) => (
            <box
              backgroundColor={props.cursorIndex === index() ? props.theme.backgroundElement : undefined}
              paddingLeft={1}
              paddingRight={1}
              marginBottom={1}
            >
              <box flexDirection="row" gap={1}>
                <text fg={getCouncilStatusColor(council.status, props.theme)}>
                  {getCouncilStatusIcon(council.status)}
                </text>
                <text fg={props.theme.text} attributes={TextAttributes.BOLD}>
                  {council.entryKey}
                </text>
                <text fg={props.theme.textMuted}>
                  ({council.purpose})
                </text>
              </box>
              <box paddingLeft={2}>
                <text fg={props.theme.textMuted}>Status: {council.status}</text>
                <text fg={props.theme.textMuted}>
                  Votes: {council.votes?.length || 0}/{council.config?.councilSize || 3}
                </text>
              </box>
            </box>
          )}
        </For>
      </Show>
    </box>
  )
}

// Helper functions
function getStatusColor(status: string, theme: any): string {
  switch (status) {
    case "golden":
      return theme.success
    case "decaying":
      return theme.warning
    case "contested":
      return theme.error
    default:
      return theme.text
  }
}

function getStatusIcon(status: string): string {
  switch (status) {
    case "golden":
      return "★"
    case "decaying":
      return "◐"
    case "contested":
      return "⚡"
    default:
      return "●"
  }
}

function getCouncilStatusColor(status: string, theme: any): string {
  switch (status) {
    case "approved":
      return theme.success
    case "rejected":
      return theme.error
    case "voting":
      return theme.info
    case "debating":
      return theme.warning
    default:
      return theme.textMuted
  }
}

function getCouncilStatusIcon(status: string): string {
  switch (status) {
    case "approved":
      return "✓"
    case "rejected":
      return "✗"
    case "voting":
      return "⏳"
    case "debating":
      return "💬"
    default:
      return "●"
  }
}
