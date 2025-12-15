import { createEffect, createMemo, createSignal, on, onMount, Show } from "solid-js"
import { useSync } from "../context/sync"
import { usePanes } from "../context/panes"
import { useTheme } from "../context/theme"
import { useToast } from "../ui/toast"
import { useSDK } from "../context/sdk"
import { useKV } from "../context/kv"
import { Log } from "@/util/log"

const log = Log.create({ service: "lane-split-view" })

/**
 * Lane Split View Controller
 *
 * Monitors for subagent spawns and automatically creates split views
 * to show the subagent's chat alongside the parent session.
 *
 * Features:
 * - Auto-creates 60/40 split when subagent spawns
 * - Shows visual connection between parent and child
 * - Collapses when subagent completes
 * - Tracks multiple concurrent subagents
 *
 * This component renders nothing - it just manages the pane splits
 * in response to subagent lifecycle events.
 */

interface TrackedSubagent {
  sessionId: string
  parentId: string
  paneId: string // The pane we created for this subagent
  createdAt: number
  completedAt?: number
}

export function LaneSplitViewController() {
  const sync = useSync()
  const panes = usePanes()
  const toast = useToast()
  const sdk = useSDK()
  const kv = useKV()

  // Track subagents we've created panes for
  const [trackedSubagents, setTrackedSubagents] = createSignal<TrackedSubagent[]>([])

  // Settings for auto-split behavior
  // Default to false - manual pane management is less confusing
  const [autoSplitEnabled] = kv.signal("tui.lanes.auto_split", false)
  const [autoCollapseEnabled] = kv.signal("tui.lanes.auto_collapse", true)
  const [splitRatio] = kv.signal("tui.lanes.split_ratio", 0.6) // Main chat gets 60%
  const [collapseDelayMs] = kv.signal("tui.lanes.collapse_delay_ms", 2000)

  // Get all subagent sessions
  const subagentSessions = createMemo(() => {
    const sessions = sync.data.session || []
    return sessions.filter((s) => s.parentID)
  })

  // Get busy subagents (those that are actively working)
  const busySubagents = createMemo(() => {
    const statuses = sync.data.session_status || {}
    return subagentSessions().filter((s) => statuses[s.id]?.type === "busy")
  })

  // Get completed subagents (those that were busy but are now idle)
  const completedSubagents = createMemo(() => {
    const statuses = sync.data.session_status || {}
    const tracked = trackedSubagents()
    return tracked.filter((t) => {
      const status = statuses[t.sessionId]
      return status?.type !== "busy" && !t.completedAt
    })
  })

  // Monitor for new subagent spawns
  createEffect(
    on(busySubagents, (currentBusy, prevBusy) => {
      if (!autoSplitEnabled()) return

      const prevIds = new Set((prevBusy || []).map((s) => s.id))
      const tracked = trackedSubagents()
      const trackedIds = new Set(tracked.map((t) => t.sessionId))

      // Find newly spawned subagents
      for (const session of currentBusy) {
        if (!prevIds.has(session.id) && !trackedIds.has(session.id)) {
          log.info("new subagent spawned", { sessionId: session.id, parentId: session.parentID })
          createSubagentPane(session.id, session.parentID!)
        }
      }
    }),
  )

  // Monitor for completed subagents
  createEffect(
    on(completedSubagents, (completed) => {
      if (!autoSplitEnabled() || !autoCollapseEnabled()) return

      for (const subagent of completed) {
        log.info("subagent completed", { sessionId: subagent.sessionId })
        markSubagentCompleted(subagent.sessionId)

        // Schedule pane collapse after a short delay (let user see result)
        setTimeout(
          () => {
            collapseSubagentPane(subagent.sessionId)
          },
          Math.max(0, collapseDelayMs()),
        )
      }
    }),
  )

  // Create a pane for a new subagent
  function createSubagentPane(sessionId: string, parentId: string) {
    // Only auto-split if we're on a single pane layout
    if (panes.hasSecondaryPanes) {
      log.info("skipping auto-split - secondary panes already exist")
      return
    }

    // Create a vertical split with the subagent chat
    panes.split("vertical", "chat")

    const newPaneId = panes.activeId
    if (newPaneId && newPaneId !== "main") {
      // Set the pane to show the subagent's session
      panes.setView(newPaneId, "chat", { sessionID: sessionId })

      // Apply a sensible default ratio: main chat 60%, side pane 40%
      const desired = Math.max(0.1, Math.min(0.9, splitRatio()))
      panes.setActive("main")
      panes.resize(desired - 0.5)
      panes.setActive("main")

      // Track this subagent
      setTrackedSubagents((prev) => [
        ...prev,
        {
          sessionId,
          parentId,
          paneId: newPaneId,
          createdAt: Date.now(),
        },
      ])

      // Show toast notification
      const session = sync.data.session.find((s) => s.id === sessionId)
      const agentMatch = session?.title.match(/@(\w+)/)
      const agentName = agentMatch?.[1] || "subagent"

      toast.show({
        message: `@${agentName} spawned`,
        variant: "info",
        duration: 2000,
      })

      log.info("created subagent pane", { sessionId, paneId: newPaneId })
    }
  }

  // Mark a subagent as completed
  function markSubagentCompleted(sessionId: string) {
    setTrackedSubagents((prev) => prev.map((t) => (t.sessionId === sessionId ? { ...t, completedAt: Date.now() } : t)))
  }

  // Collapse a subagent's pane
  function collapseSubagentPane(sessionId: string) {
    const tracked = trackedSubagents()
    const subagent = tracked.find((t) => t.sessionId === sessionId)

    if (!subagent) return

    // Close the pane
    panes.close(subagent.paneId)

    // Remove from tracking
    setTrackedSubagents((prev) => prev.filter((t) => t.sessionId !== sessionId))

    // Show completion toast
    const session = sync.data.session.find((s) => s.id === sessionId)
    const agentMatch = session?.title.match(/@(\w+)/)
    const agentName = agentMatch?.[1] || "subagent"

    toast.show({
      message: `@${agentName} completed`,
      variant: "success",
      duration: 2000,
    })

    log.info("collapsed subagent pane", { sessionId, paneId: subagent.paneId })
  }

  // Clean up any orphaned tracked subagents on mount
  onMount(() => {
    // Listen for session events to track subagent lifecycle
    const unsubs = [
      sdk.event.on("session.created", (evt) => {
        const session = evt.properties.info
        if (session.parentID) {
          log.info("subagent session created", { sessionId: session.id, parentId: session.parentID })
        }
      }),
      sdk.event.on("session.deleted", (evt) => {
        const sessionId = evt.properties.info.id
        const tracked = trackedSubagents().find((t) => t.sessionId === sessionId)
        if (tracked) {
          log.info("tracked subagent deleted, cleaning up", { sessionId })
          setTrackedSubagents((prev) => prev.filter((t) => t.sessionId !== sessionId))
          panes.close(tracked.paneId)
        }
      }),
    ]

    return () => {
      unsubs.forEach((unsub) => unsub())
    }
  })

  // This component doesn't render anything visible
  return null
}

/**
 * Lane Indicator Component
 *
 * Shows a visual indicator in the chat when viewing a subagent session,
 * displaying the connection to its parent session.
 */
export function LaneIndicator(props: { sessionId: string }) {
  const sync = useSync()
  const { theme } = useTheme()

  const session = createMemo(() => sync.session.get(props.sessionId))
  const parentSession = createMemo(() => {
    const s = session()
    if (!s?.parentID) return null
    return sync.session.get(s.parentID)
  })

  const isSubagent = createMemo(() => !!session()?.parentID)

  // Extract agent type from title (e.g., "@explorer: task description")
  const agentType = createMemo(() => {
    const s = session()
    if (!s) return null
    const match = s.title.match(/@(\w+)/)
    return match?.[1] || "subagent"
  })

  return (
    <Show when={isSubagent()}>
      <box
        height={1}
        backgroundColor={theme.backgroundElement}
        paddingLeft={1}
        paddingRight={1}
        flexDirection="row"
        gap={1}
        flexShrink={0}
      >
        <text fg={theme.info}>◉</text>
        <text fg={theme.textMuted}>Subagent lane: @{agentType()}</text>
        <Show when={parentSession()}>
          <text fg={theme.textMuted}>|</text>
          <text fg={theme.textMuted}>
            Parent: {parentSession()?.title?.slice(0, 30)}
            {(parentSession()?.title?.length || 0) > 30 ? "..." : ""}
          </text>
        </Show>
      </box>
    </Show>
  )
}

/**
 * Hook to check if we're in a subagent session
 */
export function useIsSubagentSession(sessionId: string) {
  const sync = useSync()
  return createMemo(() => {
    const session = sync.session.get(sessionId)
    return !!session?.parentID
  })
}

/**
 * Hook to get subagent info for a session
 */
export function useSubagentInfo(sessionId: string) {
  const sync = useSync()

  return createMemo(() => {
    const session = sync.session.get(sessionId)
    if (!session?.parentID) return null

    const parent = sync.session.get(session.parentID)
    const match = session.title.match(/@(\w+)/)
    const agentType = match?.[1] || "subagent"

    return {
      sessionId,
      parentId: session.parentID,
      parentTitle: parent?.title,
      agentType,
      title: session.title,
    }
  })
}
