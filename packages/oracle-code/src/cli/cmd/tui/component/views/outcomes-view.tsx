import { TextAttributes } from "@opentui/core"
import { Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import type { KeyboardOwner } from "../../context/keyboard-mode"
import { useKeyboardMode } from "../../context/keyboard-mode"
import { useAFS } from "../../context/afs"
import { useTheme } from "../../context/theme"
import { useDialog } from "../../ui/dialog"
import { useToast } from "../../ui/toast"
import { useRenderer } from "@opentui/solid"
import { TaskTracking } from "@/metrics/tracking"
import { Locale } from "@/util/locale"
import { ErrorDetection } from "@/metrics/errors"
import { usePanes } from "../../context/panes"

export interface OutcomesViewProps {
  /** Pane ID (used for keyboard ownership scoping) */
  paneId: string
  /** Whether this pane is currently active/focused */
  isActive?: boolean
}

function formatType(type: ErrorDetection.ErrorType) {
  return type.replace(/_/g, " ")
}

export function OutcomesView(props: OutcomesViewProps) {
  const afs = useAFS()
  const { theme } = useTheme()
  const dialog = useDialog()
  const toast = useToast()
  const keyboard = useKeyboardMode()
  const renderer = useRenderer()
  const panes = usePanes()
  const ownerId = `outcomes-view:${props.paneId}`
  const isPaneActive = createMemo(() => panes.activeId === props.paneId)
  const isActive = createMemo(() => (props.isActive ?? isPaneActive()))

  function focusPane() {
    panes.setActive(props.paneId)
    setTimeout(() => renderer.currentFocusedRenderable?.blur(), 0)
  }

  const [outcomes, setOutcomes] = createSignal<TaskTracking.TrackedOutcome[]>([])
  const [loading, setLoading] = createSignal(false)
  const [loadError, setLoadError] = createSignal<string | null>(null)

  const [onlyIssues, setOnlyIssues] = createSignal(true)
  const [selectedIndex, setSelectedIndex] = createSignal(0)

  async function refresh() {
    const root = afs.root
    if (!root) {
      setOutcomes([])
      setLoadError(null)
      return
    }

    try {
      setLoading(true)
      setLoadError(null)
      const list = await TaskTracking.loadOutcomes(root)
      setOutcomes(list)
    } catch (e) {
      setLoadError(String(e))
      setOutcomes([])
    } finally {
      setLoading(false)
    }
  }

  createEffect(() => {
    // Auto-refresh when AFS root becomes available / changes.
    void afs.root
    void refresh()
  })

  const sorted = createMemo(() => {
    const list = outcomes()
    // Newest first
    return [...list].sort((a, b) => b.timestamp - a.timestamp)
  })

  const visible = createMemo(() => {
    const list = sorted()
    const filtered = onlyIssues()
      ? list.filter((o) => !o.success || (o.errors?.length ?? 0) > 0 || o.errorCount > 0)
      : list
    return filtered.slice(0, 250)
  })

  createEffect(() => {
    const len = visible().length
    if (len === 0) {
      setSelectedIndex(0)
      return
    }
    if (selectedIndex() >= len) setSelectedIndex(len - 1)
  })

  const selected = createMemo(() => {
    const list = visible()
    return list[selectedIndex()] ?? null
  })

  async function setSelectedSuccess(success: boolean) {
    const root = afs.root
    const current = selected()
    if (!root || !current) return

    try {
      const list = await TaskTracking.loadOutcomes(root)
      const idx = list.findIndex((o) => o.taskID === current.taskID)
      if (idx < 0) {
        toast.show({ message: "Outcome not found on disk", variant: "warning", duration: 2000 })
        return
      }
      list[idx] = { ...list[idx], success }
      await TaskTracking.saveOutcomes(root, list)
      toast.show({ message: success ? "Marked as success" : "Marked as failure", variant: "success", duration: 1500 })
      setOutcomes(list)
    } catch (e) {
      toast.show({ message: `Failed to update outcome: ${String(e)}`, variant: "error", duration: 4000 })
    }
  }

  function handleKey(evt: { name: string; ctrl?: boolean; shift?: boolean; meta?: boolean }): boolean {
    const list = visible()

    switch (evt.name) {
      case "r":
        void refresh()
        return true

      case "e":
        setOnlyIssues((v) => !v)
        return true

      case "j":
      case "down":
        if (list.length > 0) setSelectedIndex((i) => Math.min(i + 1, list.length - 1))
        return true

      case "k":
      case "up":
        if (list.length > 0) setSelectedIndex((i) => Math.max(i - 1, 0))
        return true

      case "g":
        setSelectedIndex(0)
        return true

      case "G":
        if (list.length > 0) setSelectedIndex(list.length - 1)
        return true

      case "y":
      case "Y":
        void setSelectedSuccess(true)
        return true

      case "n":
      case "N":
        void setSelectedSuccess(false)
        return true
    }

    return false
  }

  // Acquire/release keyboard ownership when this pane is active.
  let ownsKeyboard = false
  createEffect(() => {
    const shouldOwn = isActive() && dialog.stack.length === 0

    if (shouldOwn && !ownsKeyboard) {
      ownsKeyboard = true
      renderer.currentFocusedRenderable?.blur()
      keyboard.acquire(ownerId, {
        mode: "vim-navigation",
        priority: 40,
        onKey: handleKey,
      } satisfies Omit<KeyboardOwner, "id">)
    }

    if (!shouldOwn && ownsKeyboard) {
      ownsKeyboard = false
      keyboard.release(ownerId)
    }
  })
  onCleanup(() => {
    if (ownsKeyboard) keyboard.release(ownerId)
  })

  const statsLine = createMemo(() => {
    const all = outcomes().length
    const issues = outcomes().filter((o) => !o.success || (o.errors?.length ?? 0) > 0 || o.errorCount > 0).length
    const mode = onlyIssues() ? "issues" : "all"
    return `${mode} · ${issues}/${all}`
  })

  return (
    <box flexGrow={1} flexDirection="column" overflow="hidden" onMouseDown={focusPane}>
      {/* Header */}
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
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            Outcomes
          </text>
          <text fg={theme.textMuted}>{statsLine()}</text>
          <box>
            <text fg={loading() ? theme.warning : theme.textMuted} attributes={TextAttributes.DIM}>
              {loading() ? "loading…" : ""}
            </text>
          </box>
        </box>
        <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
          j/k nav · e filter · y/n mark · r refresh
        </text>
      </box>

      {/* Main list */}
      <box flexGrow={1} overflow="hidden">
        <Show
          when={afs.exists}
          fallback={
            <box flexGrow={1} justifyContent="center" alignItems="center">
              <text fg={theme.textMuted}>AFS not initialized.</text>
              <text fg={theme.textMuted} marginTop={1}>
                Run <b>ocode afs init</b> to enable outcomes tracking.
              </text>
            </box>
          }
        >
          <Show
            when={!loadError()}
            fallback={
              <box flexGrow={1} justifyContent="center" alignItems="center">
                <text fg={theme.error}>Failed to load outcomes</text>
                <text fg={theme.textMuted} marginTop={1}>
                  {loadError()}
                </text>
              </box>
            }
          >
            <Show
              when={visible().length > 0}
              fallback={
                <box flexGrow={1} justifyContent="center" alignItems="center">
                  <text fg={theme.textMuted}>{onlyIssues() ? "No issues yet." : "No outcomes yet."}</text>
                  <text fg={theme.textMuted} marginTop={1}>
                    Tool chains and tasks will appear here as they complete.
                  </text>
                </box>
              }
            >
              <scrollbox flexGrow={1} paddingTop={1} paddingLeft={1} paddingRight={1}>
                {visible().map((o, idx) => {
                  const isSelected = () => idx === selectedIndex()
                  const hasIssues = () => !o.success || (o.errors?.length ?? 0) > 0 || o.errorCount > 0
                  const time = Locale.todayTimeOrDateTime(o.timestamp)
                  const status = o.success ? "✓" : "✗"
                  const issueCount = (o.errors?.length ?? o.errorCount) || 0
                  const description = o.taskDescription || o.taskID
                  const line = `${time} ${status} @${o.agentName} ${Locale.truncate(description, 80)}`
                  return (
                    <box
                      backgroundColor={isSelected() ? theme.backgroundPanel : undefined}
                      paddingLeft={1}
                      paddingRight={1}
                      paddingBottom={0}
                      onMouseDown={() => setSelectedIndex(idx)}
                    >
                      <text
                        fg={isSelected() ? theme.text : theme.textMuted}
                        attributes={isSelected() ? TextAttributes.BOLD : undefined}
                        wrapMode="word"
                      >
                        {line}
                      </text>
                      <box flexGrow={1} />
                      <text fg={hasIssues() ? theme.warning : theme.textMuted}>{hasIssues() ? `!${issueCount}` : ""}</text>
                    </box>
                  )
                })}
              </scrollbox>
            </Show>
          </Show>
        </Show>
      </box>

      {/* Details */}
      <box
        height={8}
        backgroundColor={theme.background}
        border={["top"]}
        borderColor={theme.border}
        paddingLeft={1}
        paddingRight={1}
        paddingTop={1}
        flexDirection="column"
        flexShrink={0}
        overflow="hidden"
      >
        <Show when={selected()} fallback={<text fg={theme.textMuted}>Select an item to see details.</text>}>
          {(current) => {
            const taskDescription = current().taskDescription
            const errors = current().errors ?? []
            return (
              <>
                <box flexDirection="row" justifyContent="space-between">
                  <text fg={theme.text} attributes={TextAttributes.BOLD}>
                    {current().success ? "✓ Success" : "✗ Failure"} · {Locale.number(current().tokens)} tokens ·{" "}
                    {Locale.duration(current().duration)}
                  </text>
                  <text fg={theme.textMuted}>{current().taskID}</text>
                </box>
                <text fg={theme.textMuted}>{taskDescription ? Locale.truncate(taskDescription, 120) : ""}</text>
                <box flexDirection="column" marginTop={1}>
                  <Show when={errors.length > 0} fallback={<text fg={theme.textMuted}>No heuristic issues recorded.</text>}>
                    <scrollbox>
                      {errors.slice(0, 3).map((err) => (
                        <text fg={theme.text} wrapMode="word">
                          <span style={{ fg: theme.warning }}>• {formatType(err.type)}</span>{" "}
                          <span style={{ fg: theme.textMuted }}>({Math.round(err.severity * 100)}%)</span>{" "}
                          {Locale.truncate(err.evidence, 120)}
                        </text>
                      ))}
                    </scrollbox>
                  </Show>
                </box>
              </>
            )
          }}
        </Show>
      </box>
    </box>
  )
}
