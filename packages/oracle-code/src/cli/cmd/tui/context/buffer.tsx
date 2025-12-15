import { createStore, produce } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { createMemo, onMount } from "solid-js"
import { useSync } from "./sync"

/**
 * Buffer Management Context
 *
 * Implements Emacs-style buffer/window separation:
 * - Buffer: A piece of content (session, home, view, etc.)
 * - Window: A visual viewport (pane tab) that displays a buffer
 *
 * Buffers exist independently of windows. Multiple windows can show
 * the same buffer. Closing a window doesn't close the buffer.
 *
 * STATUS: FOUNDATION ONLY - Not yet fully integrated
 *
 * This context provides the data structures and operations for a full
 * buffer system, but the pane system currently uses viewType directly.
 * Future work will integrate this to enable:
 * - True buffer/window separation (same buffer in multiple windows)
 * - Buffer history and navigation (SPC b n/p)
 * - Buffer persistence independent of windows
 *
 * Current usage:
 * - BufferProvider is mounted in app.tsx
 * - Type definitions are used by dialog-buffer-list.tsx
 * - viewTypeToBufferType() maps pane view types to buffer types
 */

/**
 * Buffer types - what kind of content the buffer holds
 */
export type BufferType =
  | "home" // Fresh homepage with prompt
  | "session" // Chat session
  | "afs" // AFS browser
  | "cognitive" // Cognitive view
  | "hivemind" // Hivemind view
  | "state" // Shared state
  | "plan" // Plan view
  | "tom" // Theory of mind
  | "metrics" // Metrics
  | "agents" // Agents status
  | "outcomes" // Task outcomes
  | "todo" // Todo list
  | "messages" // Messages log

/**
 * A buffer is a piece of content that can be displayed in any window
 */
export interface Buffer {
  id: string
  type: BufferType
  label: string
  /** When the buffer was created */
  createdAt: number
  /** Last time the buffer was viewed */
  lastAccessed: number
  /** For session buffers - the session ID */
  sessionID?: string
  /** For AFS/file buffers - the path */
  path?: string
  /** Whether this is a special buffer (cannot be killed) */
  special?: boolean
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Special buffer IDs - these are always available
 */
export const SPECIAL_BUFFERS = {
  HOME: "*home*",
  MESSAGES: "*Messages*",
} as const

/**
 * Map from old PaneViewType to BufferType
 */
export function viewTypeToBufferType(viewType: string): BufferType {
  switch (viewType) {
    case "home":
      return "home"
    case "chat":
      return "session"
    case "afs":
      return "afs"
    case "cognitive":
      return "cognitive"
    case "hivemind":
      return "hivemind"
    case "state":
      return "state"
    case "plan":
      return "plan"
    case "tom":
      return "tom"
    case "metrics":
      return "metrics"
    case "agents":
      return "agents"
    case "outcomes":
      return "outcomes"
    case "todo":
      return "todo"
    case "messages":
      return "messages"
    default:
      return "session"
  }
}

/**
 * Map from BufferType to display label
 */
export function bufferTypeLabel(type: BufferType): string {
  switch (type) {
    case "home":
      return "Home"
    case "session":
      return "Session"
    case "afs":
      return "AFS Browser"
    case "cognitive":
      return "Cognitive"
    case "hivemind":
      return "Hivemind"
    case "state":
      return "Shared State"
    case "plan":
      return "Plan"
    case "tom":
      return "Theory of Mind"
    case "metrics":
      return "Metrics"
    case "agents":
      return "Agents"
    case "outcomes":
      return "Outcomes"
    case "todo":
      return "Todo"
    case "messages":
      return "Messages"
  }
}

/**
 * Get icon for buffer type
 */
export function bufferTypeIcon(type: BufferType): string {
  switch (type) {
    case "home":
      return "~"
    case "session":
      return "#"
    case "afs":
      return "/"
    case "cognitive":
      return "@"
    case "hivemind":
      return "*"
    case "state":
      return "$"
    case "plan":
      return "="
    case "tom":
      return "?"
    case "metrics":
      return "%"
    case "agents":
      return "&"
    case "outcomes":
      return "!"
    case "todo":
      return "+"
    case "messages":
      return ">"
  }
}

interface BufferStore {
  buffers: Record<string, Buffer>
  /** Ordered list of buffer IDs by last access (most recent first) */
  accessOrder: string[]
}

let bufferIdCounter = 0
function generateBufferId(): string {
  return `buf_${Date.now()}_${++bufferIdCounter}`
}

export const { use: useBuffer, provider: BufferProvider } = createSimpleContext({
  name: "Buffer",
  init: () => {
    const sync = useSync()

    const [store, setStore] = createStore<BufferStore>({
      buffers: {},
      accessOrder: [],
    })

    /**
     * Create the special buffers on mount
     */
    onMount(() => {
      // Create *home* buffer
      if (!store.buffers[SPECIAL_BUFFERS.HOME]) {
        setStore(
          produce((draft) => {
            const now = Date.now()
            draft.buffers[SPECIAL_BUFFERS.HOME] = {
              id: SPECIAL_BUFFERS.HOME,
              type: "home",
              label: "*home*",
              createdAt: now,
              lastAccessed: now,
              special: true,
            }
            draft.accessOrder.unshift(SPECIAL_BUFFERS.HOME)
          }),
        )
      }

      // Create *Messages* buffer
      if (!store.buffers[SPECIAL_BUFFERS.MESSAGES]) {
        setStore(
          produce((draft) => {
            const now = Date.now()
            draft.buffers[SPECIAL_BUFFERS.MESSAGES] = {
              id: SPECIAL_BUFFERS.MESSAGES,
              type: "messages",
              label: "*Messages*",
              createdAt: now,
              lastAccessed: now,
              special: true,
            }
            draft.accessOrder.push(SPECIAL_BUFFERS.MESSAGES)
          }),
        )
      }
    })

    /**
     * Create a new buffer
     */
    function create(type: BufferType, options?: { sessionID?: string; label?: string; path?: string }): Buffer {
      const id = generateBufferId()
      const now = Date.now()

      let label = options?.label || bufferTypeLabel(type)

      // For session buffers, try to get session title
      if (type === "session" && options?.sessionID) {
        const session = sync.session.get(options.sessionID)
        if (session?.title) {
          label = session.title
        }
      }

      const buffer: Buffer = {
        id,
        type,
        label,
        createdAt: now,
        lastAccessed: now,
        sessionID: options?.sessionID,
        path: options?.path,
      }

      setStore(
        produce((draft) => {
          draft.buffers[id] = buffer
          draft.accessOrder.unshift(id)
        }),
      )

      return buffer
    }

    /**
     * Create a home buffer (fresh homepage)
     */
    function createHome(): Buffer {
      return create("home", { label: "Home" })
    }

    /**
     * Create a session buffer
     */
    function createSession(sessionID: string): Buffer {
      // Check if we already have a buffer for this session
      const existing = Object.values(store.buffers).find((b) => b.type === "session" && b.sessionID === sessionID)
      if (existing) {
        touch(existing.id)
        return existing
      }

      return create("session", { sessionID })
    }

    /**
     * Create a view buffer (non-session content)
     */
    function createView(type: BufferType, options?: { label?: string; path?: string }): Buffer {
      return create(type, options)
    }

    /**
     * Get a buffer by ID
     */
    function get(id: string): Buffer | undefined {
      return store.buffers[id]
    }

    /**
     * Get or create a buffer for a session
     */
    function getOrCreateSession(sessionID: string): Buffer {
      const existing = Object.values(store.buffers).find((b) => b.type === "session" && b.sessionID === sessionID)
      if (existing) {
        touch(existing.id)
        return existing
      }
      return createSession(sessionID)
    }

    /**
     * Get buffer for session ID (without creating)
     */
    function getBySessionID(sessionID: string): Buffer | undefined {
      return Object.values(store.buffers).find((b) => b.type === "session" && b.sessionID === sessionID)
    }

    /**
     * List all buffers
     */
    function list(): Buffer[] {
      return store.accessOrder.map((id) => store.buffers[id]).filter(Boolean) as Buffer[]
    }

    /**
     * List buffers by type
     */
    function listByType(type: BufferType): Buffer[] {
      return list().filter((b) => b.type === type)
    }

    /**
     * Update last accessed time (moves to front of access order)
     */
    function touch(id: string): void {
      if (!store.buffers[id]) return

      setStore(
        produce((draft) => {
          draft.buffers[id].lastAccessed = Date.now()
          const idx = draft.accessOrder.indexOf(id)
          if (idx > 0) {
            draft.accessOrder.splice(idx, 1)
            draft.accessOrder.unshift(id)
          }
        }),
      )
    }

    /**
     * Update buffer label
     */
    function setLabel(id: string, label: string): void {
      if (!store.buffers[id]) return

      setStore("buffers", id, "label", label)
    }

    /**
     * Close/kill a buffer
     * Returns true if buffer was closed, false if it's special (cannot be killed)
     */
    function close(id: string): boolean {
      const buffer = store.buffers[id]
      if (!buffer) return false
      if (buffer.special) return false

      setStore(
        produce((draft) => {
          delete draft.buffers[id]
          const idx = draft.accessOrder.indexOf(id)
          if (idx >= 0) {
            draft.accessOrder.splice(idx, 1)
          }
        }),
      )

      return true
    }

    /**
     * Close session buffers when session is deleted
     */
    function closeBySessionID(sessionID: string): void {
      const buffer = getBySessionID(sessionID)
      if (buffer) {
        close(buffer.id)
      }
    }

    /**
     * Get the special home buffer
     */
    function homeBuffer(): Buffer {
      return store.buffers[SPECIAL_BUFFERS.HOME]!
    }

    /**
     * Get the special messages buffer
     */
    function messagesBuffer(): Buffer {
      return store.buffers[SPECIAL_BUFFERS.MESSAGES]!
    }

    // Derived values
    const bufferCount = createMemo(() => Object.keys(store.buffers).length)
    const sessionBuffers = createMemo(() => listByType("session"))

    return {
      // Store access
      get store() {
        return store
      },

      // Creation
      create,
      createHome,
      createSession,
      createView,

      // Retrieval
      get,
      getOrCreateSession,
      getBySessionID,
      list,
      listByType,

      // Modification
      touch,
      setLabel,
      close,
      closeBySessionID,

      // Special buffers
      homeBuffer,
      messagesBuffer,

      // Derived
      get count() {
        return bufferCount()
      },
      get sessionBuffers() {
        return sessionBuffers()
      },

      // Ready flag
      ready: true,
    }
  },
})
