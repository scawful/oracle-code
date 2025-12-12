import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  on,
  Show,
  Switch,
  useContext,
  type Component,
} from "solid-js"
import { Dynamic } from "solid-js/web"
import path from "path"
import { useSync } from "@tui/context/sync"
import { SplitBorder } from "@tui/component/border"
import { useTheme } from "@tui/context/theme"
import {
  BoxRenderable,
  ScrollBoxRenderable,
  addDefaultParsers,
  MacOSScrollAccel,
  type ScrollAcceleration,
} from "@opentui/core"
import type { AssistantMessage, Part, ToolPart, UserMessage, TextPart, ReasoningPart } from "@oracle-code/sdk/v2"
import { useLocal } from "@tui/context/local"
import { Locale } from "@/util/locale"
import type { Tool } from "@/tool/tool"
import type { ReadTool } from "@/tool/read"
import type { WriteTool } from "@/tool/write"
import { BashTool } from "@/tool/bash"
import type { GlobTool } from "@/tool/glob"
import { TodoWriteTool } from "@/tool/todo"
import type { GrepTool } from "@/tool/grep"
import type { ListTool } from "@/tool/ls"
import type { EditTool } from "@/tool/edit"
import type { PatchTool } from "@/tool/patch"
import type { WebFetchTool } from "@/tool/webfetch"
import type { TaskTool } from "@/tool/task"
import { useRenderer, type BoxProps, type JSX } from "@opentui/solid"
import { useKeybind } from "@tui/context/keybind"
import { parsePatch } from "diff"
import { useDialog } from "@tui/ui/dialog"
import { DialogConfirm } from "@tui/ui/dialog-confirm"
import { useCommandDialog } from "@tui/component/dialog-command"
import { LANGUAGE_EXTENSIONS } from "@/lsp/language"
import stripAnsi from "strip-ansi"

/**
 * SessionChatPane - The main interactive chat view for session route
 *
 * This is the full-featured chat pane that includes:
 * - Message rendering with tool parts
 * - Scroll handling with acceleration
 * - Permission overlays
 * - Revert state handling
 *
 * Unlike ChatView (read-only), this component is designed
 * for the main interactive session experience.
 */

class CustomSpeedScroll implements ScrollAcceleration {
  constructor(private speed: number) {}

  tick(_now?: number): number {
    return this.speed
  }

  reset(): void {}
}

export interface SessionChatPaneProps {
  sessionID: string
  isActive?: boolean
  /** Content width for diff rendering */
  contentWidth: number
  /** Display options */
  conceal: () => boolean
  showThinking: () => boolean
  showTimestamps: () => boolean
  usernameVisible: () => boolean
  showDetails: () => boolean
  diffWrapMode: () => "word" | "none"
  showScrollbar: () => boolean
  /** Ref callback for scroll control */
  onScrollRef?: (scroll: ScrollBoxRenderable) => void
  /** Callback for message click */
  onMessageClick?: (messageID: string) => void
  /** Revert state */
  revert?: {
    messageID: string
    reverted: UserMessage[]
    diff?: string
    diffFiles: Array<{ filename: string; additions: number; deletions: number }>
  }
}

const context = createContext<{
  width: number
  conceal: () => boolean
  showThinking: () => boolean
  showTimestamps: () => boolean
  usernameVisible: () => boolean
  showDetails: () => boolean
  diffWrapMode: () => "word" | "none"
  sync: ReturnType<typeof useSync>
}>()

function use() {
  const ctx = useContext(context)
  if (!ctx) throw new Error("useContext must be used within SessionChatPane")
  return ctx
}

export function SessionChatPane(props: SessionChatPaneProps) {
  const sync = useSync()
  const { theme } = useTheme()
  const keybind = useKeybind()

  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])

  const pending = createMemo(() => {
    return messages().findLast((x) => x.role === "assistant" && !x.time.completed)?.id
  })

  const lastAssistant = createMemo(() => {
    return messages().findLast((x) => x.role === "assistant")
  })

  const scrollAcceleration = createMemo(() => {
    const tui = sync.data.config.tui
    if (tui?.scroll_acceleration?.enabled) {
      return new MacOSScrollAccel()
    }
    if (tui?.scroll_speed) {
      return new CustomSpeedScroll(tui.scroll_speed)
    }
    return new CustomSpeedScroll(3)
  })

  let scroll: ScrollBoxRenderable

  return (
    <context.Provider
      value={{
        get width() {
          return props.contentWidth
        },
        conceal: props.conceal,
        showThinking: props.showThinking,
        showTimestamps: props.showTimestamps,
        usernameVisible: props.usernameVisible,
        showDetails: props.showDetails,
        diffWrapMode: props.diffWrapMode,
        sync,
      }}
    >
      <scrollbox
        ref={(r) => {
          scroll = r
          props.onScrollRef?.(r)
        }}
        verticalScrollbarOptions={{
          paddingLeft: 1,
          visible: props.showScrollbar(),
          trackOptions: {
            backgroundColor: theme.backgroundElement,
            foregroundColor: theme.border,
          },
        }}
        stickyScroll={true}
        stickyStart="bottom"
        flexGrow={1}
        scrollAcceleration={scrollAcceleration()}
      >
        <For each={messages()}>
          {(message, index) => (
            <Switch>
              <Match when={message.id === props.revert?.messageID}>
                <RevertIndicator
                  revert={props.revert!}
                  onUnrevert={() => {
                    // Handled by parent
                  }}
                />
              </Match>
              <Match when={props.revert?.messageID && message.id >= props.revert.messageID}>
                <></>
              </Match>
              <Match when={message.role === "user"}>
                <UserMessageView
                  index={index()}
                  onMouseUp={() => props.onMessageClick?.(message.id)}
                  message={message as UserMessage}
                  parts={sync.data.part[message.id] ?? []}
                  pending={pending()}
                />
              </Match>
              <Match when={message.role === "assistant"}>
                <AssistantMessageView
                  last={lastAssistant()?.id === message.id}
                  message={message as AssistantMessage}
                  parts={sync.data.part[message.id] ?? []}
                />
              </Match>
            </Switch>
          )}
        </For>
      </scrollbox>
    </context.Provider>
  )
}

function RevertIndicator(props: { revert: NonNullable<SessionChatPaneProps["revert"]>; onUnrevert: () => void }) {
  const { theme } = useTheme()
  const keybind = useKeybind()
  const [hover, setHover] = createSignal(false)

  return (
    <box
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseUp={props.onUnrevert}
      marginTop={1}
      flexShrink={0}
      border={["left"]}
      customBorderChars={SplitBorder.customBorderChars}
      borderColor={theme.backgroundPanel}
    >
      <box
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        backgroundColor={hover() ? theme.backgroundElement : theme.backgroundPanel}
      >
        <text fg={theme.textMuted}>{props.revert.reverted.length} message reverted</text>
        <text fg={theme.textMuted}>
          <span style={{ fg: theme.text }}>{keybind.print("messages_redo")}</span> or /redo to restore
        </text>
        <Show when={props.revert.diffFiles?.length}>
          <box marginTop={1}>
            <For each={props.revert.diffFiles}>
              {(file) => (
                <text fg={theme.text}>
                  {file.filename}
                  <Show when={file.additions > 0}>
                    <span style={{ fg: theme.diffAdded }}> +{file.additions}</span>
                  </Show>
                  <Show when={file.deletions > 0}>
                    <span style={{ fg: theme.diffRemoved }}> -{file.deletions}</span>
                  </Show>
                </text>
              )}
            </For>
          </box>
        </Show>
      </box>
    </box>
  )
}

const MIME_BADGE: Record<string, string> = {
  "text/plain": "txt",
  "image/png": "img",
  "image/jpeg": "img",
  "image/gif": "img",
  "image/webp": "img",
  "application/pdf": "pdf",
  "application/x-directory": "dir",
}

function UserMessageView(props: {
  message: UserMessage
  parts: Part[]
  onMouseUp: () => void
  index: number
  pending?: string
}) {
  const ctx = use()
  const local = useLocal()
  const text = createMemo(() => props.parts.flatMap((x) => (x.type === "text" && !x.synthetic ? [x] : []))[0])
  const files = createMemo(() => props.parts.flatMap((x) => (x.type === "file" ? [x] : [])))
  const sync = useSync()
  const { theme } = useTheme()
  const [hover, setHover] = createSignal(false)
  const queued = createMemo(() => props.pending && props.message.id > props.pending)
  const color = createMemo(() => (queued() ? theme.accent : local.agent.color(props.message.agent)))

  const compaction = createMemo(() => props.parts.find((x) => x.type === "compaction"))

  return (
    <>
      <Show when={text()}>
        <box
          id={props.message.id}
          border={["left"]}
          borderColor={color()}
          customBorderChars={SplitBorder.customBorderChars}
          marginTop={props.index === 0 ? 0 : 1}
        >
          <box
            onMouseOver={() => setHover(true)}
            onMouseOut={() => setHover(false)}
            onMouseUp={props.onMouseUp}
            paddingTop={1}
            paddingBottom={1}
            paddingLeft={2}
            backgroundColor={hover() ? theme.backgroundElement : theme.backgroundPanel}
            flexShrink={0}
          >
            <text fg={theme.text}>{text()?.text}</text>
            <Show when={files().length}>
              <box flexDirection="row" paddingBottom={1} paddingTop={1} gap={1} flexWrap="wrap">
                <For each={files()}>
                  {(file) => {
                    const bg = createMemo(() => {
                      if (file.mime.startsWith("image/")) return theme.accent
                      if (file.mime === "application/pdf") return theme.primary
                      return theme.secondary
                    })
                    return (
                      <text fg={theme.text}>
                        <span style={{ bg: bg(), fg: theme.background }}> {MIME_BADGE[file.mime] ?? file.mime} </span>
                        <span style={{ bg: theme.backgroundElement, fg: theme.textMuted }}> {file.filename} </span>
                      </text>
                    )
                  }}
                </For>
              </box>
            </Show>
            <text fg={theme.textMuted}>
              {ctx.usernameVisible() ? `${sync.data.config.username ?? "You "}` : "You "}
              <Show
                when={queued()}
                fallback={
                  <Show when={ctx.showTimestamps()}>
                    <span style={{ fg: theme.textMuted }}>
                      {ctx.usernameVisible() ? " · " : " "}
                      {Locale.todayTimeOrDateTime(props.message.time.created)}
                    </span>
                  </Show>
                }
              >
                <span> </span>
                <span style={{ bg: theme.accent, fg: theme.backgroundPanel, bold: true }}> QUEUED </span>
              </Show>
            </text>
          </box>
        </box>
      </Show>
      <Show when={compaction()}>
        <box marginTop={1} border={["top"]} title=" Compaction " titleAlignment="center" borderColor={theme.borderActive} />
      </Show>
    </>
  )
}

function AssistantMessageView(props: { message: AssistantMessage; parts: Part[]; last: boolean }) {
  const local = useLocal()
  const { theme } = useTheme()
  const sync = useSync()
  const messages = createMemo(() => sync.data.message[props.message.sessionID] ?? [])

  const final = createMemo(() => {
    return props.message.finish && !["tool-calls", "unknown"].includes(props.message.finish)
  })

  const duration = createMemo(() => {
    if (!final()) return 0
    if (!props.message.time.completed) return 0
    const user = messages().find((x) => x.role === "user" && x.id === props.message.parentID)
    if (!user || !user.time) return 0
    return props.message.time.completed - user.time.created
  })

  return (
    <>
      <For each={props.parts}>
        {(part, index) => {
          const component = createMemo(() => PART_MAPPING[part.type as keyof typeof PART_MAPPING])
          return (
            <Show when={component()}>
              <Dynamic
                last={index() === props.parts.length - 1}
                component={component()}
                part={part as any}
                message={props.message}
              />
            </Show>
          )
        }}
      </For>
      <Show when={props.message.error}>
        <box
          border={["left"]}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          marginTop={1}
          backgroundColor={theme.backgroundPanel}
          customBorderChars={SplitBorder.customBorderChars}
          borderColor={theme.error}
        >
          <text fg={theme.textMuted}>{props.message.error?.data.message}</text>
        </box>
      </Show>
      <Switch>
        <Match when={props.last || final()}>
          <box paddingLeft={3}>
            <text marginTop={1}>
              <span style={{ fg: local.agent.color(props.message.mode) }}>▣ </span>{" "}
              <span style={{ fg: theme.text }}>{Locale.titlecase(props.message.mode)}</span>
              <span style={{ fg: theme.textMuted }}> · {props.message.modelID}</span>
              <Show when={duration()}>
                <span style={{ fg: theme.textMuted }}> · {Locale.duration(duration())}</span>
              </Show>
            </text>
          </box>
        </Match>
      </Switch>
    </>
  )
}

const PART_MAPPING = {
  text: TextPartView,
  tool: ToolPartView,
  reasoning: ReasoningPartView,
}

function ReasoningPartView(props: { last: boolean; part: ReasoningPart; message: AssistantMessage }) {
  const { theme, subtleSyntax } = useTheme()
  const ctx = use()
  const content = createMemo(() => {
    return props.part.text.replace("[REDACTED]", "").trim()
  })
  return (
    <Show when={content() && ctx.showThinking()}>
      <box
        id={"text-" + props.part.id}
        paddingLeft={2}
        marginTop={1}
        flexDirection="column"
        border={["left"]}
        customBorderChars={SplitBorder.customBorderChars}
        borderColor={theme.backgroundElement}
      >
        <code
          filetype="markdown"
          drawUnstyledText={false}
          streaming={true}
          syntaxStyle={subtleSyntax()}
          content={"_Thinking:_ " + content()}
          conceal={ctx.conceal()}
          fg={theme.textMuted}
        />
      </box>
    </Show>
  )
}

function TextPartView(props: { last: boolean; part: TextPart; message: AssistantMessage }) {
  const ctx = use()
  const { theme, syntax } = useTheme()
  return (
    <Show when={props.part.text.trim()}>
      <box id={"text-" + props.part.id} paddingLeft={3} marginTop={1} flexShrink={0}>
        <code
          filetype="markdown"
          drawUnstyledText={false}
          streaming={true}
          syntaxStyle={syntax()}
          content={props.part.text.trim()}
          conceal={ctx.conceal()}
          fg={theme.text}
        />
      </box>
    </Show>
  )
}

function ToolPartView(props: { last: boolean; part: ToolPart; message: AssistantMessage }) {
  const { theme } = useTheme()
  const { showDetails } = use()
  const sync = useSync()
  const [margin, setMargin] = createSignal(0)
  const component = createMemo(() => {
    const shouldHide =
      !showDetails() &&
      props.part.state.status === "completed" &&
      !sync.data.permission[props.message.sessionID]?.some((x) => x.callID === props.part.callID)

    if (shouldHide) {
      return undefined
    }

    const render = ToolRegistry.render(props.part.tool) ?? GenericTool

    const metadata = props.part.state.status === "pending" ? {} : (props.part.state.metadata ?? {})
    const input = props.part.state.input ?? {}
    const container = ToolRegistry.container(props.part.tool)
    const permissions = sync.data.permission[props.message.sessionID] ?? []
    const permissionIndex = permissions.findIndex((x) => x.callID === props.part.callID)
    const permission = permissions[permissionIndex]

    const style: BoxProps =
      container === "block" || permission
        ? {
            border: permissionIndex === 0 ? (["left", "right"] as const) : (["left"] as const),
            paddingTop: 1,
            paddingBottom: 1,
            paddingLeft: 2,
            marginTop: 1,
            gap: 1,
            backgroundColor: theme.backgroundPanel,
            customBorderChars: SplitBorder.customBorderChars,
            borderColor: permissionIndex === 0 ? theme.warning : theme.background,
          }
        : {
            paddingLeft: 3,
          }

    return (
      <box
        marginTop={margin()}
        {...style}
        renderBefore={function () {
          const el = this as BoxRenderable
          const parent = el.parent
          if (!parent) return
          if (el.height > 1) {
            setMargin(1)
            return
          }
          const children = parent.getChildren()
          const index = children.indexOf(el)
          const previous = children[index - 1]
          if (!previous) {
            setMargin(0)
            return
          }
          if (previous.height > 1 || previous.id.startsWith("text-")) {
            setMargin(1)
            return
          }
        }}
      >
        <Dynamic
          component={render}
          input={input}
          tool={props.part.tool}
          metadata={metadata}
          permission={permission?.metadata ?? {}}
          output={props.part.state.status === "completed" ? props.part.state.output : undefined}
        />
        {props.part.state.status === "error" && (
          <box paddingLeft={2}>
            <text fg={theme.error}>{props.part.state.error.replace("Error: ", "")}</text>
          </box>
        )}
        {permission && (
          <box gap={1}>
            <text fg={theme.text}>Permission required to run this tool:</text>
            <box flexDirection="row" gap={2}>
              <text fg={theme.text}>
                <b>enter</b>
                <span style={{ fg: theme.textMuted }}> accept</span>
              </text>
              <text fg={theme.text}>
                <b>a</b>
                <span style={{ fg: theme.textMuted }}> accept always</span>
              </text>
              <text fg={theme.text}>
                <b>d</b>
                <span style={{ fg: theme.textMuted }}> deny</span>
              </text>
            </box>
          </box>
        )}
      </box>
    )
  })

  return <Show when={component()}>{component()}</Show>
}

// Tool registry types and helpers
type ToolProps<T extends Tool.Info> = {
  input: Partial<Tool.InferParameters<T>>
  metadata: Partial<Tool.InferMetadata<T>>
  permission: Record<string, any>
  tool: string
  output?: string
}

function GenericTool(props: ToolProps<any>) {
  return (
    <ToolTitle icon="⚙" fallback="Writing command..." when={true}>
      {props.tool} {formatInput(props.input)}
    </ToolTitle>
  )
}

type ToolRegistration<T extends Tool.Info = any> = {
  name: string
  container: "inline" | "block"
  render?: Component<ToolProps<T>>
}

const ToolRegistry = (() => {
  const state: Record<string, ToolRegistration> = {}
  function register<T extends Tool.Info>(input: ToolRegistration<T>) {
    state[input.name] = input
    return input
  }
  return {
    register,
    container(name: string) {
      return state[name]?.container
    },
    render(name: string) {
      return state[name]?.render
    },
  }
})()

function ToolTitle(props: { fallback: string; when: any; icon: string; children: JSX.Element }) {
  const { theme } = useTheme()
  return (
    <text paddingLeft={3} fg={props.when ? theme.textMuted : theme.text}>
      <Show fallback={<>~ {props.fallback}</>} when={props.when}>
        <span style={{ bold: true }}>{props.icon}</span> {props.children}
      </Show>
    </text>
  )
}

// Register tools
ToolRegistry.register<typeof BashTool>({
  name: "bash",
  container: "block",
  render(props) {
    const output = createMemo(() => stripAnsi(props.metadata.output?.trim() ?? ""))
    const { theme } = useTheme()
    return (
      <>
        <ToolTitle icon="#" fallback="Writing command..." when={props.input.command}>
          {props.input.description || "Shell"}
        </ToolTitle>
        <Show when={props.input.command}>
          <text fg={theme.text}>$ {props.input.command}</text>
        </Show>
        <Show when={output()}>
          <box>
            <text fg={theme.text}>{output()}</text>
          </box>
        </Show>
      </>
    )
  },
})

ToolRegistry.register<typeof ReadTool>({
  name: "read",
  container: "inline",
  render(props) {
    return (
      <ToolTitle icon="→" fallback="Reading file..." when={props.input.filePath}>
        Read {normalizePath(props.input.filePath!)} {formatInput(props.input, ["filePath"])}
      </ToolTitle>
    )
  },
})

ToolRegistry.register<typeof WriteTool>({
  name: "write",
  container: "block",
  render(props) {
    const { theme, syntax } = useTheme()
    const code = createMemo(() => props.input.content ?? "")
    const diagnostics = createMemo(() => props.metadata.diagnostics?.[props.input.filePath ?? ""] ?? [])

    return (
      <>
        <ToolTitle icon="←" fallback="Preparing write..." when={props.input.filePath}>
          Wrote {props.input.filePath}
        </ToolTitle>
        <line_number fg={theme.textMuted} minWidth={3} paddingRight={1}>
          <code
            conceal={false}
            fg={theme.text}
            filetype={filetype(props.input.filePath!)}
            syntaxStyle={syntax()}
            content={code()}
          />
        </line_number>
        <Show when={diagnostics().length}>
          <For each={diagnostics()}>
            {(diagnostic) => (
              <text fg={theme.error}>
                Error [{diagnostic.range.start.line}:{diagnostic.range.start.character}]: {diagnostic.message}
              </text>
            )}
          </For>
        </Show>
      </>
    )
  },
})

ToolRegistry.register<typeof GlobTool>({
  name: "glob",
  container: "inline",
  render(props) {
    return (
      <ToolTitle icon="✱" fallback="Finding files..." when={props.input.pattern}>
        Glob "{props.input.pattern}" <Show when={props.input.path}>in {normalizePath(props.input.path)} </Show>
        <Show when={props.metadata.count}>({props.metadata.count} matches)</Show>
      </ToolTitle>
    )
  },
})

ToolRegistry.register<typeof GrepTool>({
  name: "grep",
  container: "inline",
  render(props) {
    return (
      <ToolTitle icon="✱" fallback="Searching content..." when={props.input.pattern}>
        Grep "{props.input.pattern}" <Show when={props.input.path}>in {normalizePath(props.input.path)} </Show>
        <Show when={props.metadata.matches}>({props.metadata.matches} matches)</Show>
      </ToolTitle>
    )
  },
})

ToolRegistry.register<typeof ListTool>({
  name: "list",
  container: "inline",
  render(props) {
    const dir = createMemo(() => (props.input.path ? normalizePath(props.input.path) : ""))
    return (
      <ToolTitle icon="→" fallback="Listing directory..." when={props.input.path !== undefined}>
        List {dir()}
      </ToolTitle>
    )
  },
})

ToolRegistry.register<typeof TaskTool>({
  name: "task",
  container: "block",
  render(props) {
    const { theme } = useTheme()
    const keybind = useKeybind()

    return (
      <>
        <ToolTitle icon="◉" fallback="Delegating..." when={props.input.subagent_type ?? props.input.description}>
          {Locale.titlecase(props.input.subagent_type ?? "unknown")} Task "{props.input.description}"
        </ToolTitle>
        <Show when={props.metadata.summary?.length}>
          <box>
            <For each={props.metadata.summary ?? []}>
              {(task, index) => {
                const summary = props.metadata.summary ?? []
                return (
                  <text style={{ fg: task.state.status === "error" ? theme.error : theme.textMuted }}>
                    {index() === summary.length - 1 ? "└" : "├"} {Locale.titlecase(task.tool)}{" "}
                    {task.state.status === "completed" ? task.state.title : ""}
                  </text>
                )
              }}
            </For>
          </box>
        </Show>
        <text fg={theme.text}>
          {keybind.print("session_child_cycle")}, {keybind.print("session_child_cycle_reverse")}
          <span style={{ fg: theme.textMuted }}> to navigate between subagent sessions</span>
        </text>
      </>
    )
  },
})

ToolRegistry.register<typeof WebFetchTool>({
  name: "webfetch",
  container: "inline",
  render(props) {
    return (
      <ToolTitle icon="%" fallback="Fetching from the web..." when={(props.input as any).url}>
        WebFetch {(props.input as any).url}
      </ToolTitle>
    )
  },
})

ToolRegistry.register({
  name: "codesearch",
  container: "inline",
  render(props: ToolProps<any>) {
    const input = props.input as any
    const metadata = props.metadata as any
    return (
      <ToolTitle icon="◇" fallback="Searching code..." when={input.query}>
        Exa Code Search "{input.query}" <Show when={metadata.results}>({metadata.results} results)</Show>
      </ToolTitle>
    )
  },
})

ToolRegistry.register({
  name: "websearch",
  container: "inline",
  render(props: ToolProps<any>) {
    const input = props.input as any
    const metadata = props.metadata as any
    return (
      <ToolTitle icon="◈" fallback="Searching web..." when={input.query}>
        Exa Web Search "{input.query}" <Show when={metadata.numResults}>({metadata.numResults} results)</Show>
      </ToolTitle>
    )
  },
})

ToolRegistry.register<typeof EditTool>({
  name: "edit",
  container: "block",
  render(props) {
    const ctx = use()
    const { theme, syntax } = useTheme()

    const view = createMemo(() => {
      const diffStyle = ctx.sync.data.config.tui?.diff_style
      if (diffStyle === "stacked") return "unified"
      return ctx.width > 120 ? "split" : "unified"
    })

    const ft = createMemo(() => filetype(props.input.filePath))
    const diffContent = createMemo(() => props.metadata.diff ?? props.permission["diff"])
    const diagnostics = createMemo(() => {
      const arr = props.metadata.diagnostics?.[props.input.filePath ?? ""] ?? []
      return arr.filter((x) => x.severity === 1).slice(0, 3)
    })

    return (
      <>
        <ToolTitle icon="←" fallback="Preparing edit..." when={props.input.filePath}>
          Edit {normalizePath(props.input.filePath!)} {formatInput({ replaceAll: props.input.replaceAll })}
        </ToolTitle>
        <Show when={diffContent()}>
          <box paddingLeft={1}>
            <diff
              diff={diffContent()}
              view={view()}
              filetype={ft()}
              syntaxStyle={syntax()}
              showLineNumbers={true}
              width="100%"
              wrapMode={ctx.diffWrapMode()}
              fg={theme.text}
              addedBg={theme.diffAddedBg}
              removedBg={theme.diffRemovedBg}
              contextBg={theme.diffContextBg}
              addedSignColor={theme.diffHighlightAdded}
              removedSignColor={theme.diffHighlightRemoved}
              lineNumberFg={theme.diffLineNumber}
              lineNumberBg={theme.diffContextBg}
              addedLineNumberBg={theme.diffAddedLineNumberBg}
              removedLineNumberBg={theme.diffRemovedLineNumberBg}
            />
          </box>
        </Show>
        <Show when={diagnostics().length}>
          <box>
            <For each={diagnostics()}>
              {(diagnostic) => (
                <text fg={theme.error}>
                  Error [{diagnostic.range.start.line + 1}:{diagnostic.range.start.character + 1}] {diagnostic.message}
                </text>
              )}
            </For>
          </box>
        </Show>
      </>
    )
  },
})

ToolRegistry.register<typeof PatchTool>({
  name: "patch",
  container: "block",
  render(props) {
    const { theme } = useTheme()
    return (
      <>
        <ToolTitle icon="%" fallback="Preparing patch..." when={true}>
          Patch
        </ToolTitle>
        <Show when={props.output}>
          <box>
            <text fg={theme.text}>{props.output?.trim()}</text>
          </box>
        </Show>
      </>
    )
  },
})

ToolRegistry.register<typeof TodoWriteTool>({
  name: "todowrite",
  container: "block",
  render(props) {
    const { theme } = useTheme()
    return (
      <>
        <Show when={!props.input.todos?.length}>
          <ToolTitle icon="⚙" fallback="Updating todos..." when={true}>
            Updating todos...
          </ToolTitle>
        </Show>
        <Show when={props.metadata.todos?.length}>
          <box>
            <For each={props.input.todos ?? []}>
              {(todo) => (
                <text style={{ fg: todo.status === "in_progress" ? theme.success : theme.textMuted }}>
                  [{todo.status === "completed" ? "✓" : " "}] {todo.content}
                </text>
              )}
            </For>
          </box>
        </Show>
      </>
    )
  },
})

// Utility functions
function normalizePath(input?: string) {
  if (!input) return ""
  if (path.isAbsolute(input)) {
    return path.relative(process.cwd(), input) || "."
  }
  return input
}

function formatInput(input: Record<string, any>, omit?: string[]): string {
  const primitives = Object.entries(input).filter(([key, value]) => {
    if (omit?.includes(key)) return false
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
  })
  if (primitives.length === 0) return ""
  return `[${primitives.map(([key, value]) => `${key}=${value}`).join(", ")}]`
}

function filetype(input?: string) {
  if (!input) return "none"
  const ext = path.extname(input)
  const language = LANGUAGE_EXTENSIONS[ext]
  if (["typescriptreact", "javascriptreact", "javascript"].includes(language)) return "typescript"
  return language
}
