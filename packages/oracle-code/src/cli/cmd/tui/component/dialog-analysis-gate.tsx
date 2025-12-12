import { Show, For, createSignal } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useAnalysisGate, type PendingAnalysis } from "../context/analysis-gate"
import { useToast } from "../ui/toast"

/**
 * Analysis Gate Dialog
 *
 * Shows pending analysis triggers and allows user to accept/deny them.
 * Can also configure individual triggers and global gate mode.
 * 
 * Keyboard shortcuts:
 * - Y: Accept current pending
 * - N: Deny current pending
 * - A: Set trigger to auto-accept
 * - D: Disable trigger
 * - M: Cycle gate mode
 * - j/k: Navigate queue
 * - Esc: Close
 */
export function DialogAnalysisGate() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const gate = useAnalysisGate()
  const toast = useToast()

  const [selectedIndex, setSelectedIndex] = createSignal(0)

  dialog.setSize("large")

  // Mode icon mapping
  const modeIcon: Record<string, string> = {
    "confirm-all": "●",
    "auto-accept": "◆",
    "auto-deny": "○",
  }

  // Category icon
  const categoryIcon: Record<string, string> = {
    fear: "!",
    curiosity: "?",
    satisfaction: "+",
    frustration: "-",
  }

  useKeyboard((evt) => {
    if (evt.defaultPrevented) return

    const current = gate.currentPending

    switch (evt.name) {
      case "y":
      case "Y":
        if (current) {
          gate.accept(current.id)
          toast.show({ message: "Analysis accepted", variant: "success", duration: 1500 })
        }
        break

      case "n":
      case "N":
        if (current) {
          gate.deny(current.id)
          toast.show({ message: "Analysis denied", variant: "info", duration: 1500 })
        }
        break

      case "a":
      case "A":
        if (current) {
          gate.setTriggerAutoAccept(current.trigger.id, true)
          gate.accept(current.id)
          toast.show({ message: `${current.trigger.name} set to auto-accept`, variant: "success", duration: 2000 })
        }
        break

      case "d":
      case "D":
        if (current) {
          gate.disableTrigger(current.trigger.id)
          gate.deny(current.id)
          toast.show({ message: `${current.trigger.name} disabled`, variant: "info", duration: 2000 })
        }
        break

      case "m":
      case "M":
        gate.cycleMode()
        toast.show({ message: `Gate mode: ${gate.modeLabel}`, variant: "info", duration: 1500 })
        break

      case "j":
      case "down":
        if (gate.pending.length > 1) {
          setSelectedIndex((i) => Math.min(i + 1, gate.pending.length - 1))
        }
        break

      case "k":
      case "up":
        if (gate.pending.length > 1) {
          setSelectedIndex((i) => Math.max(i - 1, 0))
        }
        break

      case "q":
        dialog.clear()
        break
    }
  })

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      {/* Header */}
      <box flexDirection="row" justifyContent="space-between">
        <box flexDirection="row" gap={2}>
          <text attributes={TextAttributes.BOLD} fg={theme.text}>
            Analysis Gate
          </text>
          <text fg={theme.textMuted}>
            {modeIcon[gate.mode]} {gate.modeLabel}
          </text>
          <Show when={gate.hasPending}>
            <text fg={theme.warning}>
              ({gate.pendingCount} pending)
            </text>
          </Show>
        </box>
        <text fg={theme.textMuted}>esc</text>
      </box>

      {/* Current pending analysis */}
      <Show
        when={gate.currentPending}
        fallback={
          <box paddingTop={1} paddingBottom={1}>
            <text fg={theme.textMuted}>
              No pending analyses. Triggers will appear here when conditions are met.
            </text>
            <text fg={theme.textMuted} marginTop={1}>
              Current mode: {gate.modeLabel} - Press M to cycle modes
            </text>
          </box>
        }
      >
        {(pending) => (
          <box flexDirection="column" marginTop={1}>
            <box
              flexDirection="column"
              border={["left"]}
              borderColor={theme.warning}
              paddingLeft={2}
              paddingTop={1}
              paddingBottom={1}
              backgroundColor={theme.backgroundElement}
            >
              <text fg={theme.warning} attributes={TextAttributes.BOLD}>
                {pending().trigger.name}
              </text>
              <text fg={theme.textMuted}>
                {pending().trigger.description}
              </text>

              <box marginTop={1}>
                <text fg={theme.text} attributes={TextAttributes.BOLD}>
                  Conditions matched:
                </text>
              </box>
              <For each={pending().matchedConditions}>
                {(condition) => (
                  <text fg={theme.text} paddingLeft={1}>
                    - {condition}
                  </text>
                )}
              </For>

              <box marginTop={1}>
                <text fg={theme.text} attributes={TextAttributes.BOLD}>
                  Suggested action:
                </text>
              </box>
              <text fg={theme.text} paddingLeft={1}>
                - Mode: {pending().trigger.suggestion.analysisMode}
              </text>
              <Show when={pending().trigger.suggestion.subagentType}>
                <text fg={theme.info} paddingLeft={1}>
                  - Spawn: @{pending().trigger.suggestion.subagentType}
                </text>
              </Show>
              <Show when={pending().trigger.suggestion.emotionToRecord}>
                {(emotion) => (
                  <text fg={theme.text} paddingLeft={1}>
                    - Record: [{categoryIcon[emotion().category] || "?"}] {emotion().category} (intensity {emotion().intensity})
                  </text>
                )}
              </Show>
            </box>

            {/* Actions */}
            <box flexDirection="row" gap={3} marginTop={1}>
              <text fg={theme.success}>
                <b>Y</b> <span style={{ fg: theme.textMuted }}>accept</span>
              </text>
              <text fg={theme.error}>
                <b>N</b> <span style={{ fg: theme.textMuted }}>deny</span>
              </text>
              <text fg={theme.info}>
                <b>A</b> <span style={{ fg: theme.textMuted }}>auto-accept</span>
              </text>
              <text fg={theme.textMuted}>
                <b>D</b> <span style={{ fg: theme.textMuted }}>disable</span>
              </text>
            </box>
          </box>
        )}
      </Show>

      {/* Queue list */}
      <Show when={gate.pending.length > 1}>
        <box marginTop={1}>
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            Queue ({gate.pendingCount}):
          </text>
        </box>
        <box maxHeight={5}>
          <For each={gate.pending.slice(0, 5)}>
            {(item, index) => (
              <text
                fg={index() === selectedIndex() ? theme.text : theme.textMuted}
                paddingLeft={1}
              >
                {index() === selectedIndex() ? ">" : " "} {item.trigger.name}
              </text>
            )}
          </For>
        </box>
      </Show>

      {/* Stats */}
      <box marginTop={1} flexDirection="row" gap={1}>
        <text fg={theme.textMuted}>
          Stats: 
        </text>
        <text fg={theme.success}>{gate.stats.accepted} accepted</text>
        <text fg={theme.textMuted}>|</text>
        <text fg={theme.error}>{gate.stats.denied} denied</text>
        <text fg={theme.textMuted}>|</text>
        <text fg={theme.info}>{gate.stats.autoAccepted} auto</text>
        <text fg={theme.textMuted}>|</text>
        <text fg={theme.textMuted}>{gate.stats.expired} expired</text>
      </box>

      {/* Footer */}
      <box marginTop={1} flexDirection="row" gap={2}>
        <text fg={theme.text}>
          <b>M</b> <span style={{ fg: theme.textMuted }}>cycle mode</span>
        </text>
        <text fg={theme.text}>
          <b>j/k</b> <span style={{ fg: theme.textMuted }}>navigate</span>
        </text>
      </box>
    </box>
  )
}

/**
 * Compact analysis gate indicator for status bar
 */
export function AnalysisGateIndicator() {
  const { theme } = useTheme()
  const gate = useAnalysisGate()

  const modeIcon: Record<string, string> = {
    "confirm-all": "●",
    "auto-accept": "◆",
    "auto-deny": "○",
  }

  return (
    <Show when={gate.hasPending || gate.mode !== "confirm-all"}>
      <box flexDirection="row" gap={1}>
        <text fg={gate.hasPending ? theme.warning : theme.textMuted}>
          {modeIcon[gate.mode]}
        </text>
        <Show when={gate.hasPending}>
          <text fg={theme.warning}>{gate.pendingCount}</text>
        </Show>
      </box>
    </Show>
  )
}

/**
 * Notification toast for new triggers
 */
export function AnalysisTriggerToast(props: { analysis: PendingAnalysis; onDismiss?: () => void }) {
  const { theme } = useTheme()
  const gate = useAnalysisGate()

  return (
    <box
      flexDirection="column"
      border={["left"]}
      borderColor={theme.warning}
      paddingLeft={2}
      paddingTop={1}
      paddingBottom={1}
      width={50}
    >
      <box flexDirection="row" gap={1}>
        <text fg={theme.warning}>*</text>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {props.analysis.trigger.name}
        </text>
      </box>
      <text fg={theme.textMuted} paddingLeft={2}>
        {props.analysis.trigger.description}
      </text>
      <box flexDirection="row" gap={2} marginTop={1}>
        <text
          fg={theme.success}
          onMouseDown={() => {
            gate.accept(props.analysis.id)
            props.onDismiss?.()
          }}
        >
          [Y] Accept
        </text>
        <text
          fg={theme.error}
          onMouseDown={() => {
            gate.deny(props.analysis.id)
            props.onDismiss?.()
          }}
        >
          [N] Deny
        </text>
      </box>
    </box>
  )
}
