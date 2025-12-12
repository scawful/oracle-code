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
    {
      key: "w",
      label: "+window",
      isGroup: true,
      children: [
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
        // History navigation
        { key: "TAB", label: "cycle panes", action: "window.cycle" },
        { key: "p", label: "previous pane", action: "window.previous" },
        // Resize
        { key: ">", label: "grow pane", action: "window.grow" },
        { key: "<", label: "shrink pane", action: "window.shrink" },
        // Presets
        { key: "1", label: "single pane", action: "window.preset.single" },
        { key: "2", label: "dual panes", action: "window.preset.dual" },
        { key: "3", label: "triple panes", action: "window.preset.triple" },
        { key: "4", label: "quad panes", action: "window.preset.quad" },
        // Floating
        { key: "f", label: "float/dock", action: "window.float" },
        { key: "F", label: "close float", action: "window.float.close" },
        // Subagent lanes
        { key: "s", label: "toggle subagent panes", action: "window.lanes.toggle" },
        { key: "c", label: "toggle subagent auto-close", action: "window.lanes.autoclose.toggle" },
      ],
    },
    {
      key: "b",
      label: "+buffer",
      isGroup: true,
      children: [
        { key: "c", label: "chat", action: "buffer.chat" },
        { key: "a", label: "AFS browser", action: "buffer.afs" },
        { key: "t", label: "ToM panel", action: "buffer.tom" },
        { key: "m", label: "metrics", action: "buffer.metrics" },
        { key: "g", label: "agents", action: "buffer.agents" },
        { key: "u", label: "outcomes", action: "buffer.outcomes" },
        { key: "d", label: "diff view", action: "buffer.diff" },
        { key: "o", label: "todo", action: "buffer.todo" },
        { key: "s", label: "sidebar", action: "buffer.sidebar" },
        { key: "O", label: "orchestrator", action: "buffer.orchestrator" },
      ],
    },
    {
      key: "t",
      label: "+tab",
      isGroup: true,
      children: [
        { key: "n", label: "new tab", action: "tab.new" },
        { key: "a", label: "new AFS", action: "tab.new.afs" },
        { key: "t", label: "new ToM", action: "tab.new.tom" },
        { key: "m", label: "new metrics", action: "tab.new.metrics" },
        { key: "g", label: "new agents", action: "tab.new.agents" },
        { key: "d", label: "close tab", action: "tab.close" },
        { key: "l", label: "next tab", action: "tab.next" },
        { key: "h", label: "prev tab", action: "tab.prev" },
        { key: ">", label: "move right", action: "tab.move.right" },
        { key: "<", label: "move left", action: "tab.move.left" },
        { key: "1", label: "tab 1", action: "tab.1" },
        { key: "2", label: "tab 2", action: "tab.2" },
        { key: "3", label: "tab 3", action: "tab.3" },
        { key: "4", label: "tab 4", action: "tab.4" },
        { key: "5", label: "tab 5", action: "tab.5" },
      ],
    },
    {
      key: "s",
      label: "+session",
      isGroup: true,
      children: [
        { key: "n", label: "new", keybind: "session_new" },
        { key: "l", label: "list", keybind: "session_list" },
        { key: "e", label: "export", keybind: "session_export" },
        { key: "c", label: "compact", keybind: "session_compact" },
        { key: "t", label: "timeline", keybind: "session_timeline" },
        { key: "r", label: "rename", action: "session.rename" },
        { key: "T", label: "tree", action: "session.tree" },
        { key: "h", label: "share", keybind: "session_share" },
        { key: "H", label: "unshare", keybind: "session_unshare" },
      ],
    },
    {
      key: "a",
      label: "+agent/analysis",
      isGroup: true,
      children: [
        // Agent management
        { key: "a", label: "agent list", keybind: "agent_list" },
        { key: "n", label: "next agent", keybind: "agent_cycle" },
        { key: "p", label: "prev agent", keybind: "agent_cycle_reverse" },
        { key: "s", label: "agent status", action: "agent.status" },
        // Analysis modes
        { key: "t", label: "ToM analysis", action: "analysis.tom" },
        { key: "m", label: "metrics analysis", action: "analysis.metrics" },
        { key: "e", label: "eval analysis", action: "analysis.eval" },
        { key: "c", label: "critic analysis", action: "analysis.critic" },
        { key: "E", label: "emotional analysis", action: "analysis.emotional" },
        { key: "g", label: "analysis gate", action: "analysis.gate" },
      ],
    },
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
    {
      key: "c",
      label: "+cognitive",
      isGroup: true,
      children: [
        { key: "s", label: "status", action: "cognitive.status" },
        { key: "e", label: "emotions", action: "cognitive.emotions" },
        { key: "m", label: "set mood", action: "cognitive.mood.set" },
        { key: "M", label: "mood history", action: "cognitive.mood.history" },
        { key: "k", label: "knowledge", action: "cognitive.knowledge" },
        { key: "g", label: "goals", action: "cognitive.goals" },
        { key: "S", label: "strategy", action: "cognitive.strategy" },
        { key: "r", label: "+record", isGroup: true, children: [
          { key: "f", label: "fear", action: "cognitive.record.fear" },
          { key: "s", label: "satisfaction", action: "cognitive.record.satisfaction" },
          { key: "c", label: "curiosity", action: "cognitive.record.curiosity" },
          { key: "x", label: "frustration", action: "cognitive.record.frustration" },
        ]},
        { key: "a", label: "+analysis triggers", isGroup: true, children: [
          { key: "l", label: "list triggers", action: "cognitive.triggers.list" },
          { key: "g", label: "gate mode", action: "cognitive.triggers.gate" },
          { key: "p", label: "pending", action: "cognitive.triggers.pending" },
        ]},
        { key: "h", label: "+hivemind", isGroup: true, children: [
          { key: "h", label: "dashboard", action: "hivemind.dashboard" },
          { key: "f", label: "fears", action: "hivemind.fears" },
          { key: "s", label: "satisfactions", action: "hivemind.satisfactions" },
          { key: "k", label: "knowledge", action: "hivemind.knowledge" },
          { key: "d", label: "decisions", action: "hivemind.decisions" },
          { key: "p", label: "preferences", action: "hivemind.preferences" },
          { key: "c", label: "councils", action: "hivemind.councils" },
          { key: "r", label: "refresh", action: "hivemind.refresh" },
        ]},
        { key: "o", label: "+outcomes", isGroup: true, children: [
          { key: "i", label: "toast issues", action: "outcomes.toast_chain_issues.toggle" },
          { key: "s", label: "toast success", action: "outcomes.toast_chain_success.toggle" },
          { key: "I", label: "record issues", action: "outcomes.record_chain_issues.toggle" },
          { key: "S", label: "record success", action: "outcomes.record_chain_success.toggle" },
        ]},
      ],
    },
    {
      key: "g",
      label: "+git",
      isGroup: true,
      children: [
        { key: "s", label: "status", action: "git.status" },
        { key: "d", label: "diff", action: "git.diff" },
        { key: "l", label: "log", action: "git.log" },
      ],
    },
    {
      key: "f",
      label: "+file",
      isGroup: true,
      children: [
        { key: "f", label: "find file", action: "file.find" },
        { key: "r", label: "recent", action: "file.recent" },
        { key: "s", label: "save", action: "file.save" },
      ],
    },
    {
      key: "W",
      label: "+workspace",
      isGroup: true,
      children: [
        { key: "s", label: "save workspace", keybind: "workspace_save" },
        { key: "l", label: "load workspace", keybind: "workspace_load" },
        { key: "d", label: "delete workspace", keybind: "workspace_delete" },
        { key: "r", label: "rename workspace", keybind: "workspace_rename" },
        { key: "L", label: "list workspaces", keybind: "workspace_list" },
        { key: "1", label: "workspace 1", action: "workspace.1" },
        { key: "2", label: "workspace 2", action: "workspace.2" },
        { key: "3", label: "workspace 3", action: "workspace.3" },
        { key: "4", label: "workspace 4", action: "workspace.4" },
      ],
    },
    // Direct commands (no submenu)
    { key: "p", label: "commands", keybind: "command_list" },
    { key: "T", label: "themes", keybind: "theme_list" },
    { key: "S", label: "status", keybind: "status_view" },
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
    }
  },
})
