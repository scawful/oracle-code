import { Show, createMemo } from "solid-js"
import { usePanes, type PaneNode, type PaneLeaf } from "@tui/context/panes"
import { useTheme } from "@tui/context/theme"
import { PaneView } from "./pane-view"

/**
 * PaneContainer - Recursive container for pane tree rendering
 *
 * Renders a tree of panes with splits, handling:
 * - Recursive split rendering (horizontal/vertical)
 * - Active pane highlighting
 * - Maximized pane overlay
 * - Split borders between panes
 */

interface PaneContainerProps {
  /** Session ID to pass to chat views */
  sessionID: string
}

export function PaneContainer(props: PaneContainerProps) {
  const panes = usePanes()
  const { theme } = useTheme()

  return (
    <box flexGrow={1} position="relative">
      <Show
        when={panes.maximized}
        fallback={<PaneTreeRenderer node={panes.root} sessionID={props.sessionID} />}
      >
        {(maximizedId) => {
          const maximizedPane = createMemo(() => {
            const pane = panes.findPane(maximizedId())
            return pane?.type === "leaf" ? pane : null
          })

          return (
            <Show when={maximizedPane()}>
              {(pane) => (
                <PaneView pane={pane()} sessionID={props.sessionID} isActive={true} isMaximized={true} />
              )}
            </Show>
          )
        }}
      </Show>
    </box>
  )
}

/**
 * Recursive renderer for the pane tree
 */
function PaneTreeRenderer(props: { node: PaneNode; sessionID: string }) {
  const panes = usePanes()
  const { theme } = useTheme()

  // Handle leaf node
  if (props.node.type === "leaf") {
    const leaf = props.node
    const isActive = createMemo(() => panes.activeId === leaf.id)
    return <PaneView pane={leaf} sessionID={props.sessionID} isActive={isActive()} />
  }

  // Handle split node
  const split = props.node
  const isVertical = split.direction === "vertical"

  return (
    <box flexDirection={isVertical ? "row" : "column"} flexGrow={1} width="100%" height="100%">
      {/* First pane */}
      <box flexGrow={split.ratio} flexShrink={0} flexBasis={0} overflow="hidden">
        <PaneTreeRenderer node={split.first} sessionID={props.sessionID} />
      </box>

      {/* Split border/divider */}
      <box
        backgroundColor={theme.border}
        width={isVertical ? 1 : "100%"}
        height={isVertical ? "100%" : 1}
        flexShrink={0}
      />

      {/* Second pane */}
      <box flexGrow={1 - split.ratio} flexShrink={0} flexBasis={0} overflow="hidden">
        <PaneTreeRenderer node={split.second} sessionID={props.sessionID} />
      </box>
    </box>
  )
}

/**
 * Simple single-pane container for when pane system is not used
 * This can be used as a fallback or for simpler layouts
 */
export function SimplePaneContainer(props: { sessionID: string; children: any }) {
  return (
    <box flexGrow={1} position="relative">
      {props.children}
    </box>
  )
}
