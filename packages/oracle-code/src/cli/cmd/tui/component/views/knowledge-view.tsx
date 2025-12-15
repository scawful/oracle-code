import { createEffect, createMemo, createSignal, createResource, For, Show, onCleanup } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "../../context/theme"
import { useCognitive } from "../../context/cognitive"
import { useToM } from "../../context/tom"
import { useDialog } from "../../ui/dialog"
import { useKeyboardMode } from "../../context/keyboard-mode"
import { useRenderer } from "@opentui/solid"
import { usePanes } from "../../context/panes"
import { useAFS } from "../../context/afs"
import { HivemindStore, HivemindDecay, type HivemindEntry, type HivemindState } from "@/cognitive/hivemind"

type TabName = "hivemind" | "tom" | "epistemic" | "councils"

/**
 * KnowledgeView - Unified knowledge dashboard
 *
 * Combines:
 * - Hivemind entries (fears, satisfactions, knowledge, decisions, preferences)
 * - Theory of Mind (agent beliefs, divergences, shared facts)
 * - Epistemic state (golden facts, working facts, assumptions, uncertainties)
 * - Council sessions
 */
export interface KnowledgeViewProps {
  paneId: string
  isActive?: boolean
  initialTab?: TabName
}

export function KnowledgeView(props: KnowledgeViewProps) {
  const { theme } = useTheme()
  const cognitive = useCognitive()
  const tom = useToM()
  const dialog = useDialog()
  const keyboard = useKeyboardMode()
  const renderer = useRenderer()
  const panes = usePanes()
  const afs = useAFS()

  const ownerId = `knowledge-view:${props.paneId}`
  const isPaneActive = createMemo(() => panes.activeId === props.paneId)
  const isActive = createMemo(() => props.isActive ?? isPaneActive())

  const [activeTab, setActiveTab] = createSignal<TabName>(props.initialTab ?? "hivemind")
  const [cursorIndex, setCursorIndex] = createSignal(0)
  const [refreshTrigger, setRefreshTrigger] = createSignal(0)

  // Load hivemind state
  const [hivemindState, { refetch }] = createResource(
    () => ({ trigger: refreshTrigger(), root: afs.root }),
    async (source) => {
      const root = source.root
      if (!root) return null
      return HivemindStore.getState(root)
    },
  )

  // Load decay warnings
  const [decayWarnings] = createResource(
    () => ({ trigger: refreshTrigger(), root: afs.root }),
    async (source) => {
      const root = source.root
      if (!root) return []
      return HivemindDecay.getDecayWarnings(root)
    },
  )

  const tabs: TabName[] = ["hivemind", "tom", "epistemic", "councils"]

  const VIEW_LABELS: Record<TabName, string> = {
    hivemind: "Hivemind",
    tom: "Theory of Mind",
    epistemic: "Epistemic",
    councils: "Councils",
  }

  function focusPane() {
    panes.setActive(props.paneId)
    setTimeout(() => renderer.currentFocusedRenderable?.blur(), 0)
  }

  // Keyboard ownership
  let ownsKeyboard = false
  createEffect(() => {
    const shouldOwn = isActive() && dialog.stack.length === 0

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
      case "j":
      case "down":
        setCursorIndex((i) => Math.min(i + 1, Math.max(0, currentEntries().length - 1)))
        return true

      case "k":
      case "up":
        setCursorIndex((i) => Math.max(i - 1, 0))
        return true

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

      case "r":
        setRefreshTrigger((t) => t + 1)
        refetch()
        return true

      case "1":
      case "2":
      case "3":
      case "4":
        const idx = parseInt(evt.name) - 1
        if (idx < tabs.length) {
          setActiveTab(tabs[idx])
          setCursorIndex(0)
        }
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
    setCursorIndex(0)
  }

  // Get entries for current tab (hivemind only)
  const currentEntries = createMemo(() => {
    const state = hivemindState()
    if (!state) return []

    if (activeTab() === "hivemind") {
      // Flatten all hivemind categories
      return [...state.fears, ...state.satisfactions, ...state.knowledge, ...state.decisions, ...state.preferences]
    }

    return []
  })

  createEffect(() => {
    const max = Math.max(0, currentEntries().length - 1)
    if (cursorIndex() > max) setCursorIndex(max)
  })

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
                setCursorIndex(0)
              }}
            >
              <text
                fg={activeTab() === tab ? theme.info : theme.textMuted}
                attributes={activeTab() === tab ? TextAttributes.BOLD : undefined}
              >
                [{index() + 1}:{VIEW_LABELS[tab]}]
              </text>
            </box>
          )}
        </For>
      </box>

      <scrollbox flexGrow={1} paddingLeft={1} paddingRight={1}>
        {/* Hivemind Tab */}
        <Show when={activeTab() === "hivemind"}>
          <Show when={hivemindState.loading}>
            <text fg={theme.textMuted}>Loading hivemind...</text>
          </Show>

          <Show when={hivemindState.error}>
            <text fg={theme.error}>Error: {String(hivemindState.error)}</text>
          </Show>

          <Show when={!hivemindState.loading && !hivemindState() && !hivemindState.error}>
            <text fg={theme.warning}>AFS not initialized. Run 'ocode afs init' to enable hivemind.</text>
          </Show>

          <Show when={hivemindState()}>
            <HivemindOverviewTab
              state={hivemindState()!}
              warnings={decayWarnings() || []}
              theme={theme}
              cursorIndex={cursorIndex()}
              onCursorChange={setCursorIndex}
            />
          </Show>
        </Show>

        {/* Theory of Mind Tab */}
        <Show when={activeTab() === "tom"}>
          <ToMTab theme={theme} tom={tom} />
        </Show>

        {/* Epistemic Tab */}
        <Show when={activeTab() === "epistemic"}>
          <EpistemicTab theme={theme} cognitive={cognitive} />
        </Show>

        {/* Councils Tab */}
        <Show when={activeTab() === "councils"}>
          <Show when={hivemindState()}>
            <CouncilsTab councils={hivemindState()!.councils} theme={theme} cursorIndex={cursorIndex()} />
          </Show>
          <Show when={!hivemindState()}>
            <text fg={theme.textMuted}>No councils data available.</text>
          </Show>
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
        <text fg={theme.textMuted}>
          {activeTab() === "hivemind" && `${currentEntries().length} entries`}
          {activeTab() === "tom" && `${Object.keys(tom.beliefStates).length} agents`}
          {activeTab() === "epistemic" && `${cognitive.goldenFactCount + cognitive.workingFactCount} facts`}
          {activeTab() === "councils" && `${hivemindState()?.councils.length || 0} councils`}
        </text>
        <text fg={theme.textMuted}>h/l:tabs j/k:nav r:refresh 1-4:jump</text>
      </box>
    </box>
  )
}

/**
 * Hivemind overview tab with all entries
 */
function HivemindOverviewTab(props: {
  state: HivemindState
  warnings: HivemindEntry[]
  theme: any
  cursorIndex: number
  onCursorChange: (index: number) => void
}) {
  // Flatten all entries
  const allEntries = createMemo(() => [
    ...props.state.fears,
    ...props.state.satisfactions,
    ...props.state.knowledge,
    ...props.state.decisions,
    ...props.state.preferences,
  ])

  return (
    <box>
      <Show when={allEntries().length === 0}>
        <text fg={props.theme.textMuted}>No hivemind entries yet.</text>
      </Show>

      <Show when={allEntries().length > 0}>
        <For each={allEntries()}>
          {(entry, index) => (
            <box
              backgroundColor={props.cursorIndex === index() ? props.theme.backgroundElement : undefined}
              paddingLeft={1}
              paddingRight={1}
              marginBottom={entry.id === allEntries()[props.cursorIndex]?.id ? 1 : 0}
            >
              <box flexDirection="row" gap={1}>
                <text fg={getStatusColor(entry.status, props.theme)}>{getStatusIcon(entry.status)}</text>
                <text fg={props.theme.text} attributes={TextAttributes.BOLD}>
                  {entry.key}
                </text>
                <text fg={getCategoryColor(entry.category, props.theme)}>({entry.category})</text>
                <text fg={props.theme.textMuted}>({Math.round(entry.confidence * 100)}%)</text>
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
                    <text fg={props.theme.textMuted}>Accessed: {entry.decay.accessCount}x</text>
                    <Show when={entry.decay.decayRate > 0}>
                      <text fg={props.theme.textMuted}>Decay: {Math.round(entry.decay.decayRate * 100)}%/day</text>
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
 * Theory of Mind tab
 */
function ToMTab(props: { theme: any; tom: ReturnType<typeof useToM> }) {
  const [showDivergences, setShowDivergences] = createSignal(true)
  const [showFacts, setShowFacts] = createSignal(true)

  const syncColor = createMemo(() => {
    const status = props.tom.syncStatusColor
    return status === "success" ? props.theme.success : status === "warning" ? props.theme.warning : props.theme.error
  })

  const hasData = createMemo(() => {
    return Object.keys(props.tom.beliefStates).length > 0 || props.tom.userIntent.primaryIntent.length > 0
  })

  return (
    <Show
      when={hasData()}
      fallback={
        <box flexGrow={1} justifyContent="center" alignItems="center">
          <text fg={props.theme.textMuted}>No belief state data yet.</text>
          <text fg={props.theme.textMuted} marginTop={1}>
            Theory of Mind tracks agent beliefs during multi-agent coordination.
          </text>
        </box>
      }
    >
      <box>
        {/* Sync Status */}
        <text fg={props.theme.text} attributes={TextAttributes.BOLD}>
          Synchronization
        </text>
        <box flexDirection="row" gap={2} marginTop={1} paddingLeft={1}>
          <box flexDirection="row" gap={1}>
            <text fg={syncColor()}>●</text>
            <text fg={props.theme.text}>
              {props.tom.syncStatus === "synchronized"
                ? "Synchronized"
                : props.tom.syncStatus === "divergent"
                  ? "Divergent"
                  : "Unknown"}
            </text>
          </box>
          <Show when={props.tom.divergenceCount > 0}>
            <text fg={props.theme.warning}>({props.tom.divergenceCount} divergences)</text>
          </Show>
        </box>

        {/* Agent Beliefs */}
        <text fg={props.theme.text} attributes={TextAttributes.BOLD} marginTop={1}>
          Agent Beliefs ({Object.keys(props.tom.beliefStates).length})
        </text>
        <box marginTop={1} paddingLeft={1}>
          <For each={Object.entries(props.tom.beliefStates)}>
            {([agentId, state]) => (
              <box marginBottom={1}>
                <text fg={props.theme.info}>@{state.agentName || agentId}</text>
                <text fg={props.theme.textMuted} paddingLeft={1}>
                  {state.knowledge?.length || 0} knowledge items, {state.goals?.length || 0} goals
                </text>
              </box>
            )}
          </For>
        </box>

        {/* User Intent */}
        <Show when={props.tom.userIntent.primaryIntent}>
          <text fg={props.theme.text} attributes={TextAttributes.BOLD} marginTop={1}>
            User Intent
          </text>
          <box marginTop={1} paddingLeft={1}>
            <text fg={props.theme.textMuted}>Primary: {props.tom.userIntent.primaryIntent || "Not detected"}</text>
            <text fg={props.theme.textMuted}>
              Confidence: {props.tom.formatConfidence(props.tom.userIntent.confidence)}
            </text>
          </box>
        </Show>

        {/* Divergences */}
        <Show when={props.tom.highSeverityDivergences.length > 0}>
          <box marginTop={1}>
            <box flexDirection="row" gap={1} onMouseDown={() => setShowDivergences(!showDivergences())}>
              <text fg={props.theme.text}>{showDivergences() ? "▼" : "▶"}</text>
              <text fg={props.theme.warning} attributes={TextAttributes.BOLD}>
                Divergences ({props.tom.highSeverityDivergences.length})
              </text>
            </box>
            <Show when={showDivergences()}>
              <box marginTop={1} paddingLeft={2}>
                <For each={props.tom.highSeverityDivergences}>
                  {(div) => (
                    <box marginBottom={1}>
                      <text fg={props.theme.text}>• {div.key}</text>
                      <For each={div.values}>
                        {(v) => (
                          <text fg={props.theme.textMuted} paddingLeft={2}>
                            @{v.agentName}: {String(v.value).slice(0, 50)}
                            {String(v.value).length > 50 ? "..." : ""}
                          </text>
                        )}
                      </For>
                    </box>
                  )}
                </For>
              </box>
            </Show>
          </box>
        </Show>

        {/* Shared Facts */}
        <Show when={props.tom.commonGround.sharedFacts.length > 0}>
          <box marginTop={1}>
            <box flexDirection="row" gap={1} onMouseDown={() => setShowFacts(!showFacts())}>
              <text fg={props.theme.text}>{showFacts() ? "▼" : "▶"}</text>
              <text fg={props.theme.success} attributes={TextAttributes.BOLD}>
                Shared Facts ({props.tom.commonGround.sharedFacts.length})
              </text>
            </box>
            <Show when={showFacts()}>
              <box marginTop={1} paddingLeft={2}>
                <For each={props.tom.commonGround.sharedFacts}>
                  {(fact) => (
                    <text fg={props.theme.textMuted}>
                      • {fact.key}: {String(fact.value).slice(0, 50)}
                      {String(fact.value).length > 50 ? "..." : ""}
                    </text>
                  )}
                </For>
              </box>
            </Show>
          </box>
        </Show>
      </box>
    </Show>
  )
}

/**
 * Epistemic tab - facts, assumptions, uncertainties
 */
function EpistemicTab(props: { theme: any; cognitive: ReturnType<typeof useCognitive> }) {
  const hasData = createMemo(() => {
    return (
      props.cognitive.goldenFactCount > 0 ||
      props.cognitive.workingFactCount > 0 ||
      props.cognitive.assumptionCount > 0 ||
      props.cognitive.criticalUnknowns > 0
    )
  })

  return (
    <Show
      when={hasData()}
      fallback={
        <box flexGrow={1} justifyContent="center" alignItems="center">
          <text fg={props.theme.textMuted}>No epistemic data yet.</text>
        </box>
      }
    >
      <box>
        {/* Facts */}
        <Show when={props.cognitive.goldenFactCount > 0 || props.cognitive.workingFactCount > 0}>
          <text fg={props.theme.text} attributes={TextAttributes.BOLD}>
            Facts
          </text>
          <box paddingLeft={1} marginTop={1}>
            <Show when={props.cognitive.goldenFactCount > 0}>
              <text fg={props.theme.warning}>★ {props.cognitive.goldenFactCount} golden facts</text>
            </Show>
            <Show when={props.cognitive.workingFactCount > 0}>
              <text fg={props.theme.info}>○ {props.cognitive.workingFactCount} working facts</text>
            </Show>
          </box>
        </Show>

        {/* Assumptions */}
        <Show when={props.cognitive.assumptionCount > 0}>
          <text fg={props.theme.text} attributes={TextAttributes.BOLD} marginTop={1}>
            Assumptions ({props.cognitive.assumptionCount})
          </text>
          <box paddingLeft={1} marginTop={1}>
            <text fg={props.theme.textMuted}>
              {props.cognitive.assumptionCount} assumptions tracked
              {props.cognitive.unvalidatedAssumptions > 0 &&
                ` (${props.cognitive.unvalidatedAssumptions} need validation)`}
            </text>
          </box>
        </Show>

        {/* Uncertainties */}
        <Show when={props.cognitive.criticalUnknowns > 0}>
          <text fg={props.theme.text} attributes={TextAttributes.BOLD} marginTop={1}>
            Critical Unknowns ({props.cognitive.criticalUnknowns})
          </text>
          <box paddingLeft={1} marginTop={1}>
            <text fg={props.theme.warning}>
              There are {props.cognitive.criticalUnknowns} critical uncertainties blocking progress.
            </text>
          </box>
        </Show>
      </box>
    </Show>
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
                <text fg={props.theme.textMuted}>({council.purpose})</text>
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

function getCategoryColor(category: string, theme: any): string {
  switch (category) {
    case "fear":
      return theme.error
    case "satisfaction":
      return theme.success
    case "knowledge":
      return theme.info
    case "decision":
      return theme.warning
    case "preference":
      return theme.primary
    default:
      return theme.textMuted
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
