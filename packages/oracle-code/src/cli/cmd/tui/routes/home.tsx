import { Prompt, type PromptRef } from "@tui/component/prompt"
import { createMemo, Match, onMount, Show, Switch } from "solid-js"
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
import { usePanes, type PaneNode } from "@tui/context/panes"
import { PaneView, FloatingPaneOverlay } from "@tui/component/pane-view"

// TODO: what is the best way to do this?
let once = false

export function Home() {
  const sync = useSync()
  const { theme } = useTheme()
  const route = useRouteData("home")
  const promptRef = usePromptRef()
  const panes = usePanes()
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

  const secondaryRoot = createMemo(() => {
    const root = panes.root
    if (root.type === "leaf") return null
    if (root.first.type === "leaf" && root.first.id === "main") return root.second
    if (root.second.type === "leaf" && root.second.id === "main") return root.first
    return root
  })

  function SecondaryPaneRenderer(props: { node: PaneNode }) {
    if (props.node.type === "leaf" && props.node.id === "main") return null
    if (props.node.type === "leaf") {
      const leaf = props.node
      const isActive = createMemo(() => panes.activeId === leaf.id)
      return <PaneView pane={leaf} sessionID={""} isActive={isActive()} />
    }

    const split = props.node
    const isVertical = split.direction === "vertical"

    return (
      <box flexDirection={isVertical ? "row" : "column"} flexGrow={1} width="100%" height="100%">
        <box flexGrow={split.ratio} flexShrink={0} flexBasis={0} overflow="hidden">
          <SecondaryPaneRenderer node={split.first} />
        </box>
        <box
          backgroundColor={theme.border}
          width={isVertical ? 1 : "100%"}
          height={isVertical ? "100%" : 1}
          flexShrink={0}
        />
        <box flexGrow={1 - split.ratio} flexShrink={0} flexBasis={0} overflow="hidden">
          <SecondaryPaneRenderer node={split.second} />
        </box>
      </box>
    )
  }

  return (
    <box flexDirection="column" flexGrow={1}>
      <box flexDirection="row" flexGrow={1} position="relative">
        <box flexGrow={hasSecondaryPanes() ? 0.6 : 1} justifyContent="center" alignItems="center" paddingLeft={2} paddingRight={2} gap={1}>
          <Logo />
          <box width="100%" maxWidth={75} zIndex={1000} paddingTop={1}>
            <Prompt
              ref={(r) => {
                prompt = r
                promptRef.set(r)
              }}
              hint={Hint}
            />
          </box>
          <Toast />
        </box>
        <Show when={hasSecondaryPanes()}>
          <box width={1} backgroundColor={theme.border} flexShrink={0} />
          <box flexGrow={0.4}>
            <Show when={secondaryRoot()}>
              {(root) => <SecondaryPaneRenderer node={root()} />}
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
