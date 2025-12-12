import { Prompt, type PromptRef } from "@tui/component/prompt"
import { createEffect, createMemo, Match, onMount, Show, Switch } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { Logo } from "../component/logo"
import { Locale } from "@/util/locale"
import { useSync } from "../context/sync"
import { Toast } from "../ui/toast"
import { useArgs } from "../context/args"
import { useDirectory } from "../context/directory"
import { useRoute, useRouteData } from "@tui/context/route"
import { usePromptRef } from "../context/prompt"
import { Installation } from "@/installation"
import { usePanes, type PaneNode, type SplitDirection } from "@tui/context/panes"
import { PaneView, FloatingPaneOverlay } from "@tui/component/pane-view"
import { PaneTreeRenderer } from "@tui/component/pane-container"
import { useDialog } from "../ui/dialog"
import { useKeybind } from "@tui/context/keybind"

// TODO: what is the best way to do this?
let once = false

export function Home() {
  const sync = useSync()
  const { theme } = useTheme()
  const route = useRouteData("home")
  const promptRef = usePromptRef()
  const panes = usePanes()
  const dialog = useDialog()
  const keybind = useKeybind()
  const hasSecondaryPanes = createMemo(() => panes.hasSecondaryPanes)
  const mcp = createMemo(() => Object.keys(sync.data.mcp).length > 0)
  const mcpError = createMemo(() => {
    return Object.values(sync.data.mcp).some((x) => x.status === "failed")
  })

  const connectedMcpCount = createMemo(() => {
    return Object.values(sync.data.mcp).filter((x) => x.status === "connected").length
  })

  const Hint = (
    <Show when={connectedMcpCount() > 0}>
      <box flexShrink={0} flexDirection="row" gap={1}>
        <text fg={theme.text}>
          <Switch>
            <Match when={mcpError()}>
              <span style={{ fg: theme.error }}>•</span> mcp errors{" "}
              <span style={{ fg: theme.textMuted }}>ctrl+x s</span>
            </Match>
            <Match when={true}>
              <span style={{ fg: theme.success }}>•</span>{" "}
              {Locale.pluralize(connectedMcpCount(), "{} mcp server", "{} mcp servers")}
            </Match>
          </Switch>
        </text>
      </box>
    </Show>
  )

  let prompt: PromptRef
  const syncPromptFocus = () => {
    if (!prompt) return
    if (dialog.stack.length > 0 || keybind.leader) {
      if (prompt.focused) prompt.blur()
      return
    }

    if (panes.activeId !== "main") {
      if (prompt.focused) prompt.blur()
    } else {
      if (!prompt.focused) prompt.focus()
    }
  }

  createEffect(() => {
    panes.activeId
    dialog.stack.length
    keybind.leader
    syncPromptFocus()
  })

  const args = useArgs()
  onMount(() => {
    if (once) return
    if (route.initialPrompt) {
      prompt.set(route.initialPrompt)
      once = true
    } else if (args.prompt) {
      prompt.set({ input: args.prompt, parts: [] })
      once = true
    }
  })
  const directory = useDirectory()

  /**
   * Extract the secondary pane subtree, excluding "main".
   * Handles arbitrarily nested trees.
   */
  const secondaryRoot = createMemo(() => {
    const root = panes.root
    if (root.type === "leaf") return null

    function containsMain(node: PaneNode): boolean {
      if (node.type === "leaf") return node.id === "main"
      return containsMain(node.first) || containsMain(node.second)
    }

    function extractSecondary(node: PaneNode): PaneNode | null {
      if (node.type === "leaf") {
        return node.id === "main" ? null : node
      }

      const firstHasMain = containsMain(node.first)
      const secondHasMain = containsMain(node.second)

      if (firstHasMain && !secondHasMain) {
        const firstSecondary = extractSecondary(node.first)
        if (firstSecondary) {
          return { ...node, first: firstSecondary }
        }
        return node.second
      }

      if (secondHasMain && !firstHasMain) {
        const secondSecondary = extractSecondary(node.second)
        if (secondSecondary) {
          return { ...node, second: secondSecondary }
        }
        return node.first
      }

      if (firstHasMain && secondHasMain) {
        const firstSec = extractSecondary(node.first)
        const secondSec = extractSecondary(node.second)
        if (firstSec && secondSec) {
          return { ...node, first: firstSec, second: secondSec }
        }
        return firstSec || secondSec
      }

      return node
    }

    return extractSecondary(root)
  })

  /**
   * Find the split containing "main" and calculate cumulative ratio.
   */
  const mainSecondarySplit = createMemo(() => {
    const root = panes.root
    if (root.type !== "split") return null

    function findMainSplit(
      node: PaneNode,
      cumulativeRatio: number
    ): { direction: SplitDirection; mainRatio: number } | null {
      if (node.type === "leaf") return null

      const firstIsMain = node.first.type === "leaf" && node.first.id === "main"
      const secondIsMain = node.second.type === "leaf" && node.second.id === "main"

      if (firstIsMain) {
        return { direction: node.direction, mainRatio: cumulativeRatio * node.ratio }
      }

      if (secondIsMain) {
        return { direction: node.direction, mainRatio: cumulativeRatio * (1 - node.ratio) }
      }

      const firstResult = findMainSplit(node.first, cumulativeRatio * node.ratio)
      if (firstResult) return firstResult

      return findMainSplit(node.second, cumulativeRatio * (1 - node.ratio))
    }

    return findMainSplit(root, 1.0)
  })

  const mainFraction = createMemo(() => {
    if (!hasSecondaryPanes()) return 1
    return mainSecondarySplit()?.mainRatio ?? 0.6
  })

  const mainSplitDirection = createMemo(() => {
    if (!hasSecondaryPanes()) return "vertical" as const
    return mainSecondarySplit()?.direction ?? ("vertical" as const)
  })

  // Use the shared PaneTreeRenderer for secondary panes
  // The secondaryRoot already excludes "main", so we can render directly

  return (
    <box flexDirection="column" flexGrow={1}>
      <box
        flexDirection={hasSecondaryPanes() ? (mainSplitDirection() === "horizontal" ? "column" : "row") : "row"}
        flexGrow={1}
        position="relative"
      >
        <box
          flexGrow={hasSecondaryPanes() ? mainFraction() : 1}
          flexShrink={0}
          flexBasis={0}
          justifyContent="center"
          alignItems="center"
          paddingLeft={2}
          paddingRight={2}
          gap={1}
        >
          <Logo />
          <box width="100%" maxWidth={75} zIndex={1000} paddingTop={1}>
            <Prompt
              ref={(r) => {
                prompt = r
                promptRef.set(r)
                syncPromptFocus()
              }}
              hint={Hint}
            />
          </box>
          <Toast />
        </box>
        <Show when={hasSecondaryPanes()}>
          <box
            backgroundColor={theme.border}
            width={mainSplitDirection() === "vertical" ? 1 : "100%"}
            height={mainSplitDirection() === "vertical" ? "100%" : 1}
            flexShrink={0}
          />
          <box
            flexGrow={1 - mainFraction()}
            flexShrink={1}
            flexBasis={0}
            width={mainSplitDirection() === "vertical" ? undefined : "100%"}
            height={mainSplitDirection() === "vertical" ? "100%" : undefined}
          >
            <Show when={secondaryRoot()}>
              {(root) => <PaneTreeRenderer node={root()} sessionID="" />}
            </Show>
          </box>
        </Show>
        <FloatingPaneOverlay sessionID={""} />
      </box>

      <box paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2} flexDirection="row" flexShrink={0} gap={2}>
        <text fg={theme.textMuted}>{directory()}</text>
        <box gap={1} flexDirection="row" flexShrink={0}>
          <Show when={mcp()}>
            <text fg={theme.text}>
              <Switch>
                <Match when={mcpError()}>
                  <span style={{ fg: theme.error }}>⊙ </span>
                </Match>
                <Match when={true}>
                  <span style={{ fg: theme.success }}>⊙ </span>
                </Match>
              </Switch>
              {connectedMcpCount()} MCP
            </text>
            <text fg={theme.textMuted}>/status</text>
          </Show>
        </box>
        <box flexGrow={1} />
        <box flexShrink={0}>
          <text fg={theme.textMuted}>{Installation.VERSION}</text>
        </box>
      </box>
    </box>
  )
}
