import { createSignal, createMemo, createEffect, onCleanup, For, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "../../context/theme"
import { useMessages, type Message, type MessageLevel } from "../../context/messages"
import { useDialog } from "../../ui/dialog"
import { useKeyboardMode } from "../../context/keyboard-mode"
import { useRenderer } from "@opentui/solid"
import { usePanes } from "../../context/panes"

/**
 * MessagesView - Emacs-style *Messages* buffer
 * 
 * Displays notification history with vim navigation.
 * Newest messages at bottom (like Emacs *Messages*).
 */

export interface MessagesViewProps {
  paneId: string
  isActive?: boolean
}

export function MessagesView(props: MessagesViewProps) {
  const messages = useMessages()
  const { theme } = useTheme()
  const dialog = useDialog()
  const keyboard = useKeyboardMode()
  const renderer = useRenderer()
  const panes = usePanes()
  
  const ownerId = `messages-view:${props.paneId}`
  const isPaneActive = createMemo(() => panes.activeId === props.paneId)
  const isActive = createMemo(() => props.isActive ?? isPaneActive())

  // Navigation state
  const [cursorIndex, setCursorIndex] = createSignal(-1) // -1 means follow tail
  const [filterSource, setFilterSource] = createSignal<string | null>(null)

  // Filtered messages
  const filteredMessages = createMemo(() => {
    const source = filterSource()
    if (!source) return messages.messages
    return messages.getBySource(source)
  })

  // Clamp cursor when messages change
  createEffect(() => {
    const msgs = filteredMessages()
    if (msgs.length === 0) {
      setCursorIndex(-1)
    } else if (cursorIndex() >= msgs.length) {
      setCursorIndex(msgs.length - 1)
    }
  })

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
    const msgs = filteredMessages()
    const idx = cursorIndex()

    switch (evt.name) {
      case "j":
      case "down":
        if (idx < msgs.length - 1) {
          setCursorIndex(idx + 1)
        }
        return true

      case "k":
      case "up":
        if (idx > 0) {
          setCursorIndex(idx - 1)
        } else if (idx === -1 && msgs.length > 0) {
          setCursorIndex(msgs.length - 1)
        }
        return true

      case "g":
        // gg - go to top (would need double-tap detection, simplified to just g)
        setCursorIndex(0)
        return true

      case "G":
        // Go to bottom / follow mode
        setCursorIndex(-1)
        return true

      case "d":
        // Clear all messages
        messages.clear()
        setCursorIndex(-1)
        return true

      case "f":
        // Cycle through source filters
        cycleSourceFilter()
        return true

      case "r":
        // Reset filter
        setFilterSource(null)
        return true
    }

    return false
  }

  function cycleSourceFilter() {
    const sources = messages.sources
    if (sources.length === 0) {
      setFilterSource(null)
      return
    }

    const current = filterSource()
    if (!current) {
      setFilterSource(sources[0])
    } else {
      const idx = sources.indexOf(current)
      if (idx === sources.length - 1) {
        setFilterSource(null) // Back to all
      } else {
        setFilterSource(sources[idx + 1])
      }
    }
  }

  function getLevelColor(level: MessageLevel): string {
    switch (level) {
      case "error": return theme.error.toString()
      case "warning": return theme.warning.toString()
      case "success": return theme.success.toString()
      case "info": return theme.info.toString()
    }
  }

  function getLevelIcon(level: MessageLevel): string {
    switch (level) {
      case "error": return "✗"
      case "warning": return "⚠"
      case "success": return "✓"
      case "info": return "●"
    }
  }

  function formatTimestamp(ts: number): string {
    const date = new Date(ts)
    return date.toLocaleTimeString("en-US", { 
      hour12: false, 
      hour: "2-digit", 
      minute: "2-digit", 
      second: "2-digit" 
    })
  }

  // Effective cursor (resolve -1 to actual last index for display)
  const effectiveCursor = createMemo(() => {
    const idx = cursorIndex()
    if (idx === -1) return filteredMessages().length - 1
    return idx
  })

  return (
    <box flexGrow={1} flexDirection="column" overflow="hidden" onMouseDown={focusPane}>
      {/* Messages list */}
      <scrollbox flexGrow={1} paddingLeft={1} paddingRight={1}>
        <Show when={filteredMessages().length === 0}>
          <box flexGrow={1} justifyContent="center" alignItems="center">
            <text fg={theme.textMuted.toString()}>No messages</text>
          </box>
        </Show>

        <For each={filteredMessages()}>
          {(msg, index) => {
            const isSelected = () => index() === effectiveCursor()
            
            return (
              <box
                flexDirection="row"
                gap={1}
                backgroundColor={isSelected() ? theme.backgroundElement.toString() : undefined}
                paddingLeft={1}
                paddingRight={1}
                onMouseDown={() => {
                  focusPane()
                  setCursorIndex(index())
                }}
              >
                <text fg={theme.textMuted.toString()} attributes={TextAttributes.DIM}>
                  {formatTimestamp(msg.timestamp)}
                </text>
                <text fg={getLevelColor(msg.level)}>
                  {getLevelIcon(msg.level)}
                </text>
                <Show when={msg.source}>
                  <text fg={theme.info.toString()} attributes={TextAttributes.DIM}>
                    [{msg.source}]
                  </text>
                </Show>
                <text 
                  fg={isSelected() ? theme.text.toString() : theme.textMuted.toString()} 
                  flexGrow={1}
                  wrapMode="char"
                >
                  {msg.text}
                </text>
              </box>
            )
          }}
        </For>
      </scrollbox>

      {/* Status bar */}
      <box
        height={1}
        backgroundColor={theme.backgroundElement.toString()}
        paddingLeft={1}
        paddingRight={1}
        flexDirection="row"
        justifyContent="space-between"
        flexShrink={0}
      >
        <box flexDirection="row" gap={2}>
          <text fg={theme.textMuted.toString()}>
            {filteredMessages().length}/{messages.capacity}
          </text>
          <Show when={filterSource()}>
            <text fg={theme.info.toString()}>[{filterSource()}]</text>
          </Show>
          <Show when={cursorIndex() === -1}>
            <text fg={theme.success.toString()}>[follow]</text>
          </Show>
        </box>
        <text fg={theme.textMuted.toString()}>j/k:nav g/G:top/bottom d:clear f:filter</text>
      </box>
    </box>
  )
}
