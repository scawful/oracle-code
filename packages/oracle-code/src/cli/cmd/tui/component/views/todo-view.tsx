import { createSignal, createMemo, createEffect, onCleanup, For, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "../../context/theme"
import { useDialog } from "../../ui/dialog"
import { useKeyboardMode } from "../../context/keyboard-mode"
import { useRenderer } from "@opentui/solid"
import { usePanes } from "../../context/panes"
import { useSDK } from "../../context/sdk"
import { useSync } from "../../context/sync"
import { Todo } from "@/session/todo"

/**
 * TodoView - Todo list with comments for Theory of Mind
 *
 * Interactive todo management with user/agent comments.
 */

export interface TodoViewProps {
  paneId: string
  isActive?: boolean
  sessionID: string
}

type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled"
type TodoPriority = "high" | "medium" | "low"

export function TodoView(props: TodoViewProps) {
  const { theme } = useTheme()
  const dialog = useDialog()
  const keyboard = useKeyboardMode()
  const renderer = useRenderer()
  const panes = usePanes()
  const sdk = useSDK()
  const sync = useSync()

  const ownerId = `todo-view:${props.paneId}`
  const isPaneActive = createMemo(() => panes.activeId === props.paneId)
  const isActive = createMemo(() => props.isActive ?? isPaneActive())

  // State - use sync context for todos (reactive)
  const todos = createMemo(() => (sync.data.todo[props.sessionID] ?? []) as Todo.Info[])
  const [cursorIndex, setCursorIndex] = createSignal(0)
  const [editMode, setEditMode] = createSignal<"content" | "comment" | null>(null)
  const [editValue, setEditValue] = createSignal("")
  const [showComments, setShowComments] = createSignal(true)

  // Loading state based on whether we have data
  const loading = createMemo(() => sync.data.todo[props.sessionID] === undefined)

  // Clamp cursor
  createEffect(() => {
    const max = Math.max(0, todos().length - 1)
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
    // Handle edit mode
    if (editMode()) {
      return handleEditModeKey(evt)
    }

    switch (evt.name) {
      case "j":
      case "down":
        setCursorIndex((i) => Math.min(i + 1, todos().length - 1))
        return true

      case "k":
      case "up":
        setCursorIndex((i) => Math.max(i - 1, 0))
        return true

      case " ":
      case "space":
        // Cycle status
        cycleStatus()
        return true

      case "s":
        // Quick status picker (cycle through)
        cycleStatus()
        return true

      case "p":
        // Cycle priority
        cyclePriority()
        return true

      case "e":
        // Edit content
        const todo = todos()[cursorIndex()]
        if (todo) {
          setEditValue(todo.content)
          setEditMode("content")
        }
        return true

      case "c":
        // Add comment
        setEditValue("")
        setEditMode("comment")
        return true

      case "d":
        // Delete todo
        deleteTodo()
        return true

      case "a":
        // Add new todo
        addTodo()
        return true

      case "r":
        // Data refreshes automatically via sync context
        return true

      case "C":
        // Toggle comments visibility
        setShowComments((v) => !v)
        return true
    }

    return false
  }

  function handleEditModeKey(evt: { name: string; ctrl?: boolean }): boolean {
    switch (evt.name) {
      case "escape":
        setEditMode(null)
        setEditValue("")
        return true

      case "return":
        if (editMode() === "content") {
          saveContent()
        } else if (editMode() === "comment") {
          saveComment()
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

  async function cycleStatus() {
    const todo = todos()[cursorIndex()]
    if (!todo) return

    const statuses: TodoStatus[] = ["pending", "in_progress", "completed", "cancelled"]
    const idx = statuses.indexOf(todo.status as TodoStatus)
    const next = statuses[(idx + 1) % statuses.length]

    const updated = todos().map((t) => (t.id === todo.id ? { ...t, status: next } : t))
    await Todo.update({ sessionID: props.sessionID, todos: updated })
  }

  async function cyclePriority() {
    const todo = todos()[cursorIndex()]
    if (!todo) return

    const priorities: TodoPriority[] = ["low", "medium", "high"]
    const idx = priorities.indexOf(todo.priority as TodoPriority)
    const next = priorities[(idx + 1) % priorities.length]

    const updated = todos().map((t) => (t.id === todo.id ? { ...t, priority: next } : t))
    await Todo.update({ sessionID: props.sessionID, todos: updated })
  }

  async function saveContent() {
    const todo = todos()[cursorIndex()]
    if (!todo) return

    const updated = todos().map((t) => (t.id === todo.id ? { ...t, content: editValue() } : t))
    await Todo.update({ sessionID: props.sessionID, todos: updated })
    setEditMode(null)
    setEditValue("")
  }

  async function saveComment() {
    const todo = todos()[cursorIndex()]
    if (!todo || !editValue().trim()) return

    const newComment: Todo.Comment = {
      text: editValue().trim(),
      author: "user",
      timestamp: Date.now(),
    }

    const updated = todos().map((t) => (t.id === todo.id ? { ...t, comments: [...(t.comments || []), newComment] } : t))
    await Todo.update({ sessionID: props.sessionID, todos: updated })
    setEditMode(null)
    setEditValue("")
  }

  async function deleteTodo() {
    const todo = todos()[cursorIndex()]
    if (!todo) return

    const updated = todos().filter((t) => t.id !== todo.id)
    await Todo.update({ sessionID: props.sessionID, todos: updated })
  }

  async function addTodo() {
    const newTodo: Todo.Info = {
      id: `todo_${Date.now().toString(36)}`,
      content: "New todo",
      status: "pending",
      priority: "medium",
      comments: [],
    }
    const updated = [...todos(), newTodo]
    await Todo.update({ sessionID: props.sessionID, todos: updated })
    setCursorIndex(updated.length - 1)
    // Enter edit mode for the new todo
    setEditValue("New todo")
    setEditMode("content")
  }

  function getStatusIcon(status: string): string {
    switch (status) {
      case "pending":
        return "○"
      case "in_progress":
        return "●"
      case "completed":
        return "✓"
      case "cancelled":
        return "✗"
      default:
        return "○"
    }
  }

  function getStatusColor(status: string): string {
    switch (status) {
      case "pending":
        return theme.textMuted.toString()
      case "in_progress":
        return theme.info.toString()
      case "completed":
        return theme.success.toString()
      case "cancelled":
        return theme.error.toString()
      default:
        return theme.textMuted.toString()
    }
  }

  function getPriorityColor(priority: string): string {
    switch (priority) {
      case "high":
        return theme.error.toString()
      case "medium":
        return theme.warning.toString()
      case "low":
        return theme.textMuted.toString()
      default:
        return theme.textMuted.toString()
    }
  }

  function formatTimestamp(ts: number): string {
    const date = new Date(ts)
    return date.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  return (
    <box flexGrow={1} flexDirection="column" overflow="hidden" onMouseDown={focusPane}>
      <scrollbox flexGrow={1} paddingLeft={1} paddingRight={1}>
        <Show when={loading()}>
          <text fg={theme.textMuted.toString()}>Loading todos...</text>
        </Show>

        <Show when={!loading() && todos().length === 0}>
          <box padding={1}>
            <text fg={theme.textMuted.toString()}>No todos. Press 'a' to add one.</text>
          </box>
        </Show>

        <Show when={!loading() && todos().length > 0}>
          <For each={todos()}>
            {(todo, index) => {
              const isSelected = () => index() === cursorIndex()
              const isEditing = () => isSelected() && editMode() === "content"
              const isAddingComment = () => isSelected() && editMode() === "comment"

              return (
                <box marginBottom={1}>
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
                    <text fg={getStatusColor(todo.status)}>{getStatusIcon(todo.status)}</text>
                    <text fg={getPriorityColor(todo.priority)} attributes={TextAttributes.DIM}>
                      [{todo.priority}]
                    </text>
                    <Show when={!isEditing()}>
                      <text
                        fg={todo.status === "completed" ? theme.textMuted.toString() : theme.text.toString()}
                        attributes={todo.status === "completed" ? TextAttributes.DIM : undefined}
                      >
                        {todo.content}
                      </text>
                    </Show>
                    <Show when={isEditing()}>
                      <text fg={theme.success.toString()}>{editValue()}</text>
                      <text fg={theme.primary.toString()}>|</text>
                    </Show>
                  </box>

                  {/* Comments */}
                  <Show when={showComments() && todo.comments && todo.comments.length > 0}>
                    <box paddingLeft={4}>
                      <For each={todo.comments}>
                        {(comment) => (
                          <box flexDirection="row" gap={1}>
                            <text fg={(comment.author === "user" ? theme.info : theme.warning).toString()}>
                              {comment.author === "user" ? "👤" : "🤖"}
                            </text>
                            <text fg={theme.textMuted.toString()} attributes={TextAttributes.DIM}>
                              [{formatTimestamp(comment.timestamp)}]
                            </text>
                            <text fg={theme.text.toString()}>{comment.text}</text>
                          </box>
                        )}
                      </For>
                    </box>
                  </Show>

                  {/* Add comment input */}
                  <Show when={isAddingComment()}>
                    <box paddingLeft={4} flexDirection="row" gap={1}>
                      <text fg={theme.info.toString()}>Add comment:</text>
                      <text fg={theme.success.toString()}>{editValue()}</text>
                      <text fg={theme.primary.toString()}>|</text>
                    </box>
                  </Show>
                </box>
              )
            }}
          </For>
        </Show>
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
          <text fg={theme.textMuted.toString()}>{todos().filter((t) => t.status !== "completed").length} pending</text>
          <Show when={editMode()}>
            <text fg={theme.warning.toString()}>[{editMode()?.toUpperCase()}]</text>
          </Show>
          <Show when={!showComments()}>
            <text fg={theme.textMuted.toString()}>[comments hidden]</text>
          </Show>
        </box>
        <text fg={theme.textMuted.toString()}>Space:status p:priority c:comment a:add d:del</text>
      </box>
    </box>
  )
}
