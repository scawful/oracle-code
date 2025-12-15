import { createSignal, createMemo, createEffect, onCleanup, For, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "../../context/theme"
import { useDialog } from "../../ui/dialog"
import { useKeyboardMode } from "../../context/keyboard-mode"
import { useRenderer } from "@opentui/solid"
import { usePanes } from "../../context/panes"
import { useAFS } from "../../context/afs"
import { AFS } from "@/afs"

/**
 * PlanView - Org-mode style plan editor
 * 
 * Displays and allows editing of .context/scratchpad/plan.md
 * Features:
 * - Markdown rendering with syntax highlighting
 * - Heading folding (org-style with Tab)
 * - Checkbox toggling [ ] -> [x]
 * - Edit mode with cursor
 * - Append with timestamp
 */

export interface PlanViewProps {
  paneId: string
  isActive?: boolean
}

interface ParsedLine {
  index: number
  text: string
  type: "heading" | "checkbox" | "list" | "separator" | "text" | "code" | "code-block-start" | "code-block-end"
  level?: number // heading level (1-6) or list indent
  checked?: boolean
  foldable?: boolean
  folded?: boolean
  parentHeading?: number // index of parent heading for folding
}

export function PlanView(props: PlanViewProps) {
  const { theme } = useTheme()
  const color = (c: any) => (typeof c === "string" ? c : c?.toString?.() ?? String(c))
  const dialog = useDialog()
  const keyboard = useKeyboardMode()
  const renderer = useRenderer()
  const panes = usePanes()
  const afs = useAFS()

  const ownerId = `plan-view:${props.paneId}`
  const isPaneActive = createMemo(() => panes.activeId === props.paneId)
  const isActive = createMemo(() => props.isActive ?? isPaneActive())

  // Plan state
  const [rawContent, setRawContent] = createSignal<string>("")
  const [loading, setLoading] = createSignal(true)
  const [cursorIndex, setCursorIndex] = createSignal(0)
  const [editMode, setEditMode] = createSignal(false)
  const [editValue, setEditValue] = createSignal("")
  const [appendMode, setAppendMode] = createSignal(false)
  const [showMarkdown, setShowMarkdown] = createSignal(true)
  const [foldedHeadings, setFoldedHeadings] = createSignal<Set<number>>(new Set())
  const [scrollOffset, setScrollOffset] = createSignal(0)

  // Load plan using the root from AFS context (which already has correct path resolution)
  async function loadPlan() {
    setLoading(true)
    // Use afs.root from context - it's already resolved with correct session path
    const root = afs.root
    if (!root) {
      setRawContent("")
      setLoading(false)
      return
    }

    const content = await AFS.readPlan(root)
    setRawContent(content || "")
    setLoading(false)
  }

  // Reactive load: re-load when afs.root becomes available or changes
  // This handles the case where AFS context loads after this view mounts
  createEffect(() => {
    // Track afs.root reactively - when it changes from null to a value, reload
    const root = afs.root
    if (root) {
      loadPlan()
    } else if (!afs.exists) {
      // AFS not initialized - clear content and stop loading
      setRawContent("")
      setLoading(false)
    }
  })

  // Parse lines into structured format
  const parsedLines = createMemo((): ParsedLine[] => {
    const lines = rawContent().split("\n")
    const parsed: ParsedLine[] = []
    let currentHeading: number | undefined = undefined
    let inCodeBlock = false

    for (let i = 0; i < lines.length; i++) {
      const text = lines[i]
      let type: ParsedLine["type"] = "text"
      let level: number | undefined
      let checked: boolean | undefined
      let foldable = false

      // Code block detection
      if (text.trimStart().startsWith("```")) {
        if (inCodeBlock) {
          type = "code-block-end"
          inCodeBlock = false
        } else {
          type = "code-block-start"
          inCodeBlock = true
        }
      } else if (inCodeBlock) {
        type = "code"
      } else if (text.match(/^#{1,6}\s/)) {
        // Heading
        type = "heading"
        level = text.match(/^(#{1,6})/)?.[1].length
        foldable = true
        currentHeading = i
      } else if (text.match(/^\s*[-*+]\s*\[([ xX])\]/)) {
        // Checkbox
        type = "checkbox"
        checked = text.match(/\[([ xX])\]/)?.[1].toLowerCase() === "x"
        level = text.search(/\S/)
      } else if (text.match(/^\s*[-*+]\s/)) {
        // List item
        type = "list"
        level = text.search(/\S/)
      } else if (text.match(/^---+$/) || text.match(/^\*\*\*+$/) || text.match(/^___+$/)) {
        // Separator
        type = "separator"
      }

      parsed.push({
        index: i,
        text,
        type,
        level,
        checked,
        foldable,
        folded: false,
        parentHeading: type !== "heading" ? currentHeading : undefined,
      })
    }

    return parsed
  })

  // Visible lines (after folding)
  const visibleLines = createMemo(() => {
    const folded = foldedHeadings()
    const lines = parsedLines()
    const visible: ParsedLine[] = []
    let skipUntilLevel: number | undefined = undefined

    for (const line of lines) {
      if (skipUntilLevel !== undefined) {
        // Skip until we find a heading of same or higher level
        if (line.type === "heading" && line.level !== undefined && line.level <= skipUntilLevel) {
          skipUntilLevel = undefined
        } else {
          continue
        }
      }

      visible.push({
        ...line,
        folded: line.type === "heading" && folded.has(line.index),
      })

      // Start skipping if this is a folded heading
      if (line.type === "heading" && folded.has(line.index)) {
        skipUntilLevel = line.level
      }
    }

    return visible
  })

  // Clamp cursor
  createEffect(() => {
    const max = Math.max(0, visibleLines().length - 1)
    if (cursorIndex() > max) setCursorIndex(max)
  })

  function focusPane() {
    panes.setActive(props.paneId)
    setTimeout(() => renderer.currentFocusedRenderable?.blur(), 0)
  }

  // Toggle heading fold
  function toggleFold(lineIndex: number) {
    const line = visibleLines()[cursorIndex()]
    if (!line || line.type !== "heading") return

    setFoldedHeadings((prev) => {
      const next = new Set(prev)
      if (next.has(line.index)) {
        next.delete(line.index)
      } else {
        next.add(line.index)
      }
      return next
    })
  }

  // Toggle checkbox
  async function toggleCheckbox() {
    const visible = visibleLines()
    const line = visible[cursorIndex()]
    if (!line || line.type !== "checkbox") return

    const lines = rawContent().split("\n")
    const originalLine = lines[line.index]

    // Toggle the checkbox
    const newLine = originalLine.replace(/\[([ xX])\]/, (match, state) => {
      return state === " " ? "[x]" : "[ ]"
    })

    lines[line.index] = newLine
    const newContent = lines.join("\n")

    // Save using afs.root from context
    const root = afs.root
    if (root) {
      const planPath = AFS.getPlanPath(root)
      await Bun.write(planPath, newContent)
      setRawContent(newContent)
    }
  }

  // Save edit
  async function saveEdit() {
    const visible = visibleLines()
    const line = visible[cursorIndex()]
    if (!line) return

    const lines = rawContent().split("\n")
    lines[line.index] = editValue()
    const newContent = lines.join("\n")

    // Save using afs.root from context
    const root = afs.root
    if (root) {
      const planPath = AFS.getPlanPath(root)
      await Bun.write(planPath, newContent)
      setRawContent(newContent)
    }

    setEditMode(false)
    setEditValue("")
  }

  // Append new content
  async function appendContent() {
    if (!editValue().trim()) {
      setAppendMode(false)
      setEditValue("")
      return
    }

    // Use afs.root from context
    const root = afs.root
    if (!root) return

    const planPath = AFS.getPlanPath(root)
    const timestamp = new Date().toISOString().split("T")[0]
    const separator = rawContent() ? `\n\n---\n_Updated: ${timestamp}_\n\n` : ""
    const newContent = rawContent() + separator + editValue()

    await Bun.write(planPath, newContent)
    setRawContent(newContent)
    setAppendMode(false)
    setEditValue("")
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
    // Handle append mode input
    if (appendMode()) {
      return handleAppendModeKey(evt)
    }

    // Handle edit mode input
    if (editMode()) {
      return handleEditModeKey(evt)
    }

    switch (evt.name) {
      case "j":
      case "down":
        setCursorIndex((i) => Math.min(i + 1, visibleLines().length - 1))
        return true

      case "k":
      case "up":
        setCursorIndex((i) => Math.max(i - 1, 0))
        return true

      case "g":
        if (evt.shift) {
          // G - go to end
          setCursorIndex(visibleLines().length - 1)
        } else {
          // g - go to start
          setCursorIndex(0)
        }
        return true

      case "G":
        setCursorIndex(visibleLines().length - 1)
        return true

      case "tab":
        // Toggle fold on heading
        toggleFold(cursorIndex())
        return true

      case "space":
      case " ":
        // Toggle checkbox
        toggleCheckbox()
        return true

      case "e":
        // Enter edit mode
        const line = visibleLines()[cursorIndex()]
        if (line) {
          setEditValue(line.text)
          setEditMode(true)
        }
        return true

      case "a":
        // Append mode
        setAppendMode(true)
        setEditValue("")
        return true

      case "m":
        // Toggle markdown rendering
        setShowMarkdown((v) => !v)
        return true

      case "r":
        loadPlan()
        return true

      case "o":
        // Open all folds
        setFoldedHeadings(new Set<number>())
        return true

      case "c":
        // Close all folds (fold all headings)
        const headings = parsedLines()
          .filter((l) => l.type === "heading")
          .map((l) => l.index)
        setFoldedHeadings(new Set<number>(headings))
        return true
    }

    return false
  }

  function handleEditModeKey(evt: { name: string; ctrl?: boolean }): boolean {
    switch (evt.name) {
      case "escape":
        setEditMode(false)
        setEditValue("")
        return true

      case "return":
        saveEdit()
        return true

      case "backspace":
        setEditValue((v) => v.slice(0, -1))
        return true

      default:
        if (evt.name.length === 1 && !evt.ctrl) {
          setEditValue((v) => v + evt.name)
        }
        return true
    }
  }

  function handleAppendModeKey(evt: { name: string; ctrl?: boolean }): boolean {
    switch (evt.name) {
      case "escape":
        setAppendMode(false)
        setEditValue("")
        return true

      case "return":
        if (evt.ctrl) {
          // Ctrl+Enter to save
          appendContent()
        } else {
          // Regular enter adds newline
          setEditValue((v) => v + "\n")
        }
        return true

      case "backspace":
        setEditValue((v) => v.slice(0, -1))
        return true

      default:
        if (evt.name.length === 1 && !evt.ctrl) {
          setEditValue((v) => v + evt.name)
        }
        return true
    }
  }

  return (
    <box flexGrow={1} flexDirection="column" overflow="hidden" onMouseDown={focusPane}>
      <scrollbox flexGrow={1} paddingLeft={1} paddingRight={1}>
        <Show when={loading()}>
          <text fg={color(theme.textMuted)}>Loading plan...</text>
        </Show>

        <Show when={!loading() && !afs.exists}>
          <box padding={1}>
            <text fg={color(theme.warning)}>AFS not initialized</text>
            <text fg={color(theme.textMuted)} marginTop={1}>
              Run 'ocode afs init' to enable plan management
            </text>
          </box>
        </Show>

        <Show when={!loading() && afs.exists}>
          {/* Append mode prompt */}
          <Show when={appendMode()}>
            <box backgroundColor={color(theme.backgroundElement)} padding={1} marginBottom={1}>
              <text fg={color(theme.info)}>Append to plan (Ctrl+Enter to save, Esc to cancel):</text>
              <box marginTop={1}>
                <text fg={color(theme.text)}>{editValue()}</text>
                <text fg={color(theme.primary)}>|</text>
              </box>
            </box>
          </Show>

          <Show when={!rawContent() && !appendMode()}>
            <box padding={1}>
              <text fg={color(theme.textMuted)}>No plan yet. Press 'a' to start writing.</text>
            </box>
          </Show>

          <Show when={rawContent()}>
            <For each={visibleLines()}>
              {(line, idx) => {
                const isSelected = () => idx() === cursorIndex()
                const isEditing = () => isSelected() && editMode()

                return (
                  <box
                    backgroundColor={isSelected() ? color(theme.backgroundElement) : undefined}
                    paddingLeft={1}
                    paddingRight={1}
                    minHeight={1}
                    onMouseDown={() => {
                      focusPane()
                      setCursorIndex(idx())
                    }}
                  >
                    <box flexDirection="row" gap={1}>
                      {/* Line number */}
                      <text fg={color(theme.textMuted)} attributes={TextAttributes.DIM} width={4}>
                        {String(line.index + 1).padStart(3, " ")}
                      </text>
                      {/* Content - inline rendering for proper SolidJS reactivity */}
                      <PlanLineContent 
                        line={line} 
                        isSelected={isSelected()} 
                        isEditing={isEditing()} 
                        editValue={editValue()}
                        showMarkdown={showMarkdown()}
                        theme={theme}
                      />
                    </box>
                  </box>
                )
              }}
            </For>
          </Show>
        </Show>
      </scrollbox>

      {/* Status bar */}
      <box
        height={1}
        backgroundColor={color(theme.backgroundElement)}
        paddingLeft={1}
        paddingRight={1}
        flexDirection="row"
        justifyContent="space-between"
        flexShrink={0}
      >
        <box flexDirection="row" gap={2}>
          <text fg={color(theme.textMuted)}>
            {parsedLines().length} lines
          </text>
          <Show when={foldedHeadings().size > 0}>
            <text fg={color(theme.info)}>{foldedHeadings().size} folded</text>
          </Show>
          <Show when={editMode()}>
            <text fg={color(theme.warning)}>[EDIT]</text>
          </Show>
          <Show when={appendMode()}>
            <text fg={color(theme.info)}>[APPEND]</text>
          </Show>
          <Show when={!showMarkdown()}>
            <text fg={color(theme.textMuted)}>[RAW]</text>
          </Show>
        </box>
        <text fg={color(theme.textMuted)}>j/k:nav Tab:fold Space:check e:edit a:append m:md r:refresh</text>
      </box>
    </box>
  )
}

/**
 * PlanLineContent - Renders a single line with syntax highlighting
 * 
 * Extracted as a component for proper SolidJS reactivity
 */
function PlanLineContent(props: {
  line: ParsedLine
  isSelected: boolean
  isEditing: boolean
  editValue: string
  showMarkdown: boolean
  theme: any
}) {
  const color = (c: any) => (typeof c === "string" ? c : c?.toString?.() ?? String(c))
  // Edit mode - show edit input
  if (props.isEditing) {
    return (
      <box flexDirection="row">
        <text fg={color(props.theme.success)}>{props.editValue}</text>
        <text fg={color(props.theme.primary)}>|</text>
      </box>
    )
  }

  // Raw mode - just show text
  if (!props.showMarkdown) {
    return <text fg={props.isSelected ? color(props.theme.text) : color(props.theme.textMuted)}>{props.line.text}</text>
  }

  const text = props.line.text
  const line = props.line
  const theme = props.theme

  // Render based on line type
  switch (line.type) {
    case "heading": {
      const prefix = "#".repeat(line.level || 1)
      const content = text.replace(/^#{1,6}\s*/, "")
      const foldIndicator = line.folded ? "▶" : line.foldable ? "▼" : ""
      return (
        <box flexDirection="row" gap={1}>
          <text fg={color(theme.info)} attributes={TextAttributes.DIM}>
            {foldIndicator}
          </text>
          <text fg={color(theme.primary)} attributes={TextAttributes.BOLD}>
            {prefix}
          </text>
          <text fg={color(theme.text)} attributes={TextAttributes.BOLD}>
            {content}
          </text>
        </box>
      )
    }

    case "checkbox": {
      const indent = " ".repeat(line.level || 0)
      const bulletMatch = text.match(/^\s*([-*+])\s*\[/)
      const bullet = bulletMatch ? bulletMatch[1] : "-"
      const content = text.replace(/^\s*[-*+]\s*\[([ xX])\]\s*/, "")
      return (
        <box flexDirection="row">
          <text fg={color(theme.textMuted)}>{indent}{bullet} </text>
          <text fg={line.checked ? color(theme.success) : color(theme.warning)}>
            [{line.checked ? "x" : " "}]
          </text>
          <text fg={line.checked ? color(theme.textMuted) : color(theme.text)} attributes={line.checked ? TextAttributes.DIM : undefined}>
            {" "}{content}
          </text>
        </box>
      )
    }

    case "list": {
      const indent = " ".repeat(line.level || 0)
      const content = text.replace(/^\s*[-*+]\s*/, "")
      return (
        <box flexDirection="row">
          <text fg={color(theme.info)}>{indent}• </text>
          <text fg={color(theme.text)}>{content}</text>
        </box>
      )
    }

    case "separator":
      return <text fg={color(theme.textMuted)}>{"─".repeat(40)}</text>

    case "code":
      return (
        <box backgroundColor={color(theme.backgroundElement)}>
          <text fg={color(theme.warning)}>{text}</text>
        </box>
      )

    case "code-block-start":
    case "code-block-end":
      return <text fg={color(theme.info)} attributes={TextAttributes.DIM}>{text}</text>

    default: {
      // Handle inline formatting for regular text
      if (text.match(/\*\*.+\*\*/)) {
        // Bold
        return <text fg={color(theme.text)} attributes={TextAttributes.BOLD}>{text.replace(/\*\*/g, "")}</text>
      }
      if (text.match(/_.+_/) || text.match(/\*.+\*/)) {
        // Italic (rendered as dim)
        return <text fg={color(theme.text)} attributes={TextAttributes.DIM}>{text.replace(/[_*]/g, "")}</text>
      }
      if (text.match(/`.+`/)) {
        // Inline code
        return <text fg={color(theme.warning)}>{text}</text>
      }
      return <text fg={props.isSelected ? color(theme.text) : color(theme.textMuted)}>{text}</text>
    }
  }
}
