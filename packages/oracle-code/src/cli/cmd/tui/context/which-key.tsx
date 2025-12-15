import { createStore, produce } from "solid-js/store"
import { createMemo } from "solid-js"
import { createSimpleContext } from "./helper"
import { useKeybind } from "./keybind"
import { Log } from "@/util/log"

const log = Log.create({ service: "which-key" })

/**
 * Which-Key Command System
 *
 * Spacemacs/Doom-emacs inspired hierarchical command system.
 * When leader (SPC) is pressed, shows available command groups in bottom bar.
 * Subsequent keys navigate the tree until a leaf action is executed.
 */

/**
 * A node in the command tree
 */
export interface WhichKeyNode {
  /** Single key character (e.g., "w", "b", "s") */
  key: string
  /** Display label (e.g., "+window", "split vertical") */
  label: string
  /** Optional description for help text */
  description?: string
  /** Sub-commands (branch nodes have children) */
  children?: WhichKeyNode[]
  /** Leaf action function (mutually exclusive with children) */
  action?: string // Action ID to execute
  /** Map to existing keybind from config */
  keybind?: string
  /** Whether this is a group (+prefix) */
  isGroup?: boolean
}

/**
 * State for which-key navigation
 */
interface WhichKeyState {
  /** Is which-key currently active (leader pressed) */
  active: boolean
  /** Current path through the tree (e.g., ["w"] for window commands) */
  path: string[]
  /** Last key pressed (for display) */
  lastKey: string | null
}

/**
 * Action handlers registered by components
 */
type ActionHandler = () => void
const actionHandlers = new Map<string, ActionHandler>()

/**
 * Register an action handler
 */
export function registerWhichKeyAction(id: string, handler: ActionHandler) {
  actionHandlers.set(id, handler)
  return () => actionHandlers.delete(id)
}

/**
 * Execute a registered action
 */
function executeAction(id: string): boolean {
  const handler = actionHandlers.get(id)
  if (!handler) return false
  try {
    handler()
    return true
  } catch (error) {
    log.error("which-key action failed", { id, error })
    return false
  }
}

/**
 * Default command tree structure
 * This defines the which-key hierarchy
 */
function buildCommandTree(): WhichKeyNode[] {
  return [
    // ============================================
    // WINDOW MANAGEMENT (SPC w)
    // ============================================
    {
      key: "w",
      label: "+window",
      isGroup: true,
      children: [
        { key: "w", label: "cycle windows", action: "window.other" },
        { key: "/", label: "split vertical", action: "window.split.vertical" },
        { key: "-", label: "split horizontal", action: "window.split.horizontal" },
        { key: "d", label: "close pane", action: "window.close" },
        { key: "m", label: "maximize", action: "window.maximize" },
        { key: "h", label: "focus left", action: "window.focus.left" },
        { key: "j", label: "focus down", action: "window.focus.down" },
        { key: "k", label: "focus up", action: "window.focus.up" },
        { key: "l", label: "focus right", action: "window.focus.right" },
        { key: "=", label: "balance", action: "window.balance" },
        { key: "o", label: "only (close others)", action: "window.only" },
        { key: "TAB", label: "cycle panes", action: "window.cycle" },
        { key: "p", label: "previous pane", action: "window.previous" },
        { key: ">", label: "grow pane", action: "window.grow" },
        { key: "<", label: "shrink pane", action: "window.shrink" },
        { key: "1", label: "single pane", action: "window.preset.single" },
        { key: "2", label: "dual panes", action: "window.preset.dual" },
        { key: "3", label: "triple panes", action: "window.preset.triple" },
        { key: "4", label: "quad panes", action: "window.preset.quad" },
        { key: "f", label: "float/dock", action: "window.float" },
        {
          key: "s",
          label: "+subagent",
          isGroup: true,
          children: [
            { key: "t", label: "toggle lanes", action: "window.lanes.toggle" },
            { key: "c", label: "toggle auto-close", action: "window.lanes.autoclose.toggle" },
            { key: "f", label: "close floating", action: "window.float.close" },
          ],
        },
      ],
    },

    // ============================================
    // BUFFER MANAGEMENT (SPC b)
    // ============================================
    {
      key: "b",
      label: "+buffer",
      isGroup: true,
      children: [
        { key: "b", label: "buffer list", action: "buffer.list" },
        { key: "d", label: "kill buffer", action: "buffer.kill" },
        { key: "n", label: "next buffer", action: "tab.next" },
        { key: "p", label: "prev buffer", action: "tab.prev" },
        {
          key: "v",
          label: "+view",
          isGroup: true,
          children: [
            { key: "h", label: "*home*", action: "buffer.home" },
            { key: "c", label: "chat/session", action: "buffer.chat" },
            { key: "a", label: "AFS browser", action: "buffer.afs" },
            { key: "m", label: "*Messages*", action: "buffer.messages" },
            { key: "t", label: "todo", action: "buffer.todo" },
            { key: "o", label: "outcomes", action: "buffer.outcomes" },
            { key: "g", label: "agents", action: "buffer.agents" },
            { key: "C", label: "cognitive", action: "buffer.cognitive" },
            { key: "H", label: "hivemind", action: "buffer.hivemind" },
            { key: "s", label: "state", action: "buffer.state" },
            { key: "p", label: "plan", action: "buffer.plan" },
            { key: "T", label: "ToM", action: "buffer.tom" },
            { key: "M", label: "metrics", action: "buffer.metrics" },
          ],
        },
      ],
    },

    // ============================================
    // TAB MANAGEMENT (SPC t)
    // ============================================
    {
      key: "t",
      label: "+tab",
      isGroup: true,
      children: [
        { key: "n", label: "new tab (session)", action: "tab.new" },
        { key: "h", label: "new *home*", action: "tab.new.home" },
        { key: "a", label: "new AFS", action: "tab.new.afs" },
        { key: "d", label: "close tab", action: "tab.close" },
        { key: "l", label: "next tab", action: "tab.next" },
        { key: "k", label: "prev tab", action: "tab.prev" },
        { key: "1", label: "tab 1", action: "tab.1" },
        { key: "2", label: "tab 2", action: "tab.2" },
        { key: "3", label: "tab 3", action: "tab.3" },
        { key: "4", label: "tab 4", action: "tab.4" },
        { key: "5", label: "tab 5", action: "tab.5" },
        {
          key: "m",
          label: "+move",
          isGroup: true,
          children: [
            { key: "l", label: "move right", action: "tab.move.right" },
            { key: "h", label: "move left", action: "tab.move.left" },
          ],
        },
      ],
    },

    // ============================================
    // SESSION MANAGEMENT (SPC s)
    // ============================================
    {
      key: "s",
      label: "+session",
      isGroup: true,
      children: [
        { key: "n", label: "new", keybind: "session_new" },
        { key: "l", label: "list", keybind: "session_list" },
        { key: "e", label: "export", keybind: "session_export" },
        { key: "c", label: "compact", keybind: "session_compact" },
        { key: "t", label: "tree view", action: "session.tree" },
        { key: "r", label: "rename", action: "session.rename" },
        { key: "i", label: "timeline", keybind: "session_timeline" },
        {
          key: "s",
          label: "+share",
          isGroup: true,
          children: [
            { key: "s", label: "share session", keybind: "session_share" },
            { key: "u", label: "unshare session", keybind: "session_unshare" },
          ],
        },
      ],
    },

    // ============================================
    // AGENT MANAGEMENT (SPC a)
    // ============================================
    {
      key: "a",
      label: "+agent",
      isGroup: true,
      children: [
        { key: "a", label: "agent list", keybind: "agent_list" },
        { key: "n", label: "next agent", keybind: "agent_cycle" },
        { key: "p", label: "prev agent", keybind: "agent_cycle_reverse" },
        { key: "s", label: "agent status", action: "agent.status" },
        {
          key: "r",
          label: "+run (spawn)",
          isGroup: true,
          children: [
            { key: "e", label: "@explore", action: "agent.spawn.explore" },
            { key: "c", label: "@critic", action: "agent.spawn.critic" },
            { key: "g", label: "@general", action: "agent.spawn.general" },
            { key: "t", label: "@test", action: "agent.spawn.test" },
            { key: "s", label: "@security", action: "agent.spawn.security" },
          ],
        },
      ],
    },

    // ============================================
    // MODEL MANAGEMENT (SPC m)
    // ============================================
    {
      key: "m",
      label: "+model",
      isGroup: true,
      children: [
        { key: "l", label: "list", keybind: "model_list" },
        { key: "n", label: "next", keybind: "model_cycle_recent" },
        { key: "p", label: "prev", keybind: "model_cycle_recent_reverse" },
      ],
    },

    // ============================================
    // COGNITIVE/ANALYSIS (SPC c)
    // ============================================
    {
      key: "c",
      label: "+cognitive",
      isGroup: true,
      children: [
        { key: "c", label: "cognitive view", action: "buffer.cognitive" },
        { key: "h", label: "hivemind", action: "buffer.hivemind" },
        { key: "s", label: "state", action: "buffer.state" },
        { key: "p", label: "plan", action: "buffer.plan" },
        { key: "t", label: "ToM", action: "buffer.tom" },
        {
          key: "a",
          label: "+analysis",
          isGroup: true,
          children: [
            { key: "t", label: "ToM analysis", action: "analysis.tom" },
            { key: "m", label: "metrics analysis", action: "analysis.metrics" },
            { key: "e", label: "eval analysis", action: "analysis.eval" },
            { key: "c", label: "critic analysis", action: "analysis.critic" },
            { key: "o", label: "emotional analysis", action: "analysis.emotional" },
            { key: "g", label: "analysis gate", action: "analysis.gate" },
          ],
        },
      ],
    },

    // ============================================
    // LAYOUT/WORKSPACE (SPC l) - was SPC W
    // ============================================
    {
      key: "l",
      label: "+layout",
      isGroup: true,
      children: [
        { key: "s", label: "save workspace", keybind: "workspace_save" },
        { key: "l", label: "load workspace", keybind: "workspace_load" },
        { key: "d", label: "delete workspace", keybind: "workspace_delete" },
        { key: "r", label: "rename workspace", keybind: "workspace_rename" },
        { key: "w", label: "list workspaces", keybind: "workspace_list" },
        { key: "1", label: "workspace 1", action: "workspace.1" },
        { key: "2", label: "workspace 2", action: "workspace.2" },
        { key: "3", label: "workspace 3", action: "workspace.3" },
        { key: "4", label: "workspace 4", action: "workspace.4" },
      ],
    },

    // ============================================
    // OUTCOMES/OPTIONS (SPC o)
    // ============================================
    {
      key: "o",
      label: "+outcomes",
      isGroup: true,
      children: [
        { key: "o", label: "outcomes view", action: "buffer.outcomes" },
        {
          key: "t",
          label: "+toast",
          isGroup: true,
          children: [
            { key: "i", label: "toggle issue toasts", action: "outcomes.toast_chain_issues.toggle" },
            { key: "s", label: "toggle success toasts", action: "outcomes.toast_chain_success.toggle" },
          ],
        },
        {
          key: "r",
          label: "+record",
          isGroup: true,
          children: [
            { key: "i", label: "toggle record issues", action: "outcomes.record_chain_issues.toggle" },
            { key: "s", label: "toggle record success", action: "outcomes.record_chain_success.toggle" },
          ],
        },
      ],
    },

    // ============================================
    // GO/NAVIGATION (SPC g) - quick jumps
    // ============================================
    {
      key: "g",
      label: "+go",
      isGroup: true,
      children: [
        { key: "h", label: "home", action: "buffer.home" },
        { key: "s", label: "sidebar toggle (right)", action: "sidebar.toggle.right" },
        { key: "S", label: "sidebar toggle (left)", action: "sidebar.toggle.left" },
        { key: "m", label: "metrics", action: "buffer.metrics" },
        { key: "c", label: "cognitive", action: "buffer.cognitive" },
        { key: "a", label: "agents", action: "buffer.agents" },
        { key: "t", label: "todo", action: "buffer.todo" },
        { key: "p", label: "plan", action: "buffer.plan" },
        { key: "o", label: "outcomes", action: "buffer.outcomes" },
        { key: "v", label: "status view", keybind: "status_view" },
      ],
    },

    // ============================================
    // FILES (SPC f) - file operations
    // ============================================
    {
      key: "f",
      label: "+files",
      isGroup: true,
      children: [
        { key: "f", label: "find file", action: "file.find" },
        { key: "a", label: "AFS browser", action: "buffer.afs" },
        { key: "r", label: "recent files", action: "file.recent" },
        { key: "s", label: "save", action: "file.save" },
        { key: "d", label: "diff view", action: "file.diff" },
      ],
    },

    // ============================================
    // DIRECT COMMANDS (top-level, no submenu)
    // ============================================
    { key: "p", label: "commands (M-x)", keybind: "command_list" },
    { key: "e", label: "editor", keybind: "editor_open" },
    { key: "q", label: "quit", keybind: "app_exit" },
    { key: "?", label: "help", action: "help.show" },
    { key: "SPC", label: "M-x", keybind: "command_list" },
  ]
}

/**
 * Get node at a given path in the tree
 */
function getNodeAtPath(tree: WhichKeyNode[], path: string[]): WhichKeyNode | null {
  if (path.length === 0) {
    return { key: "", label: "root", children: tree }
  }

  let current: WhichKeyNode | undefined = { key: "", label: "", children: tree }

  for (const key of path) {
    current = current.children?.find((n) => n.key === key)
    if (!current) return null
  }

  return current
}

export const { use: useWhichKey, provider: WhichKeyProvider } = createSimpleContext({
  name: "WhichKey",
  init: () => {
    const keybind = useKeybind()

    const [store, setStore] = createStore<WhichKeyState>({
      active: false,
      path: [],
      lastKey: null,
    })

    // Build command tree
    const commandTree = buildCommandTree()

    // Keybind trigger callback (set by app.tsx)
    let triggerKeybind: ((key: string) => void) | null = null

    /**
     * Activate which-key mode (called when leader is pressed)
     */
    function activate() {
      setStore("active", true)
      setStore("path", [])
      setStore("lastKey", null)
    }

    /**
     * Deactivate which-key mode
     */
    function deactivate() {
      setStore({
        active: false,
        path: [],
        lastKey: null,
      })
    }

    /**
     * Handle a key press while which-key is active
     * Returns true if key was handled
     */
    function handleKey(key: string): boolean {
      if (!store.active) return false

      // Handle escape to cancel
      if (key === "escape" || key === "esc") {
        deactivate()
        return true
      }

      // Handle backspace to go back (or cancel at root)
      if (key === "backspace") {
        if (store.path.length === 0) {
          deactivate()
          return true
        }
        setStore(
          produce((s) => {
            s.path.pop()
            s.lastKey = null
          }),
        )
        return true
      }

      // Handle space as repeat of command_list at root
      if ((key === " " || key === "space") && store.path.length === 0) {
        if (triggerKeybind) {
          triggerKeybind("command_list")
        }
        deactivate()
        return true
      }

      const currentNode = getNodeAtPath(commandTree, store.path)
      if (!currentNode?.children) {
        deactivate()
        return false
      }

      // Find matching command
      // For single-char keys: exact match required (case-sensitive)
      // For multi-char keys (TAB, SPC): case-insensitive
      const match = currentNode.children.find((n) => {
        if (n.key.length > 1) {
          return n.key.toLowerCase() === key.toLowerCase()
        }
        return n.key === key
      })
      if (!match) {
        // No match - deactivate
        deactivate()
        return false
      }

      // If it has an action, execute it
      if (match.action) {
        executeAction(match.action)
        deactivate()
        return true
      }

      // If it maps to a keybind, trigger it
      if (match.keybind) {
        if (triggerKeybind) {
          triggerKeybind(match.keybind)
        }
        deactivate()
        return true
      }

      // If it has children, navigate into it
      if (match.children) {
        setStore(
          produce((s) => {
            s.path.push(key)
            s.lastKey = key
          }),
        )
        return true
      }

      deactivate()
      return false
    }

    /**
     * Current available hints based on path
     */
    const currentHints = createMemo(() => {
      if (!store.active) return []
      const node = getNodeAtPath(commandTree, store.path)
      return node?.children ?? []
    })

    /**
     * Display string for current path
     */
    const leaderLabel = createMemo(() => {
      const label = keybind.print("leader") || "leader"
      if (label === "space" || label === " ") return "SPC"
      return label
    })

    const pathDisplay = createMemo(() => {
      const prefix = leaderLabel()
      if (store.path.length === 0) return `${prefix}-`
      return `${prefix} ${store.path.join(" ")}-`
    })

    return {
      ready: true,

      /** Is which-key currently active */
      get active() {
        return store.active
      },

      /** Current navigation path */
      get path() {
        return store.path
      },

      /** Current available hints */
      get hints() {
        return currentHints()
      },

      /** Display string for current path */
      get pathDisplay() {
        return pathDisplay()
      },

      /** Full command tree */
      get tree() {
        return commandTree
      },

      /** Activate which-key mode */
      activate,

      /** Deactivate which-key mode */
      deactivate,

      /** Handle a key press */
      handleKey,

      /** Register the keybind trigger callback */
      setKeybindTrigger(fn: (key: string) => void) {
        triggerKeybind = fn
      },

      /** Register an action handler */
      registerAction: registerWhichKeyAction,

      /** Execute an action by ID */
      executeAction,
    }
  },
})
