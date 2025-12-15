import { useSync } from "@tui/context/sync"
import { createMemo, For, Show, Switch, Match } from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme } from "../../context/theme"
import { Locale } from "@/util/locale"
import path from "path"
import type { AssistantMessage } from "@oracle-code/sdk/v2"
import { Installation } from "@/installation"
import { useDirectory } from "../../context/directory"
import { AFSPanel } from "../../component/panel-afs"
import { AgentsPanel } from "../../component/panel-agents"
import { StatePanel } from "../../component/panel-state"
import { CognitivePanel } from "../../component/panel-cognitive"
import { OrchestrationPanel } from "../../component/panel-orchestration"
import { SidebarHeader, useSidebarView, type SidebarViewType } from "../../component/sidebar-slot"
import { CognitiveView } from "../../component/views/cognitive-view"
import { AgentsView } from "../../component/views/agents-view"
import { StateView } from "../../component/views/state-view"
import { HivemindView } from "../../component/views/hivemind-view"
import { MetricsView } from "../../component/views/metrics-view"
import { ToMView } from "../../component/views/tom-view"
import { AFSView } from "../../component/views/afs-view"
import { usePanes } from "../../context/panes"

export function Sidebar(props: { sessionID: string }) {
  const sync = useSync()
  const { theme } = useTheme()
  const panes = usePanes()
  const session = createMemo(() => sync.session.get(props.sessionID)!)
  const diff = createMemo(() => sync.data.session_diff[props.sessionID] ?? [])
  const todo = createMemo(() => sync.data.todo[props.sessionID] ?? [])
  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])

  // Sidebar view selector - uses panes context for view type
  const { view: sidebarView, setView: setSidebarView } = useSidebarView("right")

  // Width from panes context
  const sidebarWidth = createMemo(() => panes.rightSidebar.width)

  const [expanded, setExpanded] = createStore({
    mcp: true,
    diff: true,
    todo: true,
    lsp: true,
  })

  // Sort MCP servers alphabetically for consistent display order
  const mcpEntries = createMemo(() => Object.entries(sync.data.mcp).sort(([a], [b]) => a.localeCompare(b)))

  const cost = createMemo(() => {
    const total = messages().reduce((sum, x) => sum + (x.role === "assistant" ? x.cost : 0), 0)
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(total)
  })

  const context = createMemo(() => {
    const last = messages().findLast((x) => x.role === "assistant" && x.tokens.output > 0) as AssistantMessage
    if (!last) return
    const total =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    const model = sync.data.provider.find((x) => x.id === last.providerID)?.models[last.modelID]
    return {
      tokens: total.toLocaleString(),
      percentage: model?.limit.context ? Math.round((total / model.limit.context) * 100) : null,
    }
  })

  const directory = useDirectory()

  const hasProviders = createMemo(() =>
    sync.data.provider.some((x) => x.id !== "opencode" || Object.values(x.models).some((y) => y.cost?.input !== 0)),
  )

  return (
    <Show when={session()}>
      <box
        backgroundColor={theme.backgroundPanel}
        width={sidebarWidth()}
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
      >
        {/* View selector header */}
        <SidebarHeader currentView={sidebarView()} onViewChange={setSidebarView} />

        <scrollbox flexGrow={1}>
          <Switch>
            {/* Summary view - the default with session info and compact panels */}
            <Match when={sidebarView() === "summary"}>
              <SummarySidebarContent
                session={session}
                context={context}
                cost={cost}
                mcpEntries={mcpEntries}
                todo={todo}
                diff={diff}
                expanded={expanded}
                setExpanded={setExpanded}
                sync={sync}
                theme={theme}
              />
            </Match>

            {/* Full-screen views for specific content types */}
            <Match when={sidebarView() === "cognitive"}>
              <CognitiveView paneId="sidebar-right" />
            </Match>
            <Match when={sidebarView() === "agents"}>
              <AgentsView />
            </Match>
            <Match when={sidebarView() === "afs"}>
              <AFSView paneId="sidebar-right" />
            </Match>
            <Match when={sidebarView() === "state"}>
              <StateView paneId="sidebar-right" />
            </Match>
            <Match when={sidebarView() === "hivemind"}>
              <HivemindView paneId="sidebar-right" />
            </Match>
            <Match when={sidebarView() === "metrics"}>
              <MetricsView />
            </Match>
            <Match when={sidebarView() === "tom"}>
              <ToMView />
            </Match>
          </Switch>
        </scrollbox>

        <box flexShrink={0} gap={1} paddingTop={1}>
          <Show when={!hasProviders()}>
            <box
              backgroundColor={theme.backgroundElement}
              paddingTop={1}
              paddingBottom={1}
              paddingLeft={2}
              paddingRight={2}
              flexDirection="row"
              gap={1}
            >
              <text flexShrink={0}>*</text>
              <box flexGrow={1} gap={1}>
                <text>
                  <b>Getting started</b>
                </text>
                <text fg={theme.textMuted}>OpenCode includes free models so you can start immediately.</text>
                <text fg={theme.textMuted}>
                  Connect from 75+ providers to use other models, including Claude, GPT, Gemini etc
                </text>
                <box flexDirection="row" gap={1} justifyContent="space-between">
                  <text>Connect provider</text>
                  <text fg={theme.textMuted}>/connect</text>
                </box>
              </box>
            </box>
          </Show>
          <text fg={theme.text}>{directory()}</text>
          <text fg={theme.textMuted}>
            <span style={{ fg: theme.success }}>*</span> <b>Open</b>
            <span style={{ fg: theme.text }}>
              <b>Code</b>
            </span>{" "}
            <span>{Installation.VERSION}</span>
          </text>
        </box>
      </box>
    </Show>
  )
}

/**
 * LeftSidebar - Simpler sidebar for the left side
 *
 * Shows only the selected view type without summary content.
 * Default view is AFS browser.
 */
export function LeftSidebar(props: { sessionID: string }) {
  const { theme } = useTheme()
  const panes = usePanes()

  // Sidebar view selector for left side
  const { view: sidebarView, setView: setSidebarView } = useSidebarView("left")

  // Width from panes context
  const sidebarWidth = createMemo(() => panes.leftSidebar.width)

  return (
    <box
      backgroundColor={theme.backgroundPanel}
      width={sidebarWidth()}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
    >
      {/* View selector header */}
      <SidebarHeader currentView={sidebarView()} onViewChange={setSidebarView} />

      <scrollbox flexGrow={1}>
        <Switch>
          <Match when={sidebarView() === "afs"}>
            <AFSView paneId="sidebar-left" />
          </Match>
          <Match when={sidebarView() === "cognitive"}>
            <CognitiveView paneId="sidebar-left" />
          </Match>
          <Match when={sidebarView() === "agents"}>
            <AgentsView />
          </Match>
          <Match when={sidebarView() === "state"}>
            <StateView paneId="sidebar-left" />
          </Match>
          <Match when={sidebarView() === "hivemind"}>
            <HivemindView paneId="sidebar-left" />
          </Match>
          <Match when={sidebarView() === "metrics"}>
            <MetricsView />
          </Match>
          <Match when={sidebarView() === "tom"}>
            <ToMView />
          </Match>
          {/* Summary view shows AFS by default for left sidebar */}
          <Match when={sidebarView() === "summary"}>
            <AFSView paneId="sidebar-left" />
          </Match>
        </Switch>
      </scrollbox>
    </box>
  )
}

/**
 * Summary sidebar content - the default view with session info and compact panels
 */
function SummarySidebarContent(props: {
  session: () => any
  context: () => { tokens: string; percentage: number | null } | undefined
  cost: () => string
  mcpEntries: () => [string, any][]
  todo: () => any[]
  diff: () => any[]
  expanded: { mcp: boolean; diff: boolean; todo: boolean; lsp: boolean }
  setExpanded: (key: keyof typeof props.expanded, value: boolean) => void
  sync: ReturnType<typeof useSync>
  theme: ReturnType<typeof useTheme>["theme"]
}) {
  return (
    <box flexShrink={0} gap={1} paddingRight={1}>
      <box>
        <text fg={props.theme.text}>
          <b>{props.session().title}</b>
        </text>
        <Show when={props.session().share?.url}>
          <text fg={props.theme.textMuted}>{props.session().share!.url}</text>
        </Show>
      </box>
      <box>
        <text fg={props.theme.text}>
          <b>Context</b>
        </text>
        <text fg={props.theme.textMuted}>{props.context()?.tokens ?? 0} tokens</text>
        <text fg={props.theme.textMuted}>{props.context()?.percentage ?? 0}% used</text>
        <text fg={props.theme.textMuted}>{props.cost()} spent</text>
      </box>
      <Show when={props.mcpEntries().length > 0}>
        <box>
          <box
            flexDirection="row"
            gap={1}
            onMouseDown={() => props.mcpEntries().length > 2 && props.setExpanded("mcp", !props.expanded.mcp)}
          >
            <Show when={props.mcpEntries().length > 2}>
              <text fg={props.theme.text}>{props.expanded.mcp ? "v" : ">"}</text>
            </Show>
            <text fg={props.theme.text}>
              <b>MCP</b>
            </text>
          </box>
          <Show when={props.mcpEntries().length <= 2 || props.expanded.mcp}>
            <For each={props.mcpEntries()}>
              {([key, item]) => (
                <box flexDirection="row" gap={1}>
                  <text
                    flexShrink={0}
                    style={{
                      fg: (
                        {
                          connected: props.theme.success,
                          failed: props.theme.error,
                          disabled: props.theme.textMuted,
                          needs_auth: props.theme.warning,
                          needs_client_registration: props.theme.error,
                        } as Record<string, typeof props.theme.success>
                      )[item.status],
                    }}
                  >
                    *
                  </text>
                  <text fg={props.theme.text} wrapMode="word">
                    {key}{" "}
                    <span style={{ fg: props.theme.textMuted }}>
                      <Switch fallback={item.status}>
                        <Match when={item.status === "connected"}>Connected</Match>
                        <Match when={item.status === "failed" && item}>{(val) => <i>{val().error}</i>}</Match>
                        <Match when={item.status === "disabled"}>Disabled</Match>
                        <Match when={(item.status as string) === "needs_auth"}>Needs auth</Match>
                        <Match when={(item.status as string) === "needs_client_registration"}>Needs client ID</Match>
                      </Switch>
                    </span>
                  </text>
                </box>
              )}
            </For>
          </Show>
        </box>
      </Show>
      <box>
        <box
          flexDirection="row"
          gap={1}
          onMouseDown={() => props.sync.data.lsp.length > 2 && props.setExpanded("lsp", !props.expanded.lsp)}
        >
          <Show when={props.sync.data.lsp.length > 2}>
            <text fg={props.theme.text}>{props.expanded.lsp ? "v" : ">"}</text>
          </Show>
          <text fg={props.theme.text}>
            <b>LSP</b>
          </text>
        </box>
        <Show when={props.sync.data.lsp.length <= 2 || props.expanded.lsp}>
          <Show when={props.sync.data.lsp.length === 0}>
            <text fg={props.theme.textMuted}>LSPs will activate as files are read</text>
          </Show>
          <For each={props.sync.data.lsp}>
            {(item) => (
              <box flexDirection="row" gap={1}>
                <text
                  flexShrink={0}
                  style={{
                    fg: {
                      connected: props.theme.success,
                      error: props.theme.error,
                    }[item.status],
                  }}
                >
                  *
                </text>
                <text fg={props.theme.textMuted}>
                  {item.id} {item.root}
                </text>
              </box>
            )}
          </For>
        </Show>
      </box>
      <Show when={props.todo().length > 0 && props.todo().some((t) => t.status !== "completed")}>
        <box>
          <box
            flexDirection="row"
            gap={1}
            onMouseDown={() => props.todo().length > 2 && props.setExpanded("todo", !props.expanded.todo)}
          >
            <Show when={props.todo().length > 2}>
              <text fg={props.theme.text}>{props.expanded.todo ? "v" : ">"}</text>
            </Show>
            <text fg={props.theme.text}>
              <b>Todo</b>
            </text>
          </box>
          <Show when={props.todo().length <= 2 || props.expanded.todo}>
            <For each={props.todo()}>
              {(todo) => (
                <text style={{ fg: todo.status === "in_progress" ? props.theme.success : props.theme.textMuted }}>
                  [{todo.status === "completed" ? "x" : " "}] {todo.content}
                </text>
              )}
            </For>
          </Show>
        </box>
      </Show>
      <Show when={props.diff().length > 0}>
        <box>
          <box
            flexDirection="row"
            gap={1}
            onMouseDown={() => props.diff().length > 2 && props.setExpanded("diff", !props.expanded.diff)}
          >
            <Show when={props.diff().length > 2}>
              <text fg={props.theme.text}>{props.expanded.diff ? "v" : ">"}</text>
            </Show>
            <text fg={props.theme.text}>
              <b>Modified Files</b>
            </text>
          </box>
          <Show when={props.diff().length <= 2 || props.expanded.diff}>
            <For each={props.diff() || []}>
              {(item) => {
                const file = createMemo(() => {
                  const splits = item.file.split(path.sep).filter(Boolean)
                  const last = splits.at(-1)!
                  const rest = splits.slice(0, -1).join(path.sep)
                  if (!rest) return last
                  return Locale.truncateMiddle(rest, 30 - last.length) + "/" + last
                })
                return (
                  <box flexDirection="row" gap={1} justifyContent="space-between">
                    <text fg={props.theme.textMuted} wrapMode="char">
                      {file()}
                    </text>
                    <box flexDirection="row" gap={1} flexShrink={0}>
                      <Show when={item.additions}>
                        <text fg={props.theme.diffAdded}>+{item.additions}</text>
                      </Show>
                      <Show when={item.deletions}>
                        <text fg={props.theme.diffRemoved}>-{item.deletions}</text>
                      </Show>
                    </box>
                  </box>
                )
              }}
            </For>
          </Show>
        </box>
      </Show>
      {/* Compact panels for quick access */}
      <AFSPanel />
      <AgentsPanel />
      <OrchestrationPanel />
      <CognitivePanel />
      <StatePanel />
    </box>
  )
}
