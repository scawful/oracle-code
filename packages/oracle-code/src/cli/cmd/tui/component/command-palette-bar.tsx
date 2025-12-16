import { For, Show, createMemo, createSignal, onMount } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useTerminalDimensions, useKeyboard } from "@opentui/solid"
import { TextAttributes, TextareaRenderable } from "@opentui/core"
import type { CommandOption } from "./dialog-command"

/**
 * Command Palette Bottom Bar Component
 *
 * Emacs helm/ivy style command palette at the bottom of the screen.
 * Features fuzzy search and keyboard navigation.
 *
 * Layout:
 * ┌────────────────────────────────────────────────────────────┐
 * │ M-x: [search query____________]                            │
 * │ → command-one  command-two  command-three  command-four   │
 * │   command-five command-six  command-seven  ...            │
 * └────────────────────────────────────────────────────────────┘
 */

interface CommandPaletteBarProps {
  options: CommandOption[]
  onSelect: (option: CommandOption) => void
  onClose: () => void
}

export function CommandPaletteBar(props: CommandPaletteBarProps) {
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()

  const [filter, setFilter] = createSignal("")
  const [selectedIndex, setSelectedIndex] = createSignal(0)
  let inputRef: TextareaRenderable

  // Curated categories for cleaner display - most commonly used first
  const PRIORITY_CATEGORIES = ["Session", "Agent", "Buffer", "System", "Provider", "Workspace", "AFS"]

  // Filter and sort options
  const filteredOptions = createMemo(() => {
    const query = filter().toLowerCase()
    const opts = props.options.filter((opt) => {
      // Skip suggested duplicates
      if (opt.value.startsWith("suggested.")) return false
      // Skip disabled commands
      if (opt.disabled) return false
      // Filter by query
      if (!query) return true
      const title = opt.title?.toLowerCase() ?? ""
      const category = opt.category?.toLowerCase() ?? ""
      const value = opt.value.toLowerCase()
      return title.includes(query) || category.includes(query) || value.includes(query)
    })

    // Sort: prioritize matches at start, then by category order
    return opts.sort((a, b) => {
      const aTitle = a.title?.toLowerCase() ?? ""
      const bTitle = b.title?.toLowerCase() ?? ""
      const aStartsWith = aTitle.startsWith(query)
      const bStartsWith = bTitle.startsWith(query)
      if (aStartsWith && !bStartsWith) return -1
      if (!aStartsWith && bStartsWith) return 1

      // Sort by category priority
      const aCatIdx = PRIORITY_CATEGORIES.indexOf(a.category ?? "")
      const bCatIdx = PRIORITY_CATEGORIES.indexOf(b.category ?? "")
      if (aCatIdx !== -1 && bCatIdx === -1) return -1
      if (aCatIdx === -1 && bCatIdx !== -1) return 1
      if (aCatIdx !== bCatIdx) return aCatIdx - bCatIdx

      return aTitle.localeCompare(bTitle)
    })
  })

  // Reset selection when filter changes
  const handleFilterChange = (value: string) => {
    setFilter(value)
    setSelectedIndex(0)
  }

  // Calculate visible options (limit to avoid huge lists)
  const MAX_VISIBLE = 24
  const visibleOptions = createMemo(() => filteredOptions().slice(0, MAX_VISIBLE))
  const hasMore = createMemo(() => filteredOptions().length > MAX_VISIBLE)

  // Calculate columns based on terminal width
  const columns = createMemo(() => {
    const avgWidth = 22
    return Math.max(1, Math.floor((dimensions().width - 4) / avgWidth))
  })

  // Group into rows
  const rows = createMemo(() => {
    const opts = visibleOptions()
    const cols = columns()
    const result: (typeof opts)[] = []
    for (let i = 0; i < opts.length; i += cols) {
      result.push(opts.slice(i, i + cols))
    }
    return result
  })

  // Bar height
  const barHeight = createMemo(() => {
    return Math.min(8, Math.max(3, rows().length + 2))
  })

  // Handle keyboard
  useKeyboard((evt) => {
    const opts = visibleOptions()

    switch (evt.name) {
      case "escape":
        props.onClose()
        evt.preventDefault()
        break

      case "return":
        if (opts[selectedIndex()]) {
          props.onSelect(opts[selectedIndex()])
        }
        evt.preventDefault()
        break

      case "tab":
      case "down":
        setSelectedIndex((i) => Math.min(i + 1, opts.length - 1))
        evt.preventDefault()
        break

      case "up":
        setSelectedIndex((i) => Math.max(i - 1, 0))
        evt.preventDefault()
        break

      case "right":
        setSelectedIndex((i) => Math.min(i + 1, opts.length - 1))
        evt.preventDefault()
        break

      case "left":
        setSelectedIndex((i) => Math.max(i - 1, 0))
        evt.preventDefault()
        break

      // Ctrl+N / Ctrl+P for navigation
      case "n":
        if (evt.ctrl) {
          setSelectedIndex((i) => Math.min(i + 1, opts.length - 1))
          evt.preventDefault()
        }
        break

      case "p":
        if (evt.ctrl) {
          setSelectedIndex((i) => Math.max(i - 1, 0))
          evt.preventDefault()
        }
        break
    }
  })

  onMount(() => {
    // Focus input on mount
    setTimeout(() => inputRef?.focus(), 0)
  })

  return (
    <box
      position="absolute"
      bottom={0}
      left={0}
      width={dimensions().width}
      height={barHeight()}
      backgroundColor={theme.backgroundPanel}
      borderColor={theme.border}
      border={["top"]}
      paddingLeft={1}
      paddingRight={1}
      flexDirection="column"
    >
      {/* Search input row */}
      <box flexDirection="row" alignItems="center" height={1}>
        <text fg={theme.accent} attributes={TextAttributes.BOLD}>
          M-x:{" "}
        </text>
        <textarea
          ref={(r) => (inputRef = r)}
          width={Math.max(20, dimensions().width - 30)}
          height={1}
          onContentChange={() => {
            const value = inputRef?.plainText ?? ""
            handleFilterChange(value)
          }}
          placeholder="Search commands..."
          textColor={theme.text}
          focusedTextColor={theme.text}
          cursorColor={theme.accent}
        />
        <text fg={theme.textMuted} marginLeft={1}>
          {filteredOptions().length} commands
        </text>
      </box>

      {/* Command grid */}
      <For each={rows()}>
        {(row, rowIdx) => (
          <box flexDirection="row" flexWrap="wrap" height={1}>
            <For each={row}>
              {(opt, colIdx) => {
                const idx = () => rowIdx() * columns() + colIdx()
                const isSelected = () => idx() === selectedIndex()
                return (
                  <CommandItem
                    option={opt}
                    isSelected={isSelected()}
                    width={Math.floor((dimensions().width - 4) / columns())}
                    onSelect={() => props.onSelect(opt)}
                  />
                )
              }}
            </For>
          </box>
        )}
      </For>

      {/* More indicator */}
      <Show when={hasMore()}>
        <box height={1}>
          <text fg={theme.textMuted}>+{filteredOptions().length - MAX_VISIBLE} more (type to filter)</text>
        </box>
      </Show>
    </box>
  )
}

function CommandItem(props: { option: CommandOption; isSelected: boolean; width: number; onSelect: () => void }) {
  const { theme } = useTheme()

  // Truncate title to fit
  const displayTitle = createMemo(() => {
    const title = props.option.title ?? ""
    const maxLen = props.width - 4
    return title.length > maxLen ? title.slice(0, maxLen - 1) + "…" : title
  })

  return (
    <box
      width={props.width}
      height={1}
      flexDirection="row"
      backgroundColor={props.isSelected ? theme.backgroundElement : undefined}
      onMouseDown={props.onSelect}
    >
      <text fg={props.isSelected ? theme.accent : theme.textMuted}>{props.isSelected ? "→" : " "}</text>
      <text
        fg={props.isSelected ? theme.text : theme.textMuted}
        attributes={props.isSelected ? TextAttributes.BOLD : undefined}
      >
        {displayTitle()}
      </text>
      <Show when={props.option.footer && props.isSelected}>
        <text fg={theme.info} marginLeft={1}>
          [{props.option.footer}]
        </text>
      </Show>
    </box>
  )
}
