import { For, Show, createMemo } from "solid-js"
import { useWhichKey, type WhichKeyNode } from "@tui/context/which-key"
import { useTheme } from "@tui/context/theme"
import { useTerminalDimensions } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"

/**
 * Which-Key Bottom Bar Component
 *
 * Displays available commands in a Doom-emacs style bottom bar
 * when the leader key (SPC) is pressed.
 *
 * Layout:
 * ┌────────────────────────────────────────────────────────┐
 * │ SPC w-  / split-v  - split-h  d close  m maximize ... │
 * └────────────────────────────────────────────────────────┘
 */
export function WhichKeyBar() {
  const whichKey = useWhichKey()
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()

  // Calculate how many hints fit per row
  const hintsPerRow = createMemo(() => {
    const avgHintWidth = 16 // Average characters per hint
    return Math.max(1, Math.floor((dimensions().width - 12) / avgHintWidth))
  })

  // Group hints into rows
  const rows = createMemo(() => {
    const hints = whichKey.hints
    const perRow = hintsPerRow()
    const result: (typeof hints)[] = []
    for (let i = 0; i < hints.length; i += perRow) {
      result.push(hints.slice(i, i + perRow))
    }
    return result
  })

  // Calculate bar height based on number of rows
  const barHeight = createMemo(() => {
    return Math.max(3, rows().length + 2) // 1 for path, 1 for padding top/bottom
  })

  return (
    <Show when={whichKey.active}>
      <box
        position="absolute"
        bottom={0}
        left={0}
        width={dimensions().width}
        height={barHeight()}
        backgroundColor={theme.backgroundPanel}
        borderColor={theme.border}
        border={["top"]}
        paddingLeft={2}
        paddingRight={2}
        flexDirection="column"
      >
        {/* Path indicator */}
        <box flexDirection="row" marginBottom={0}>
          <text fg={theme.accent} attributes={TextAttributes.BOLD}>
            {whichKey.pathDisplay}
          </text>
          <text fg={theme.textMuted} marginLeft={2}>
            (ESC to cancel, BACKSPACE to go back)
          </text>
        </box>

        {/* Hint rows */}
        <For each={rows()}>
          {(row) => (
            <box flexDirection="row" flexWrap="wrap">
              <For each={row}>
                {(hint) => <HintItem hint={hint} />}
              </For>
            </box>
          )}
        </For>
      </box>
    </Show>
  )
}

/**
 * Individual hint item
 */
function HintItem(props: { hint: WhichKeyNode }) {
  const { theme } = useTheme()

  const keyColor = createMemo(() => {
    // Groups get accent color, actions get primary
    return props.hint.isGroup ? theme.accent : theme.primary
  })

  const labelColor = createMemo(() => {
    // Groups get accent color (dimmed), actions get normal text
    return props.hint.isGroup ? theme.accent : theme.text
  })

  return (
    <box flexDirection="row" minWidth={14} marginRight={2}>
      <text fg={keyColor()} attributes={TextAttributes.BOLD}>
        {props.hint.key}
      </text>
      <text fg={theme.textMuted}>{" "}</text>
      <text fg={labelColor()}>
        {props.hint.label}
      </text>
    </box>
  )
}

/**
 * Compact version of which-key bar for smaller terminals
 * Shows only the most important hints
 */
export function WhichKeyBarCompact() {
  const whichKey = useWhichKey()
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()

  // Only show first 6 hints in compact mode
  const visibleHints = createMemo(() => {
    return whichKey.hints.slice(0, 6)
  })

  const hasMore = createMemo(() => {
    return whichKey.hints.length > 6
  })

  return (
    <Show when={whichKey.active}>
      <box
        position="absolute"
        bottom={0}
        left={0}
        width={dimensions().width}
        height={2}
        backgroundColor={theme.backgroundPanel}
        borderColor={theme.border}
        border={["top"]}
        paddingLeft={1}
        paddingRight={1}
        flexDirection="row"
        alignItems="center"
      >
        <text fg={theme.accent} attributes={TextAttributes.BOLD}>
          {whichKey.pathDisplay}
        </text>

        <For each={visibleHints()}>
          {(hint) => (
            <box flexDirection="row" marginLeft={1}>
              <text fg={hint.isGroup ? theme.accent : theme.primary} attributes={TextAttributes.BOLD}>
                {hint.key}
              </text>
              <text fg={theme.textMuted}>:</text>
              <text fg={theme.text}>
                {hint.label.replace("+", "")}
              </text>
            </box>
          )}
        </For>

        <Show when={hasMore()}>
          <text fg={theme.textMuted} marginLeft={1}>
            +{whichKey.hints.length - 6} more
          </text>
        </Show>
      </box>
    </Show>
  )
}
