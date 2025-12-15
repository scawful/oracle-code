import { createStore, produce, unwrap } from "solid-js/store"
import { createMemo, onMount, createEffect } from "solid-js"
import { createSimpleContext } from "./helper"
import { registerWhichKeyAction } from "./which-key"
import { Storage } from "@/storage/storage"
import { Log } from "@/util/log"

const log = Log.create({ service: "panes" })

/**
 * Pane Management System
 *
 * Provides window splitting and management similar to vim/emacs/tmux.
 * Supports arbitrary splits (horizontal/vertical) with a tree structure.
 *
 * Commands:
 * - SPC w / : Split vertical (side-by-side)
 * - SPC w - : Split horizontal (top-bottom)
 * - SPC w d : Close current pane
 * - SPC w m : Maximize/restore current pane
 * - SPC w h/j/k/l : Focus pane in direction
 * - SPC w = : Balance all pane sizes
 */

/**
 * Direction of split
 */
export type SplitDirection = "horizontal" | "vertical"

/**
 * View types that can be displayed in a pane
 */
export type PaneViewType =
  | "home" // Fresh homepage with prompt (new session start)
  | "chat" // Main agent session chat
  | "afs" // AFS Browser (context explorer)
  | "tom" // Theory of Mind panel
  | "metrics" // Metrics panel
  | "agents" // Agent overview
  | "outcomes" // Tracked outcomes / heuristic issues
  | "todo" // Todo list
  | "messages" // Messages buffer (*Messages* like Emacs)
  | "cognitive" // Cognitive state dashboard
  | "hivemind" // Hivemind cross-session learning
  | "knowledge" // Unified knowledge view (hivemind + ToM + epistemic)
  | "state" // Shared state editor
  | "plan" // Plan.md editor

/**
 * A single tab within a pane
 */
export interface PaneTab {
  id: string
  viewType: PaneViewType
  label?: string // Custom label override
  sessionID?: string // For chat tabs - which session to show
  metadata?: Record<string, any> // Extra data for the view
}

/**
 * A leaf pane containing one or more tabs
 */
export interface PaneLeaf {
  type: "leaf"
  id: string
  /** Array of tabs in this pane */
  tabs: PaneTab[]
  /** Index of the currently active tab */
  activeTabIndex: number
  // Legacy fields for backwards compatibility during migration
  viewType?: PaneViewType
  sessionID?: string
  metadata?: Record<string, any>
}

/**
 * Helper to get the active tab from a pane
 */
export function getActiveTab(pane: PaneLeaf): PaneTab {
  // Handle legacy panes without tabs array
  if (!pane.tabs || pane.tabs.length === 0) {
    return {
      id: pane.id + "-tab-0",
      viewType: pane.viewType || "chat",
      sessionID: pane.sessionID,
      metadata: pane.metadata,
    }
  }
  return pane.tabs[pane.activeTabIndex] || pane.tabs[0]
}

/**
 * Migrate a legacy pane to the new tab structure
 */
function migratePaneToTabs(pane: PaneLeaf): PaneLeaf {
  const raw = unwrap(pane) as PaneLeaf
  if (raw.tabs && raw.tabs.length > 0) {
    return {
      ...raw,
      tabs: raw.tabs.map((t) => ({ ...t })),
    }
  }
  return {
    type: "leaf",
    id: raw.id,
    tabs: [
      {
        id: raw.id + "-tab-0",
        viewType: raw.viewType || "chat",
        sessionID: raw.sessionID,
        metadata: raw.metadata,
      },
    ],
    activeTabIndex: 0,
  }
}

/**
 * A split container with two children
 */
export interface PaneSplit {
  type: "split"
  id: string
  direction: SplitDirection
  ratio: number // 0-1, position of the split
  first: PaneNode
  second: PaneNode
}

/**
 * A node in the pane tree
 */
export type PaneNode = PaneLeaf | PaneSplit

/**
 * A floating pane with position and size
 */
export interface FloatingPane {
  pane: PaneLeaf
  /** Position from top-left as percentage (0-1) */
  x: number
  y: number
  /** Size as percentage of screen (0-1) */
  width: number
  height: number
  /** Z-order for stacking */
  zIndex: number
}

/**
 * A saved workspace configuration
 */
export interface Workspace {
  name: string
  description?: string
  root: PaneNode
  floating: FloatingPane[]
  leftSidebar: SidebarConfig
  rightSidebar: SidebarConfig
  history: string[]
  maximized: string | null
  createdAt: number
  updatedAt: number
}

/**
 * Sidebar view types (subset of PaneViewType appropriate for sidebars)
 */
export type SidebarViewType =
  | "summary" // Default: session summary with compact panels
  | "cognitive"
  | "agents"
  | "afs"
  | "state"
  | "hivemind"
  | "metrics"
  | "tom"

/**
 * Configuration for a sidebar
 */
export interface SidebarConfig {
  visible: boolean
  width: number // chars, 30-60 range
  viewType: SidebarViewType
}

/**
 * State for the pane system
 */
interface PanesState {
  root: PaneNode
  activeId: string // Currently focused pane ID
  maximized: string | null // Pane ID if maximized, null otherwise
  history: string[] // Navigation history for panes
  floating: FloatingPane[] // Floating panes (rendered as overlays)
  nextZIndex: number // For stacking order
  workspaces: Workspace[] // Named workspace configurations
  currentWorkspace: string | null // Name of the currently loaded workspace
  // Sidebar state (separate from pane tree)
  leftSidebar: SidebarConfig
  rightSidebar: SidebarConfig
}

/**
 * Bounds for a pane (for navigation calculations)
 */
interface PaneBounds {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Leaf with calculated bounds
 */
interface LeafWithBounds {
  pane: PaneLeaf
  bounds: PaneBounds
}

/**
 * Find a pane by ID in the tree
 */
function findPane(node: PaneNode, id: string): PaneNode | null {
  const stack: PaneNode[] = [node]
  const visited = new Set<string>()

  while (stack.length) {
    const current = stack.pop()
    if (!current) continue

    if (visited.has(current.id)) continue
    visited.add(current.id)

    if (current.id === id) return current
    if (current.type === "split") {
      // Search "first" before "second" for stable behavior
      stack.push(current.second)
      stack.push(current.first)
    }
  }

  return null
}

/**
 * Find a pane's parent split
 */
function findParent(root: PaneNode, targetId: string): PaneSplit | null {
  if (root.type === "leaf") return null

  const stack: PaneNode[] = [root]
  const visited = new Set<string>()

  while (stack.length) {
    const current = stack.pop()
    if (!current) continue

    if (visited.has(current.id)) continue
    visited.add(current.id)

    if (current.type !== "split") continue

    if (current.first.id === targetId || current.second.id === targetId) {
      return current
    }

    stack.push(current.second)
    stack.push(current.first)
  }

  return null
}

/**
 * Get the sibling of a pane in a split
 */
function getSibling(parent: PaneSplit, childId: string): PaneNode {
  return parent.first.id === childId ? parent.second : parent.first
}

/**
 * Replace a pane in the tree with a new node
 */
function replacePaneInTree(root: PaneNode, targetId: string, replacement: PaneNode): PaneNode {
  if (root.id === targetId) {
    return replacement
  }

  if (root.type === "split") {
    return {
      ...root,
      first: replacePaneInTree(root.first, targetId, replacement),
      second: replacePaneInTree(root.second, targetId, replacement),
    }
  }

  return root
}

/**
 * Collect all leaf panes with their calculated bounds
 */
function collectLeavesWithBounds(node: PaneNode, bounds: PaneBounds = { x: 0, y: 0, w: 1, h: 1 }): LeafWithBounds[] {
  if (node.type === "leaf") {
    return [{ pane: node, bounds }]
  }

  const isVertical = node.direction === "vertical"
  const ratio = node.ratio

  let firstBounds: PaneBounds
  let secondBounds: PaneBounds

  if (isVertical) {
    firstBounds = { x: bounds.x, y: bounds.y, w: bounds.w * ratio, h: bounds.h }
    secondBounds = { x: bounds.x + bounds.w * ratio, y: bounds.y, w: bounds.w * (1 - ratio), h: bounds.h }
  } else {
    firstBounds = { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h * ratio }
    secondBounds = { x: bounds.x, y: bounds.y + bounds.h * ratio, w: bounds.w, h: bounds.h * (1 - ratio) }
  }

  return [...collectLeavesWithBounds(node.first, firstBounds), ...collectLeavesWithBounds(node.second, secondBounds)]
}

/**
 * Find the first leaf pane in a tree (for fallback navigation)
 */
function findFirstLeaf(node: PaneNode): PaneLeaf {
  if (node.type === "leaf") return node
  return findFirstLeaf(node.first)
}

/**
 * Find pane in a specific direction from current pane
 */
function findPaneInDirection(
  root: PaneNode,
  fromId: string,
  direction: "left" | "right" | "up" | "down",
): PaneLeaf | null {
  const leaves = collectLeavesWithBounds(root)
  const current = leaves.find((l) => l.pane.id === fromId)
  if (!current) return null

  // Filter candidates in the requested direction
  const candidates = leaves.filter((l) => {
    if (l.pane.id === fromId) return false
    const cb = l.bounds
    const curr = current.bounds

    switch (direction) {
      case "left":
        return cb.x + cb.w <= curr.x + 0.01 // Small epsilon for floating point
      case "right":
        return cb.x >= curr.x + curr.w - 0.01
      case "up":
        return cb.y + cb.h <= curr.y + 0.01
      case "down":
        return cb.y >= curr.y + curr.h - 0.01
    }
  })

  if (candidates.length === 0) return null

  // Find the closest candidate (by center distance)
  const currCenterX = current.bounds.x + current.bounds.w / 2
  const currCenterY = current.bounds.y + current.bounds.h / 2

  return candidates.reduce((best, curr) => {
    const bestCenterX = best.bounds.x + best.bounds.w / 2
    const bestCenterY = best.bounds.y + best.bounds.h / 2
    const currCenterXCand = curr.bounds.x + curr.bounds.w / 2
    const currCenterYCand = curr.bounds.y + curr.bounds.h / 2

    // Use distance in the perpendicular direction as tiebreaker
    const bestDist =
      direction === "left" || direction === "right"
        ? Math.abs(bestCenterY - currCenterY)
        : Math.abs(bestCenterX - currCenterX)
    const currDist =
      direction === "left" || direction === "right"
        ? Math.abs(currCenterYCand - currCenterY)
        : Math.abs(currCenterXCand - currCenterX)

    return currDist < bestDist ? curr : best
  }).pane
}

/**
 * Balance ratios in the tree (make all splits 50/50)
 */
function balanceRatios(node: PaneNode): PaneNode {
  if (node.type === "leaf") return node

  return {
    ...node,
    ratio: 0.5,
    first: balanceRatios(node.first),
    second: balanceRatios(node.second),
  }
}

/**
 * Serializable layout format for persistence
 */
interface SerializedLayout {
  version: 1 | 2
  root: PaneNode
  activeId: string
  // Added in v2
  floating?: FloatingPane[]
  history?: string[]
  maximized?: string | null
  leftSidebar?: SidebarConfig
  rightSidebar?: SidebarConfig
}

/**
 * Serialize the current pane layout for storage
 */
function serializeLayout(state: PanesState): SerializedLayout {
  return {
    version: 2,
    root: state.root,
    activeId: state.activeId,
    floating: state.floating,
    history: state.history,
    maximized: state.maximized,
    leftSidebar: state.leftSidebar,
    rightSidebar: state.rightSidebar,
  }
}

/**
 * Generate a short, stable pane/tab id.
 * Uses WebCrypto when available, falls back to Math.random.
 */
function generateId(): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) return uuid.slice(0, 8)
  return Math.random().toString(16).slice(2, 10)
}

/**
 * Validate a deserialized layout
 */
function isValidLayout(layout: unknown): layout is SerializedLayout {
  if (!layout || typeof layout !== "object") return false
  const l = layout as any
  if (l.version !== 1 && l.version !== 2) return false
  if (!l.root || typeof l.root !== "object") return false
  if (typeof l.activeId !== "string") return false
  return true
}

/**
 * Load pane layout from storage
 */
async function loadLayoutFromStorage(sessionID: string): Promise<SerializedLayout | null> {
  try {
    const layout = await Storage.read<SerializedLayout>(["pane_layout", sessionID])
    if (isValidLayout(layout)) {
      log.info("loaded pane layout", { sessionID })
      return layout
    }
    return null
  } catch (e) {
    // No saved layout, that's fine
    return null
  }
}

/**
 * Save pane layout to storage
 */
async function saveLayoutToStorage(sessionID: string, state: PanesState): Promise<void> {
  try {
    const layout = serializeLayout(state)
    await Storage.write(["pane_layout", sessionID], layout)
    log.info("saved pane layout", { sessionID })
  } catch (e) {
    log.error("failed to save pane layout", { sessionID, error: e })
  }
}

/**
 * Create a leaf pane with tabs structure
 */
function createPaneLeaf(id: string, viewType: PaneViewType = "chat"): PaneLeaf {
  return {
    type: "leaf",
    id,
    tabs: [
      {
        id: id + "-tab-0",
        viewType,
      },
    ],
    activeTabIndex: 0,
  }
}

export const { use: usePanes, provider: PanesProvider } = createSimpleContext({
  name: "Panes",
  init: () => {
    // The pane tree. "main" is a virtual pane representing the main chat
    // which is rendered separately by session/index.tsx
    const [store, setStore] = createStore<PanesState>({
      root: createPaneLeaf("main", "chat"),
      activeId: "main",
      maximized: null,
      history: ["main"],
      floating: [],
      nextZIndex: 100,
      workspaces: [],
      currentWorkspace: null,
      // Sidebar defaults
      leftSidebar: {
        visible: false,
        width: 40,
        viewType: "afs",
      },
      rightSidebar: {
        visible: true, // Right sidebar visible by default (matches current behavior)
        width: 42,
        viewType: "summary",
      },
    })

    // Load workspaces from storage on init
    async function loadWorkspaces() {
      try {
        const workspaces = await Storage.read<Workspace[]>(["workspaces"])
        if (workspaces && Array.isArray(workspaces)) {
          setStore("workspaces", workspaces)
          log.info("loaded workspaces", { count: workspaces.length })
        }
      } catch (e) {
        // No saved workspaces, that's fine
      }
    }

    // Save workspaces to storage
    async function saveWorkspaces() {
      try {
        await Storage.write(["workspaces"], store.workspaces)
        log.info("saved workspaces", { count: store.workspaces.length })
      } catch (e) {
        log.error("failed to save workspaces", { error: e })
      }
    }

    // Load workspaces on init
    loadWorkspaces()

    // Track current session for persistence
    let currentSessionID: string | null = null
    let saveTimeout: NodeJS.Timeout | null = null

    /**
     * Debounced save - waits 500ms after last change to save
     */
    function debouncedSave() {
      if (saveTimeout) clearTimeout(saveTimeout)
      if (!currentSessionID) return

      const sessionID = currentSessionID
      saveTimeout = setTimeout(() => {
        saveLayoutToStorage(sessionID, store)
      }, 500)
    }

    /**
     * Load layout for a session (called when session changes)
     */
    async function loadLayout(sessionID: string) {
      currentSessionID = sessionID
      const layout = await loadLayoutFromStorage(sessionID)

      if (layout) {
        // Migrate any legacy panes to tabs structure and ensure main pane is chat
        const migrateNode = (node: PaneNode): PaneNode => {
          if (node.type === "leaf") {
            const migrated = migratePaneToTabs(node)
            // Ensure the main pane's active tab is always chat view
            if (migrated.id === "main" && migrated.tabs && migrated.tabs.length > 0) {
              const activeTab = migrated.tabs[migrated.activeTabIndex]
              if (activeTab && activeTab.viewType !== "chat" && activeTab.viewType !== "home") {
                activeTab.viewType = "chat"
              }
            }
            return migrated
          }
          return {
            ...node,
            first: migrateNode(node.first),
            second: migrateNode(node.second),
          }
        }
        const migratedRoot = migrateNode(layout.root)
        setStore("root", migratedRoot)
        setStore("activeId", layout.activeId)
        // Rebuild history from loaded layout or use saved history
        const leaves = collectLeavesWithBounds(migratedRoot).map((l) => l.pane.id)
        setStore("history", layout.history && layout.history.length > 0 ? layout.history : leaves)
        setStore("floating", layout.floating ?? [])
        setStore("maximized", layout.maximized ?? null)
        setStore("leftSidebar", layout.leftSidebar ?? store.leftSidebar)
        setStore("rightSidebar", layout.rightSidebar ?? store.rightSidebar)
      } else {
        // Reset to default single pane if no saved layout
        setStore("root", createPaneLeaf("main", "chat"))
        setStore("activeId", "main")
        setStore("maximized", null)
        setStore("history", ["main"])
      }
    }

    /**
     * Manually save current layout
     */
    function saveLayout() {
      if (!currentSessionID) return
      saveLayoutToStorage(currentSessionID, store)
    }

    /**
     * Reset layout to default (single pane)
     */
    function resetLayout() {
      setStore("root", createPaneLeaf("main", "chat"))
      setStore("activeId", "main")
      setStore("maximized", null)
      setStore("history", ["main"])
      setStore("floating", [])
      setStore("nextZIndex", 100)
      debouncedSave()
    }

    /**
     * Split the active pane in a direction
     */
    function split(direction: SplitDirection, viewType?: PaneViewType) {
      const root = unwrap(store.root) as PaneNode
      const activePane = findPane(root, store.activeId)
      if (!activePane || activePane.type !== "leaf") return

      const migratedActivePane = migratePaneToTabs(activePane)
      const activeTab = getActiveTab(migratedActivePane)

      // Default UX: splitting the main chat creates a useful side-pane (AFS),
      // otherwise we duplicate the current view unless an explicit viewType is provided.
      const nextViewType =
        viewType ?? (migratedActivePane.id === "main" && activeTab.viewType === "chat" ? "afs" : activeTab.viewType)

      const newPaneId = generateId()
      const newTabId = newPaneId + "-tab-0"
      const newPane: PaneLeaf = {
        type: "leaf",
        id: newPaneId,
        tabs: [
          {
            id: newTabId,
            viewType: nextViewType,
            sessionID:
              nextViewType === activeTab.viewType ? (activeTab.sessionID ?? currentSessionID ?? undefined) : undefined,
            metadata: nextViewType === activeTab.viewType ? activeTab.metadata : undefined,
          },
        ],
        activeTabIndex: 0,
      }

      const newSplit: PaneSplit = {
        type: "split",
        id: generateId(),
        direction,
        ratio: 0.5,
        first: migratedActivePane,
        second: newPane,
      }

      setStore("root", replacePaneInTree(root, store.activeId, newSplit))
      if (store.maximized) setStore("maximized", null)
      setStore("activeId", newPaneId)
      setStore("history", [...store.history.filter((h) => h !== newPaneId), newPaneId])
      debouncedSave()
    }

    /**
     * Close a pane (defaults to active)
     */
    function close(paneId?: string) {
      const id = paneId ?? store.activeId
      if (id === "main") return

      const root = unwrap(store.root) as PaneNode

      // Can't close the last pane
      if (root.type === "leaf" && root.id === id) return

      const parent = findParent(root, id)
      if (!parent) return

      const sibling = getSibling(parent, id)

      const nextRoot = root.id === parent.id ? sibling : replacePaneInTree(root, parent.id, sibling)
      setStore("root", nextRoot)

      // Update active to sibling (or its first leaf)
      const newActive = sibling.type === "leaf" ? sibling : findFirstLeaf(sibling)
      setStore("activeId", newActive.id)
      if (store.maximized && !findPane(nextRoot, store.maximized)) {
        setStore("maximized", null)
      }

      // Remove from history
      setStore("history", [...store.history.filter((h) => h !== id && h !== newActive.id), newActive.id])
      debouncedSave()
    }

    /**
     * Focus pane in a direction
     */
    function focus(direction: "left" | "right" | "up" | "down") {
      const target = findPaneInDirection(store.root, store.activeId, direction)
      if (target) {
        setStore("activeId", target.id)
        setStore("history", [...store.history.filter((h) => h !== target.id), target.id])
      }
    }

    /**
     * Toggle maximize for active pane
     */
    function maximize() {
      if (store.maximized === store.activeId) {
        setStore("maximized", null)
      } else {
        setStore("maximized", store.activeId)
      }
    }

    /**
     * Set the view type for a pane's active tab
     */
    function setView(paneId: string, viewType: PaneViewType, metadata?: Record<string, any>) {
      const pane = findPane(store.root, paneId)
      if (!pane || pane.type !== "leaf") return

      const metadataSessionID = viewType === "chat" ? (metadata as any)?.sessionID : undefined

      setStore(
        "root",
        produce((root) => {
          const target = findPane(root, paneId) as PaneLeaf | null
          if (target && target.type === "leaf") {
            // Migrate to tabs if needed
            if (!target.tabs || target.tabs.length === 0) {
              target.tabs = [
                {
                  id: target.id + "-tab-0",
                  viewType: target.viewType || "chat",
                  sessionID: target.sessionID,
                  metadata: target.metadata,
                },
              ]
              target.activeTabIndex = 0
            }
            // Update the active tab
            const activeTab = target.tabs[target.activeTabIndex]
            if (activeTab) {
              activeTab.viewType = viewType
              activeTab.metadata = metadata
              if (typeof metadataSessionID === "string" && metadataSessionID.length > 0) {
                activeTab.sessionID = metadataSessionID
              }
            }
          }
        }),
      )
      debouncedSave()
    }

    /**
     * Add a new tab to the active pane
     */
    function addTab(viewType: PaneViewType = "chat", metadata?: Record<string, any>) {
      const pane = findPane(store.root, store.activeId)
      if (!pane || pane.type !== "leaf") return

      setStore(
        "root",
        produce((root) => {
          const target = findPane(root, store.activeId) as PaneLeaf | null
          if (target && target.type === "leaf") {
            // Migrate to tabs if needed
            if (!target.tabs || target.tabs.length === 0) {
              target.tabs = [
                {
                  id: target.id + "-tab-0",
                  viewType: target.viewType || "chat",
                  sessionID: target.sessionID,
                  metadata: target.metadata,
                },
              ]
              target.activeTabIndex = 0
            }
            // Add new tab
            const newTabId = target.id + "-tab-" + target.tabs.length
            target.tabs.push({
              id: newTabId,
              viewType,
              metadata,
            })
            // Switch to the new tab
            target.activeTabIndex = target.tabs.length - 1
          }
        }),
      )
      debouncedSave()
    }

    /**
     * Close the active tab in the active pane
     * If it's the last tab, close the entire pane
     */
    function closeTab() {
      const pane = findPane(store.root, store.activeId)
      if (!pane || pane.type !== "leaf") return

      // If only one tab (or legacy pane), close the whole pane
      if (!pane.tabs || pane.tabs.length <= 1) {
        close()
        return
      }

      setStore(
        "root",
        produce((root) => {
          const target = findPane(root, store.activeId) as PaneLeaf | null
          if (target && target.type === "leaf" && target.tabs && target.tabs.length > 1) {
            const closedIndex = target.activeTabIndex
            target.tabs.splice(closedIndex, 1)
            // Adjust active index if needed
            if (target.activeTabIndex >= target.tabs.length) {
              target.activeTabIndex = target.tabs.length - 1
            }
          }
        }),
      )
      debouncedSave()
    }

    /**
     * Cycle through tabs in the active pane
     * @param direction 1 for next, -1 for previous
     */
    function cycleTab(direction: 1 | -1 = 1) {
      const pane = findPane(store.root, store.activeId)
      if (!pane || pane.type !== "leaf") return
      if (!pane.tabs || pane.tabs.length <= 1) return

      setStore(
        "root",
        produce((root) => {
          const target = findPane(root, store.activeId) as PaneLeaf | null
          if (target && target.type === "leaf" && target.tabs && target.tabs.length > 1) {
            let newIndex = target.activeTabIndex + direction
            if (newIndex >= target.tabs.length) newIndex = 0
            if (newIndex < 0) newIndex = target.tabs.length - 1
            target.activeTabIndex = newIndex
          }
        }),
      )
      debouncedSave()
    }

    /**
     * Go to a specific tab by index
     */
    function goToTab(index: number) {
      const pane = findPane(store.root, store.activeId)
      if (!pane || pane.type !== "leaf") return
      if (!pane.tabs || index < 0 || index >= pane.tabs.length) return

      setStore(
        "root",
        produce((root) => {
          const target = findPane(root, store.activeId) as PaneLeaf | null
          if (target && target.type === "leaf" && target.tabs) {
            target.activeTabIndex = index
          }
        }),
      )
      debouncedSave()
    }

    /**
     * Transform the active tab to show a session (used by HomeView)
     * This changes a "home" tab into a "chat" tab with the given sessionID
     */
    function setTabSession(paneId: string, sessionID: string) {
      const pane = findPane(store.root, paneId)
      if (!pane || pane.type !== "leaf") return

      setStore(
        "root",
        produce((root) => {
          const target = findPane(root, paneId) as PaneLeaf | null
          if (target && target.type === "leaf") {
            // Migrate to tabs if needed
            if (!target.tabs || target.tabs.length === 0) {
              target.tabs = [
                {
                  id: target.id + "-tab-0",
                  viewType: target.viewType || "chat",
                  sessionID: target.sessionID,
                  metadata: target.metadata,
                },
              ]
              target.activeTabIndex = 0
            }
            // Update the active tab to be a session
            const activeTab = target.tabs[target.activeTabIndex]
            if (activeTab) {
              activeTab.viewType = "chat"
              activeTab.sessionID = sessionID
            }
          }
        }),
      )
      debouncedSave()
    }

    /**
     * Move the active tab left or right
     */
    function moveTab(direction: 1 | -1) {
      const pane = findPane(store.root, store.activeId)
      if (!pane || pane.type !== "leaf") return
      if (!pane.tabs || pane.tabs.length <= 1) return

      setStore(
        "root",
        produce((root) => {
          const target = findPane(root, store.activeId) as PaneLeaf | null
          if (target && target.type === "leaf" && target.tabs && target.tabs.length > 1) {
            const currentIndex = target.activeTabIndex
            let newIndex = currentIndex + direction
            if (newIndex >= target.tabs.length) newIndex = 0
            if (newIndex < 0) newIndex = target.tabs.length - 1

            // Swap tabs
            const temp = target.tabs[currentIndex]
            target.tabs[currentIndex] = target.tabs[newIndex]
            target.tabs[newIndex] = temp
            target.activeTabIndex = newIndex
          }
        }),
      )
      debouncedSave()
    }

    /**
     * Float the active pane (remove from tree and add to floating array)
     */
    function floatPane() {
      const root = unwrap(store.root) as PaneNode
      const pane = findPane(root, store.activeId)
      if (!pane || pane.type !== "leaf") return

      // Don't float the main pane
      if (pane.id === "main") return

      // Remove pane from tree
      const parent = findParent(root, store.activeId)
      if (!parent) return

      const sibling = getSibling(parent, pane.id)

      // Create floating pane with default centered position
      const floatingPane: FloatingPane = {
        pane: migratePaneToTabs(pane),
        x: 0.15,
        y: 0.15,
        width: 0.7,
        height: 0.7,
        zIndex: store.nextZIndex,
      }

      const nextRoot = root.id === parent.id ? sibling : replacePaneInTree(root, parent.id, sibling)
      setStore("root", nextRoot)
      if (store.maximized && !findPane(nextRoot, store.maximized)) {
        setStore("maximized", null)
      }

      // Add to floating array
      setStore("floating", [...store.floating, floatingPane])
      setStore("nextZIndex", store.nextZIndex + 1)
      setStore("activeId", pane.id)

      // Update history
      setStore("history", store.history.filter((h) => h !== pane.id).concat([pane.id]))

      debouncedSave()
    }

    /**
     * Dock a floating pane back into the tree (at current active pane)
     */
    function dockPane(floatingId?: string) {
      const id = floatingId ?? store.activeId
      const floatingIndex = store.floating.findIndex((f) => f.pane.id === id)
      if (floatingIndex === -1) return

      const floatingPane = store.floating[floatingIndex]

      // Find where to dock - next to the currently active tree pane
      // or fall back to the last non-floating pane in history.
      const root = unwrap(store.root) as PaneNode
      const activeInTree = findPane(root, store.activeId)
      const targetId =
        activeInTree?.type === "leaf"
          ? store.activeId
          : (store.history.findLast((hid) => findPane(root, hid)?.type === "leaf") ?? "main")

      const targetPane = findPane(root, targetId)
      if (!targetPane || targetPane.type !== "leaf") return

      // Create a new split with the docked pane
      const newSplit: PaneSplit = {
        type: "split",
        id: generateId(),
        direction: "vertical",
        ratio: 0.5,
        first: migratePaneToTabs(targetPane),
        second: migratePaneToTabs(floatingPane.pane),
      }

      // Replace target with split
      const nextRoot = replacePaneInTree(root, targetId, newSplit)
      setStore("root", nextRoot)
      if (store.maximized && !findPane(nextRoot, store.maximized)) {
        setStore("maximized", null)
      }

      // Remove from floating array
      setStore(
        "floating",
        store.floating.filter((_, i) => i !== floatingIndex),
      )

      setStore("activeId", floatingPane.pane.id)
      setStore("history", [...store.history.filter((h) => h !== floatingPane.pane.id), floatingPane.pane.id])
      debouncedSave()
    }

    /**
     * Check if a pane is floating
     */
    function isFloating(paneId: string): boolean {
      return store.floating.some((f) => f.pane.id === paneId)
    }

    /**
     * Toggle float/dock for the active pane
     */
    function toggleFloat() {
      if (isFloating(store.activeId)) {
        dockPane(store.activeId)
      } else {
        floatPane()
      }
    }

    /**
     * Bring a floating pane to front
     */
    function bringToFront(paneId: string) {
      const index = store.floating.findIndex((f) => f.pane.id === paneId)
      if (index === -1) return

      setStore(
        "floating",
        produce((floating) => {
          floating[index].zIndex = store.nextZIndex
        }),
      )
      setStore("nextZIndex", store.nextZIndex + 1)
      setStore("activeId", paneId)
    }

    /**
     * Close a floating pane
     */
    function closeFloating(paneId?: string) {
      const id = paneId ?? store.activeId
      const index = store.floating.findIndex((f) => f.pane.id === id)
      if (index === -1) return

      // Remove from floating
      setStore(
        "floating",
        store.floating.filter((_, i) => i !== index),
      )

      // Update active to tree pane
      if (store.activeId === id) {
        const leaves = collectLeavesWithBounds(store.root)
        if (leaves.length > 0) {
          setStore("activeId", leaves[0].pane.id)
        }
      }

      // Remove from history
      setStore(
        "history",
        store.history.filter((h) => h !== id),
      )

      debouncedSave()
    }

    /**
     * Move a floating pane (adjust position)
     */
    function moveFloating(paneId: string, dx: number, dy: number) {
      const index = store.floating.findIndex((f) => f.pane.id === paneId)
      if (index === -1) return

      setStore(
        "floating",
        produce((floating) => {
          floating[index].x = Math.max(0, Math.min(1 - floating[index].width, floating[index].x + dx))
          floating[index].y = Math.max(0, Math.min(1 - floating[index].height, floating[index].y + dy))
        }),
      )
      debouncedSave()
    }

    /**
     * Resize a floating pane
     */
    function resizeFloating(paneId: string, dw: number, dh: number) {
      const index = store.floating.findIndex((f) => f.pane.id === paneId)
      if (index === -1) return

      setStore(
        "floating",
        produce((floating) => {
          floating[index].width = Math.max(0.2, Math.min(0.9, floating[index].width + dw))
          floating[index].height = Math.max(0.2, Math.min(0.9, floating[index].height + dh))
        }),
      )
      debouncedSave()
    }

    /**
     * Save current layout as a named workspace
     */
    function saveWorkspace(name: string, description?: string) {
      const now = Date.now()
      const existingIndex = store.workspaces.findIndex((w) => w.name === name)

      const workspace: Workspace = {
        name,
        description,
        root: JSON.parse(JSON.stringify(store.root)), // Deep clone
        floating: JSON.parse(JSON.stringify(store.floating)),
        leftSidebar: JSON.parse(JSON.stringify(store.leftSidebar)),
        rightSidebar: JSON.parse(JSON.stringify(store.rightSidebar)),
        history: [...store.history],
        maximized: store.maximized,
        createdAt: existingIndex >= 0 ? store.workspaces[existingIndex].createdAt : now,
        updatedAt: now,
      }

      if (existingIndex >= 0) {
        // Update existing workspace
        setStore(
          "workspaces",
          produce((workspaces) => {
            workspaces[existingIndex] = workspace
          }),
        )
      } else {
        // Add new workspace
        setStore("workspaces", [...store.workspaces, workspace])
      }

      setStore("currentWorkspace", name)
      saveWorkspaces()
      log.info("saved workspace", { name })
    }

    /**
     * Load a workspace by name
     */
    function loadWorkspace(name: string) {
      const workspace = store.workspaces.find((w) => w.name === name)
      if (!workspace) {
        log.warn("workspace not found", { name })
        return false
      }

      // Migrate nodes to ensure tabs structure
      const migrateNode = (node: PaneNode): PaneNode => {
        if (node.type === "leaf") {
          return migratePaneToTabs(node)
        }
        return {
          ...node,
          first: migrateNode(node.first),
          second: migrateNode(node.second),
        }
      }

      const migratedRoot = migrateNode(workspace.root)
      setStore("root", migratedRoot)
      setStore(
        "floating",
        workspace.floating.map((f) => ({
          ...f,
          pane: migratePaneToTabs(f.pane),
        })),
      )
      // Restore sidebars if present
      setStore("leftSidebar", workspace.leftSidebar ?? store.leftSidebar)
      setStore("rightSidebar", workspace.rightSidebar ?? store.rightSidebar)

      // Reset to first leaf pane and restore history if available
      const leaves = collectLeavesWithBounds(migratedRoot)
      const history =
        workspace.history && workspace.history.length > 0 ? workspace.history : leaves.map((l) => l.pane.id)
      setStore("history", history)
      setStore("activeId", history[history.length - 1] ?? leaves[0]?.pane.id ?? "main")

      setStore("maximized", workspace.maximized ?? null)
      setStore("currentWorkspace", name)
      debouncedSave()
      log.info("loaded workspace", { name })
      return true
    }

    /**
     * Delete a workspace by name
     */
    function deleteWorkspace(name: string) {
      const index = store.workspaces.findIndex((w) => w.name === name)
      if (index === -1) return false

      setStore(
        "workspaces",
        store.workspaces.filter((_, i) => i !== index),
      )

      if (store.currentWorkspace === name) {
        setStore("currentWorkspace", null)
      }

      saveWorkspaces()
      log.info("deleted workspace", { name })
      return true
    }

    /**
     * Rename a workspace
     */
    function renameWorkspace(oldName: string, newName: string) {
      const index = store.workspaces.findIndex((w) => w.name === oldName)
      if (index === -1) return false

      setStore(
        "workspaces",
        produce((workspaces) => {
          workspaces[index].name = newName
          workspaces[index].updatedAt = Date.now()
        }),
      )

      if (store.currentWorkspace === oldName) {
        setStore("currentWorkspace", newName)
      }

      saveWorkspaces()
      log.info("renamed workspace", { oldName, newName })
      return true
    }

    /**
     * List all workspace names
     */
    function listWorkspaces(): string[] {
      return store.workspaces.map((w) => w.name)
    }

    /**
     * Balance all pane sizes
     */
    function balance() {
      const root = unwrap(store.root) as PaneNode
      setStore("root", balanceRatios(root))
      debouncedSave()
    }

    /**
     * Close all panes except the active one
     */
    function only() {
      const root = unwrap(store.root) as PaneNode
      const active = findPane(root, store.activeId)
      if (!active || active.type !== "leaf") return

      // "main" is a virtual pane; we never want to remove it from the tree.
      // This closes all secondary panes while keeping the active one.
      if (active.id === "main") {
        setStore("root", createPaneLeaf("main", "chat"))
        setStore("activeId", "main")
        setStore("history", ["main"])
        setStore("maximized", null)
        debouncedSave()
        return
      }

      setStore("root", {
        type: "split",
        id: generateId(),
        direction: "vertical",
        ratio: 0.6,
        first: createPaneLeaf("main", "chat"),
        second: migratePaneToTabs(active),
      })
      setStore("maximized", null)
      setStore("activeId", active.id)
      setStore("history", ["main", active.id])
      debouncedSave()
    }

    /**
     * Set active pane by ID
     */
    function setActive(id: string) {
      const pane = findPane(store.root, id)
      if (pane && pane.type === "leaf") {
        setStore("activeId", id)
        setStore("history", [...store.history.filter((h) => h !== id), id])
      }
    }

    /**
     * Cycle through pane history (TAB to cycle forward, shift+TAB to cycle back)
     */
    function cycleHistory(direction: 1 | -1 = 1) {
      const history = store.history
      if (history.length < 2) return

      const currentIndex = history.indexOf(store.activeId)
      if (currentIndex === -1) return

      let nextIndex = currentIndex + direction
      if (nextIndex >= history.length) nextIndex = 0
      if (nextIndex < 0) nextIndex = history.length - 1

      const nextId = history[nextIndex]
      if (nextId) {
        setStore("activeId", nextId)
      }
    }

    /**
     * Go to previously active pane
     */
    function previousPane() {
      const history = store.history
      if (history.length < 2) return

      // Find the second-to-last pane in history
      const previousId = history[history.length - 2]
      if (previousId) {
        setActive(previousId)
      }
    }

    /**
     * Resize the active pane (adjust split ratio)
     * @param delta - positive to grow, negative to shrink (in increments of 0.05)
     */
    function resize(delta: number) {
      const parent = findParent(store.root, store.activeId)
      if (!parent) return

      // Determine if we need to invert the delta based on position
      const isFirstChild =
        parent.first.id === store.activeId || (parent.first.type === "split" && findPane(parent.first, store.activeId))

      const adjustedRatio = isFirstChild
        ? Math.max(0.1, Math.min(0.9, parent.ratio + delta))
        : Math.max(0.1, Math.min(0.9, parent.ratio - delta))

      setStore(
        "root",
        produce((root) => {
          const target = findParent(root, store.activeId) as PaneSplit | null
          if (target) {
            target.ratio = adjustedRatio
          }
        }),
      )
      debouncedSave()
    }

    /**
     * Grow the active pane
     */
    function grow() {
      resize(0.05)
    }

    /**
     * Shrink the active pane
     */
    function shrink() {
      resize(-0.05)
    }

    // =============================================
    // Sidebar Management
    // =============================================

    /**
     * Toggle sidebar visibility
     */
    function toggleSidebar(side: "left" | "right") {
      const key = side === "left" ? "leftSidebar" : "rightSidebar"
      setStore(key, "visible", !store[key].visible)
      debouncedSave()
    }

    /**
     * Set sidebar visibility explicitly
     */
    function setSidebarVisible(side: "left" | "right", visible: boolean) {
      const key = side === "left" ? "leftSidebar" : "rightSidebar"
      setStore(key, "visible", visible)
      debouncedSave()
    }

    /**
     * Set sidebar view type
     */
    function setSidebarView(side: "left" | "right", viewType: SidebarViewType) {
      const key = side === "left" ? "leftSidebar" : "rightSidebar"
      setStore(key, "viewType", viewType)
      debouncedSave()
    }

    /**
     * Resize sidebar width
     */
    function resizeSidebar(side: "left" | "right", delta: number) {
      const key = side === "left" ? "leftSidebar" : "rightSidebar"
      const currentWidth = store[key].width
      const newWidth = Math.max(30, Math.min(60, currentWidth + delta))
      setStore(key, "width", newWidth)
      debouncedSave()
    }

    /**
     * Set sidebar width explicitly
     */
    function setSidebarWidth(side: "left" | "right", width: number) {
      const key = side === "left" ? "leftSidebar" : "rightSidebar"
      const clampedWidth = Math.max(30, Math.min(60, width))
      setStore(key, "width", clampedWidth)
      debouncedSave()
    }

    /**
     * Apply a preset layout
     */
    function applyPreset(preset: "single" | "dual" | "triple" | "quad") {
      switch (preset) {
        case "single":
          // Reset to single main pane
          setStore("root", createPaneLeaf("main", "chat"))
          setStore("activeId", "main")
          setStore("maximized", null)
          setStore("history", ["main"])
          break

        case "dual":
          // Main chat + one secondary pane (vertical split)
          const dualPaneId = generateId()
          setStore("root", {
            type: "split",
            id: generateId(),
            direction: "vertical",
            ratio: 0.6,
            first: createPaneLeaf("main", "chat"),
            second: createPaneLeaf(dualPaneId, "afs"),
          })
          setStore("activeId", dualPaneId)
          setStore("history", ["main", dualPaneId])
          break

        case "triple":
          // Main chat + two secondary panes (vertical split, then horizontal on right)
          const triplePane1 = generateId()
          const triplePane2 = generateId()
          setStore("root", {
            type: "split",
            id: generateId(),
            direction: "vertical",
            ratio: 0.5,
            first: createPaneLeaf("main", "chat"),
            second: {
              type: "split",
              id: generateId(),
              direction: "horizontal",
              ratio: 0.5,
              first: createPaneLeaf(triplePane1, "afs"),
              second: createPaneLeaf(triplePane2, "tom"),
            },
          })
          setStore("activeId", triplePane1)
          setStore("history", ["main", triplePane1, triplePane2])
          break

        case "quad":
          // 2x2 grid
          const q1 = generateId()
          const q2 = generateId()
          const q3 = generateId()
          setStore("root", {
            type: "split",
            id: generateId(),
            direction: "vertical",
            ratio: 0.5,
            first: {
              type: "split",
              id: generateId(),
              direction: "horizontal",
              ratio: 0.5,
              first: createPaneLeaf("main", "chat"),
              second: createPaneLeaf(q1, "afs"),
            },
            second: {
              type: "split",
              id: generateId(),
              direction: "horizontal",
              ratio: 0.5,
              first: createPaneLeaf(q2, "tom"),
              second: createPaneLeaf(q3, "metrics"),
            },
          })
          setStore("activeId", q1)
          setStore("history", ["main", q1, q2, q3])
          break
      }
      debouncedSave()
    }

    /**
     * Get all leaf panes
     */
    const allLeaves = createMemo(() => {
      return collectLeavesWithBounds(store.root).map((l) => l.pane)
    })

    /**
     * Get secondary panes (all panes except "main")
     */
    const secondaryPanes = createMemo(() => {
      return allLeaves().filter((p) => p.id !== "main")
    })

    /**
     * Check if there are any secondary panes visible
     */
    const hasSecondaryPanes = createMemo(() => {
      return secondaryPanes().length > 0
    })

    /**
     * Get the active pane
     */
    const activePane = createMemo(() => {
      const pane = findPane(store.root, store.activeId)
      return pane?.type === "leaf" ? pane : null
    })

    // Register which-key actions on mount
    onMount(() => {
      registerWhichKeyAction("window.split.vertical", () => split("vertical"))
      registerWhichKeyAction("window.split.horizontal", () => split("horizontal"))
      registerWhichKeyAction("window.close", () => close())
      registerWhichKeyAction("window.maximize", () => maximize())
      registerWhichKeyAction("window.focus.left", () => focus("left"))
      registerWhichKeyAction("window.focus.down", () => focus("down"))
      registerWhichKeyAction("window.focus.up", () => focus("up"))
      registerWhichKeyAction("window.focus.right", () => focus("right"))
      registerWhichKeyAction("window.balance", () => balance())
      registerWhichKeyAction("window.only", () => only())

      // Pane history navigation
      registerWhichKeyAction("window.other", () => cycleHistory(1))
      registerWhichKeyAction("window.cycle", () => cycleHistory(1))
      registerWhichKeyAction("window.cycle.reverse", () => cycleHistory(-1))
      registerWhichKeyAction("window.previous", () => previousPane())

      // Pane resize
      registerWhichKeyAction("window.grow", () => grow())
      registerWhichKeyAction("window.shrink", () => shrink())

      // Layout presets
      registerWhichKeyAction("window.preset.single", () => applyPreset("single"))
      registerWhichKeyAction("window.preset.dual", () => applyPreset("dual"))
      registerWhichKeyAction("window.preset.triple", () => applyPreset("triple"))
      registerWhichKeyAction("window.preset.quad", () => applyPreset("quad"))

      // Buffer actions - these set the view type of the active pane
      registerWhichKeyAction("buffer.home", () => setView(store.activeId, "home"))
      registerWhichKeyAction("buffer.chat", () => setView(store.activeId, "chat"))
      registerWhichKeyAction("buffer.afs", () => setView(store.activeId, "afs"))
      registerWhichKeyAction("buffer.tom", () => setView(store.activeId, "tom"))
      registerWhichKeyAction("buffer.metrics", () => setView(store.activeId, "metrics"))
      registerWhichKeyAction("buffer.agents", () => setView(store.activeId, "agents"))
      registerWhichKeyAction("buffer.outcomes", () => setView(store.activeId, "outcomes"))
      registerWhichKeyAction("buffer.todo", () => setView(store.activeId, "todo"))
      registerWhichKeyAction("buffer.messages", () => setView(store.activeId, "messages"))
      registerWhichKeyAction("buffer.cognitive", () => setView(store.activeId, "cognitive"))
      registerWhichKeyAction("buffer.hivemind", () => setView(store.activeId, "hivemind"))
      registerWhichKeyAction("buffer.state", () => setView(store.activeId, "state"))
      registerWhichKeyAction("buffer.plan", () => setView(store.activeId, "plan"))
      registerWhichKeyAction("buffer.kill", () => closeTab())

      // Tab actions
      registerWhichKeyAction("tab.new", () => addTab("chat"))
      registerWhichKeyAction("tab.new.home", () => addTab("home"))
      registerWhichKeyAction("tab.new.afs", () => addTab("afs"))
      registerWhichKeyAction("tab.new.tom", () => addTab("tom"))
      registerWhichKeyAction("tab.new.metrics", () => addTab("metrics"))
      registerWhichKeyAction("tab.new.agents", () => addTab("agents"))
      registerWhichKeyAction("tab.close", () => closeTab())
      registerWhichKeyAction("tab.next", () => cycleTab(1))
      registerWhichKeyAction("tab.prev", () => cycleTab(-1))
      registerWhichKeyAction("tab.move.left", () => moveTab(-1))
      registerWhichKeyAction("tab.move.right", () => moveTab(1))
      registerWhichKeyAction("tab.1", () => goToTab(0))
      registerWhichKeyAction("tab.2", () => goToTab(1))
      registerWhichKeyAction("tab.3", () => goToTab(2))
      registerWhichKeyAction("tab.4", () => goToTab(3))
      registerWhichKeyAction("tab.5", () => goToTab(4))

      // Floating pane actions
      registerWhichKeyAction("window.float", () => toggleFloat())
      registerWhichKeyAction("window.dock", () => dockPane())
      registerWhichKeyAction("window.float.close", () => closeFloating())

      // Workspace quick slots (load workspace 1-4)
      registerWhichKeyAction("workspace.1", () => {
        const workspaces = listWorkspaces()
        if (workspaces[0]) loadWorkspace(workspaces[0])
      })
      registerWhichKeyAction("workspace.2", () => {
        const workspaces = listWorkspaces()
        if (workspaces[1]) loadWorkspace(workspaces[1])
      })
      registerWhichKeyAction("workspace.3", () => {
        const workspaces = listWorkspaces()
        if (workspaces[2]) loadWorkspace(workspaces[2])
      })
      registerWhichKeyAction("workspace.4", () => {
        const workspaces = listWorkspaces()
        if (workspaces[3]) loadWorkspace(workspaces[3])
      })

      // Sidebar actions
      registerWhichKeyAction("sidebar.toggle.right", () => toggleSidebar("right"))
      registerWhichKeyAction("sidebar.toggle.left", () => toggleSidebar("left"))
      registerWhichKeyAction("sidebar.grow.right", () => resizeSidebar("right", 2))
      registerWhichKeyAction("sidebar.shrink.right", () => resizeSidebar("right", -2))
      registerWhichKeyAction("sidebar.grow.left", () => resizeSidebar("left", 2))
      registerWhichKeyAction("sidebar.shrink.left", () => resizeSidebar("left", -2))

      // Note: Workspace save/load/delete/rename/list are handled via keybinds in app.tsx
      // since they need dialog context access
    })

    return {
      ready: true,

      /** The pane tree root */
      get root() {
        return store.root
      },

      /** Currently active pane ID */
      get activeId() {
        return store.activeId
      },

      /** Maximized pane ID (null if not maximized) */
      get maximized() {
        return store.maximized
      },

      /** All leaf panes */
      get leaves() {
        return allLeaves()
      },

      /** Secondary panes (excludes "main") */
      get secondaryLeaves() {
        return secondaryPanes()
      },

      /** Whether there are secondary panes visible */
      get hasSecondaryPanes() {
        return hasSecondaryPanes()
      },

      /** The active pane */
      get active() {
        return activePane()
      },

      /** Navigation history */
      get history() {
        return store.history
      },

      // Actions
      split,
      close,
      focus,
      maximize,
      setView,
      balance,
      only,
      setActive,

      // History navigation
      cycleHistory,
      previousPane,

      // Resize
      grow,
      shrink,
      resize,

      // Presets
      applyPreset,

      // Tab management
      addTab,
      closeTab,
      cycleTab,
      goToTab,
      moveTab,
      setTabSession,

      // Floating panes
      get floating() {
        return store.floating
      },
      floatPane,
      dockPane,
      toggleFloat,
      closeFloating,
      bringToFront,
      moveFloating,
      resizeFloating,
      isFloating,

      // Persistence
      loadLayout,
      saveLayout,
      resetLayout,

      // Workspaces
      get workspaces() {
        return store.workspaces
      },
      get currentWorkspace() {
        return store.currentWorkspace
      },
      saveWorkspace,
      loadWorkspace,
      deleteWorkspace,
      renameWorkspace,
      listWorkspaces,

      // Tree utilities
      findPane: (id: string) => findPane(store.root, id),
      collectLeaves: () => collectLeavesWithBounds(store.root),
      getActiveTab: (pane: PaneLeaf) => getActiveTab(pane),

      // Sidebar state
      get leftSidebar() {
        return store.leftSidebar
      },
      get rightSidebar() {
        return store.rightSidebar
      },

      // Sidebar actions
      toggleSidebar,
      setSidebarVisible,
      setSidebarView,
      resizeSidebar,
      setSidebarWidth,
    }
  },
})
