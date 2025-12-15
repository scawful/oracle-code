import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { usePanes, getActiveTab, type PaneViewType } from "@tui/context/panes"
import { createMemo, onMount } from "solid-js"
import { useSync } from "../context/sync"
import { Keybind } from "@/util/keybind"

/**
 * Buffer List Dialog
 *
 * Spacemacs-style buffer list (SPC b b) that shows all open buffers/tabs
 * across all panes with fuzzy search.
 *
 * Features:
 * - Lists all tabs from all panes
 * - Fuzzy search by buffer name
 * - Shows which pane each buffer is in
 * - Highlights current buffer
 * - Switch to buffer on select
 * - Close buffer with ctrl+d
 */

interface BufferEntry {
  id: string
  name: string
  viewType: PaneViewType
  paneId: string
  paneName: string
  tabIndex: number
  sessionID?: string
  isActive: boolean
  isCurrent: boolean
}

function getViewTypeIcon(viewType: PaneViewType): string {
  switch (viewType) {
    case "home":
      return "~"
    case "chat":
      return "#"
    case "afs":
      return "/"
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
    case "cognitive":
      return "@"
    case "hivemind":
      return "*"
    case "state":
      return "$"
    case "plan":
      return "="
    default:
      return "."
  }
}

function getViewTypeName(viewType: PaneViewType): string {
  switch (viewType) {
    case "home":
      return "*home*"
    case "chat":
      return "Session"
    case "afs":
      return "AFS Browser"
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
      return "*Messages*"
    case "cognitive":
      return "Cognitive"
    case "hivemind":
      return "Hivemind"
    case "state":
      return "Shared State"
    case "plan":
      return "Plan"
    default:
      return viewType
  }
}

function getPaneName(paneId: string, index: number): string {
  if (paneId === "main") return "Main"
  return `Pane ${index + 1}`
}

export function DialogBufferList() {
  const dialog = useDialog()
  const panes = usePanes()
  const sync = useSync()

  onMount(() => {
    dialog.setSize("large")
  })

  // Collect all buffers from all panes
  const buffers = createMemo(() => {
    const result: BufferEntry[] = []
    const leaves = panes.leaves
    const activePane = panes.active

    leaves.forEach((leaf, paneIndex) => {
      const paneName = getPaneName(leaf.id, paneIndex)
      const isActivePane = leaf.id === panes.activeId

      // Get all tabs from this pane
      const tabs = leaf.tabs || []
      tabs.forEach((tab, tabIndex) => {
        const isCurrentTab = isActivePane && tabIndex === leaf.activeTabIndex

        // Build buffer name
        let name = tab.label || getViewTypeName(tab.viewType)
        if (tab.viewType === "chat" && tab.sessionID) {
          const session = sync.data.session.find((s) => s.id === tab.sessionID)
          if (session) {
            name = session.title || "Session"
          }
        }
        if (tab.viewType === "home") {
          name = "*home*"
        }

        result.push({
          id: `${leaf.id}:${tab.id}`,
          name,
          viewType: tab.viewType,
          paneId: leaf.id,
          paneName,
          tabIndex,
          sessionID: tab.sessionID,
          isActive: isActivePane,
          isCurrent: isCurrentTab,
        })
      })
    })

    return result
  })

  // Convert to DialogSelect options
  const options = createMemo(() => {
    return buffers().map((buf) => {
      const icon = getViewTypeIcon(buf.viewType)
      // Add indicator for current buffer
      const currentIndicator = buf.isCurrent ? ">" : " "
      const activeIndicator = buf.isActive && !buf.isCurrent ? "*" : ""
      const title = `${currentIndicator}${icon} ${buf.name}${activeIndicator}`

      // Show window info in footer
      const footer = `[${buf.paneName}]`

      // Group by type category
      const category =
        buf.viewType === "home" || buf.viewType === "messages" ? "Special" : getViewTypeName(buf.viewType)

      return {
        title,
        value: buf,
        category,
        footer,
        description: buf.sessionID ? `session: ${buf.sessionID.slice(0, 8)}...` : undefined,
      }
    })
  })

  return (
    <DialogSelect
      title="Buffers"
      placeholder="Search buffers..."
      options={options()}
      current={buffers().find((b) => b.isCurrent)}
      onSelect={(option) => {
        const buf = option.value as BufferEntry
        // Focus the pane and switch to the tab
        panes.setActive(buf.paneId)
        panes.goToTab(buf.tabIndex)
        dialog.clear()
      }}
      keybind={[
        {
          keybind: Keybind.parse("ctrl+d")[0],
          title: "close",
          onTrigger: (option) => {
            const buf = option.value as BufferEntry
            // Switch to the pane first, then close the tab
            const currentActive = panes.activeId
            panes.setActive(buf.paneId)
            panes.goToTab(buf.tabIndex)
            panes.closeTab()
            // Return to original pane if it still exists
            if (currentActive !== buf.paneId) {
              panes.setActive(currentActive)
            }
          },
        },
        {
          keybind: Keybind.parse("ctrl+k")[0],
          title: "kill pane",
          onTrigger: (option) => {
            const buf = option.value as BufferEntry
            if (buf.paneId !== "main") {
              panes.setActive(buf.paneId)
              panes.close()
            }
          },
        },
      ]}
    />
  )
}
