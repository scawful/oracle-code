import { createSignal, createMemo, createEffect, onCleanup, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "../../context/theme"
import { useDialog } from "../../ui/dialog"
import { useKeyboardMode } from "../../context/keyboard-mode"
import { useRenderer } from "@opentui/solid"
import { usePanes } from "../../context/panes"
import { useAFS } from "../../context/afs"
import { State } from "@/state"
import { AFS } from "@/afs"

/**
 * StateView - Shared state editor with inline editing
 * 
 * Displays and allows editing of .context/scratchpad/state.md
 */

export interface StateViewProps {
  paneId: string
  isActive?: boolean
}

type Section = "facts" | "assumptions" | "decisions" | "uncertainties" | "goals" | "context"

interface FlatEntry {
  section: Section
  key: string
  value: string
  timestamp: string
  index: number
}

export function StateView(props: StateViewProps) {
  const { theme } = useTheme()
  const dialog = useDialog()
  const keyboard = useKeyboardMode()
  const renderer = useRenderer()
  const panes = usePanes()
  const afs = useAFS()

  const ownerId = `state-view:${props.paneId}`
  const isPaneActive = createMemo(() => panes.activeId === props.paneId)
  const isActive = createMemo(() => props.isActive ?? isPaneActive())

  // State data
  const [stateData, setStateData] = createStore<{ entries: State.StateEntry[]; loading: boolean }>({
    entries: [],
    loading: true,
  })
  const [cursorIndex, setCursorIndex] = createSignal(0)
  const [editMode, setEditMode] = createSignal(false)
  const [editValue, setEditValue] = createSignal("")
  const [addMode, setAddMode] = createSignal<{ step: "key" | "value" | "section"; key: string; section: Section } | null>(null)

  // Sections in order
  const sections: Section[] = ["facts", "assumptions", "decisions", "uncertainties", "goals", "context"]
  const [expandedSections, setExpandedSections] = createSignal<Record<Section, boolean>>({
    facts: true,
    assumptions: true,
    decisions: true,
    uncertainties: true,
    goals: true,
    context: true,
  })

  // Load state using afs.root from context (already resolved with correct session path)
  async function loadState() {
    const root = afs.root
    if (!root) {
      setStateData({ entries: [], loading: false })
      return
    }

    const data = await State.getData(root)
    setStateData({ 
      entries: data?.entries || [], 
      loading: false 
    })
  }

  // Reactive load: re-load when afs.root becomes available or changes
  createEffect(() => {
    const root = afs.root
    if (root) {
      loadState()
    } else if (!afs.exists) {
      setStateData({ entries: [], loading: false })
    }
  })

  // Flatten entries for navigation
  const flatEntries = createMemo(() => {
    const flat: FlatEntry[] = []
    let idx = 0
    for (const section of sections) {
      if (!expandedSections()[section]) continue
      const sectionEntries = stateData.entries.filter((e) => e.section === section)
      for (const entry of sectionEntries) {
        flat.push({
          section,
          key: entry.key,
          value: entry.value,
          timestamp: entry.timestamp,
          index: idx++,
        })
      }
    }
    return flat
  })

  // Clamp cursor
  createEffect(() => {
    const max = Math.max(0, flatEntries().length - 1)
    if (cursorIndex() > max) setCursorIndex(max)
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
    // Handle add mode input
    if (addMode()) {
      return handleAddModeKey(evt)
    }

    // Handle edit mode input
    if (editMode()) {
      return handleEditModeKey(evt)
    }

    switch (evt.name) {
      case "j":
      case "down":
        setCursorIndex((i) => Math.min(i + 1, flatEntries().length - 1))
        return true

      case "k":
      case "up":
        setCursorIndex((i) => Math.max(i - 1, 0))
        return true

      case "e":
      case "return":
        // Enter edit mode
        const entry = flatEntries()[cursorIndex()]
        if (entry) {
          setEditValue(entry.value)
          setEditMode(true)
        }
        return true

      case "a":
        // Add new entry
        setAddMode({ step: "section", key: "", section: "context" })
        return true

      case "d":
        // Delete entry
        deleteEntry()
        return true

      case "r":
        loadState()
        return true

      case "tab":
        // Cycle through sections
        const currentEntry = flatEntries()[cursorIndex()]
        if (currentEntry) {
          const sectionIdx = sections.indexOf(currentEntry.section)
          const nextSection = sections[(sectionIdx + 1) % sections.length]
          // Find first entry of next section
          const nextEntry = flatEntries().find((e) => e.section === nextSection)
          if (nextEntry) {
            setCursorIndex(nextEntry.index)
          }
        }
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

  function handleAddModeKey(evt: { name: string; ctrl?: boolean }): boolean {
    const mode = addMode()!

    switch (evt.name) {
      case "escape":
        setAddMode(null)
        return true

      case "return":
        if (mode.step === "section") {
          setAddMode({ ...mode, step: "key" })
        } else if (mode.step === "key" && mode.key.length > 0) {
          setAddMode({ ...mode, step: "value" })
          setEditValue("")
        } else if (mode.step === "value") {
          addEntry()
        }
        return true

      case "tab":
        if (mode.step === "section") {
          // Cycle section
          const idx = sections.indexOf(mode.section)
          const nextSection = sections[(idx + 1) % sections.length]
          setAddMode({ ...mode, section: nextSection })
        }
        return true

      case "backspace":
        if (mode.step === "key") {
          setAddMode({ ...mode, key: mode.key.slice(0, -1) })
        } else if (mode.step === "value") {
          setEditValue((v) => v.slice(0, -1))
        }
        return true

      default:
        if (evt.name.length === 1 && !evt.ctrl) {
          if (mode.step === "key") {
            setAddMode({ ...mode, key: mode.key + evt.name })
          } else if (mode.step === "value") {
            setEditValue((v) => v + evt.name)
          }
        }
        return true
    }
  }

  async function saveEdit() {
    const entry = flatEntries()[cursorIndex()]
    if (!entry) return

    // Use afs.root from context
    const root = afs.root
    if (!root) return

    await State.set(root, entry.key, editValue(), entry.section)
    setEditMode(false)
    setEditValue("")
    await loadState()
  }

  async function addEntry() {
    const mode = addMode()
    if (!mode || mode.step !== "value") return

    // Use afs.root from context
    const root = afs.root
    if (!root) return

    await State.set(root, mode.key, editValue(), mode.section)
    setAddMode(null)
    setEditValue("")
    await loadState()
  }

  async function deleteEntry() {
    const entry = flatEntries()[cursorIndex()]
    if (!entry) return

    // Use afs.root from context
    const root = afs.root
    if (!root) return

    await State.remove(root, entry.key)
    await loadState()
  }

  function getSectionIcon(section: Section): string {
    switch (section) {
      case "facts": return "󰄬"
      case "assumptions": return "󰌵"
      case "decisions": return "󰍎"
      case "uncertainties": return "󰋗"
      case "goals": return "󰓾"
      case "context": return "󰘦"
    }
  }

  return (
    <box flexGrow={1} flexDirection="column" overflow="hidden" onMouseDown={focusPane}>
      <scrollbox flexGrow={1} paddingLeft={1} paddingRight={1}>
        <Show when={stateData.loading}>
          <text fg={theme.textMuted}>Loading state...</text>
        </Show>

        <Show when={!stateData.loading && !afs.exists}>
          <box padding={1}>
            <text fg={theme.warning}>AFS not initialized</text>
            <text fg={theme.textMuted} marginTop={1}>
              Run 'ocode afs init' to enable shared state
            </text>
          </box>
        </Show>

        <Show when={!stateData.loading && afs.exists}>
          {/* Add mode prompt */}
          <Show when={addMode()}>
            <box backgroundColor={theme.backgroundElement} padding={1} marginBottom={1}>
              <Show when={addMode()!.step === "section"}>
                <text fg={theme.info}>Select section (Tab to cycle, Enter to confirm): </text>
                <text fg={theme.primary} attributes={TextAttributes.BOLD}>{addMode()!.section}</text>
              </Show>
              <Show when={addMode()!.step === "key"}>
                <text fg={theme.info}>Enter key: </text>
                <text fg={theme.text}>{addMode()!.key}</text>
                <text fg={theme.primary}>|</text>
              </Show>
              <Show when={addMode()!.step === "value"}>
                <text fg={theme.info}>Enter value for '{addMode()!.key}': </text>
                <text fg={theme.text}>{editValue()}</text>
                <text fg={theme.primary}>|</text>
              </Show>
            </box>
          </Show>

          <Show when={stateData.entries.length === 0 && !addMode()}>
            <text fg={theme.textMuted}>No state entries. Press 'a' to add.</text>
          </Show>

          {/* Render by section */}
          <For each={sections}>
            {(section) => {
              const sectionEntries = () => stateData.entries.filter((e) => e.section === section)
              if (sectionEntries().length === 0) return null

              return (
                <box marginBottom={1}>
                  <box flexDirection="row" gap={1} marginBottom={1}>
                    <text fg={theme.info} attributes={TextAttributes.BOLD}>
                      {getSectionIcon(section)} {section.charAt(0).toUpperCase() + section.slice(1)}
                    </text>
                    <text fg={theme.textMuted}>({sectionEntries().length})</text>
                  </box>

                  <For each={sectionEntries()}>
                    {(entry) => {
                      const flatIdx = () => flatEntries().findIndex(
                        (e) => e.key === entry.key && e.section === entry.section
                      )
                      const isSelected = () => flatIdx() === cursorIndex()
                      const isEditing = () => isSelected() && editMode()

                      return (
                        <box
                          backgroundColor={isSelected() ? theme.backgroundElement : undefined}
                          paddingLeft={2}
                          paddingRight={1}
                          onMouseDown={() => {
                            focusPane()
                            const idx = flatIdx()
                            if (idx >= 0) setCursorIndex(idx)
                          }}
                        >
                          <box flexDirection="row" gap={1}>
                            <text fg={isSelected() ? theme.primary : theme.text} attributes={TextAttributes.BOLD}>
                              {entry.key}:
                            </text>
                            <Show when={!isEditing()}>
                              <text fg={theme.text} flexGrow={1}>{entry.value}</text>
                            </Show>
                            <Show when={isEditing()}>
                              <text fg={theme.success}>{editValue()}</text>
                              <text fg={theme.primary}>|</text>
                            </Show>
                            <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
                              [{entry.timestamp}]
                            </text>
                          </box>
                        </box>
                      )
                    }}
                  </For>
                </box>
              )
            }}
          </For>
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
        <box flexDirection="row" gap={2}>
          <text fg={theme.textMuted}>{stateData.entries.length} entries</text>
          <Show when={editMode()}>
            <text fg={theme.warning}>[EDIT]</text>
          </Show>
          <Show when={addMode()}>
            <text fg={theme.info}>[ADD]</text>
          </Show>
        </box>
        <text fg={theme.textMuted}>j/k:nav a:add e:edit d:delete r:refresh</text>
      </box>
    </box>
  )
}
