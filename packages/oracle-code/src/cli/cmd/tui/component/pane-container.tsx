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
 * 
 * Handles both leaf nodes (actual panes) and split nodes (containers).
 * Uses proper flex layout to ensure nested splits render correctly.
 */
export function PaneTreeRenderer(props: { node: PaneNode; sessionID: string }) {
  const panes = usePanes()
  const { theme } = useTheme()

  // Handle leaf node - render actual pane content
  if (props.node.type === "leaf") {
    const leaf = props.node
    const isActive = createMemo(() => panes.activeId === leaf.id)
    return (
      <box flexGrow={1} flexShrink={1} flexBasis={0} width="100%" height="100%">
        <PaneView pane={leaf} sessionID={props.sessionID} isActive={isActive()} />
      </box>
    )
  }

  // Handle split node - divide space between two children
  const split = props.node
  const isVertical = split.direction === "vertical"
  
  // Use integer flex values for more precise distribution
  const firstFlex = Math.round(split.ratio * 100)
  const secondFlex = 100 - firstFlex

  return (
    <box
      flexDirection={isVertical ? "row" : "column"}
      flexGrow={1}
      flexShrink={1}
      flexBasis={0}
      width="100%"
      height="100%"
    >
      {/* First child pane */}
      <box
        flexGrow={firstFlex}
        flexShrink={1}
        flexBasis={0}
        flexDirection={isVertical ? "column" : "row"}
        minWidth={isVertical ? 10 : undefined}
        minHeight={isVertical ? undefined : 3}
        width={isVertical ? undefined : "100%"}
        height={isVertical ? "100%" : undefined}
      >
        <PaneTreeRenderer node={split.first} sessionID={props.sessionID} />
      </box>

      {/* Divider line between panes */}
      <box
        backgroundColor={theme.border}
        width={isVertical ? 1 : "100%"}
        height={isVertical ? "100%" : 1}
        flexShrink={0}
      />

      {/* Second child pane */}
      <box
        flexGrow={secondFlex}
        flexShrink={1}
        flexBasis={0}
        flexDirection={isVertical ? "column" : "row"}
        minWidth={isVertical ? 10 : undefined}
        minHeight={isVertical ? undefined : 3}
        width={isVertical ? undefined : "100%"}
        height={isVertical ? "100%" : undefined}
      >
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
