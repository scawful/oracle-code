import { createStore, produce } from "solid-js/store"
import { createMemo } from "solid-js"
import { createSimpleContext } from "./helper"
import { useKV } from "./kv"

// Simple ID generator (no external dependency)
let msgCounter = 0
function generateId(): string {
  return `msg_${Date.now().toString(36)}_${(msgCounter++).toString(36)}`
}

/**
 * Messages Context - Emacs-style *Messages* buffer
 * 
 * A ring buffer for notifications and system messages.
 * Replaces ephemeral toasts with persistent, reviewable history.
 */

export type MessageLevel = "info" | "warning" | "error" | "success"

export interface Message {
  id: string
  timestamp: number
  level: MessageLevel
  text: string
  source?: string // e.g., "cognitive", "hivemind", "analysis", "system"
}

interface MessagesState {
  messages: Message[]
  capacity: number
}

const DEFAULT_CAPACITY = 100

export const { use: useMessages, provider: MessagesProvider } = createSimpleContext({
  name: "Messages",
  init: () => {
    const kv = useKV()
    
    // Get capacity from settings, default to 100
    const getCapacity = () => {
      const stored = kv.get("tui.messages.capacity", DEFAULT_CAPACITY)
      return typeof stored === "number" ? stored : DEFAULT_CAPACITY
    }

    const [store, setStore] = createStore<MessagesState>({
      messages: [],
      capacity: getCapacity(),
    })

    /**
     * Add a message to the buffer
     */
    function add(msg: Omit<Message, "id" | "timestamp">) {
      const message: Message = {
        id: generateId(),
        timestamp: Date.now(),
        ...msg,
      }

      setStore(
        produce((draft) => {
          draft.messages.push(message)
          // Trim to capacity (ring buffer behavior)
          while (draft.messages.length > draft.capacity) {
            draft.messages.shift()
          }
        })
      )

      return message
    }

    /**
     * Add an info message
     */
    function info(text: string, source?: string) {
      return add({ level: "info", text, source })
    }

    /**
     * Add a warning message
     */
    function warning(text: string, source?: string) {
      return add({ level: "warning", text, source })
    }

    /**
     * Add an error message
     */
    function error(text: string, source?: string) {
      return add({ level: "error", text, source })
    }

    /**
     * Add a success message
     */
    function success(text: string, source?: string) {
      return add({ level: "success", text, source })
    }

    /**
     * Clear all messages
     */
    function clear() {
      setStore("messages", [])
    }

    /**
     * Set the buffer capacity
     */
    function setCapacity(capacity: number) {
      const newCapacity = Math.max(10, Math.min(1000, capacity))
      kv.set("tui.messages.capacity", newCapacity)
      setStore(
        produce((draft) => {
          draft.capacity = newCapacity
          // Trim if needed
          while (draft.messages.length > newCapacity) {
            draft.messages.shift()
          }
        })
      )
    }

    /**
     * Get messages filtered by source
     */
    function getBySource(source: string): Message[] {
      return store.messages.filter((m) => m.source === source)
    }

    /**
     * Get messages filtered by level
     */
    function getByLevel(level: MessageLevel): Message[] {
      return store.messages.filter((m) => m.level === level)
    }

    // Derived values
    const count = createMemo(() => store.messages.length)
    const hasErrors = createMemo(() => store.messages.some((m) => m.level === "error"))
    const hasWarnings = createMemo(() => store.messages.some((m) => m.level === "warning"))
    const latest = createMemo(() => store.messages[store.messages.length - 1] ?? null)

    // Unique sources for filtering
    const sources = createMemo(() => {
      const s = new Set<string>()
      for (const m of store.messages) {
        if (m.source) s.add(m.source)
      }
      return Array.from(s).sort()
    })

    return {
      ready: true,

      // State
      get messages() {
        return store.messages
      },
      get capacity() {
        return store.capacity
      },
      get count() {
        return count()
      },
      get hasErrors() {
        return hasErrors()
      },
      get hasWarnings() {
        return hasWarnings()
      },
      get latest() {
        return latest()
      },
      get sources() {
        return sources()
      },

      // Methods
      add,
      info,
      warning,
      error,
      success,
      clear,
      setCapacity,
      getBySource,
      getByLevel,
    }
  },
})
