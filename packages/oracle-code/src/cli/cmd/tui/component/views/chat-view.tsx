import { createContext, createMemo, createSignal, For, Show, Switch, Match, useContext } from "solid-js"
import { Dynamic } from "solid-js/web"
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"
import { useLocal } from "../../context/local"
import { SplitBorder } from "../border"
import { Locale } from "@/util/locale"
import type { AssistantMessage, Part, ToolPart, UserMessage, TextPart as TextPartType, ReasoningPart as ReasoningPartType } from "@oracle-code/sdk/v2"

/**
 * ChatView - Read-only chat message display for panes
 *
 * A simplified version of session/index.tsx message rendering
 * designed for pane embedding. This is read-only - no prompt integration.
 *
 * Use cases:
 * - Viewing a different session in a split pane
 * - Monitoring subagent sessions
 * - Reviewing session history
 */

export interface ChatViewProps {
  /** Session ID to display messages from */
  sessionID: string
  /** Whether this pane is currently active/focused */
  isActive?: boolean
  /** Display options */
  displayOptions?: {
    showThinking?: boolean
    showTimestamps?: boolean
    showUsername?: boolean
    showToolDetails?: boolean
  }
}

// Internal context for chat view components
const ChatViewContext = createContext<{
  showThinking: () => boolean
  showTimestamps: () => boolean
  showUsername: () => boolean
  showDetails: () => boolean
  sync: ReturnType<typeof useSync>
}>()

function useChatViewContext() {
  const ctx = useContext(ChatViewContext)
  if (!ctx) throw new Error("useChatViewContext must be used within ChatView")
  return ctx
}

export function ChatView(props: ChatViewProps) {
  const sync = useSync()
  const { theme } = useTheme()
  const local = useLocal()

  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])
  const session = createMemo(() => sync.session.get(props.sessionID))

  // Display options with defaults
  const showThinking = createMemo(() => props.displayOptions?.showThinking ?? true)
  const showTimestamps = createMemo(() => props.displayOptions?.showTimestamps ?? false)
  const showUsername = createMemo(() => props.displayOptions?.showUsername ?? false)
  const showDetails = createMemo(() => props.displayOptions?.showToolDetails ?? true)

  const pending = createMemo(() => {
    return messages().findLast((x) => x.role === "assistant" && !x.time.completed)?.id
  })

  const lastAssistant = createMemo(() => {
    return messages().findLast((x) => x.role === "assistant")
  })

  const hasMessages = createMemo(() => messages().length > 0)

  return (
    <ChatViewContext.Provider
      value={{
        showThinking,
        showTimestamps,
        showUsername,
        showDetails,
        sync,
      }}
    >
      <box flexGrow={1} flexDirection="column" overflow="hidden">
        <Show
          when={hasMessages()}
          fallback={
            <box flexGrow={1} justifyContent="center" alignItems="center">
              <text fg={theme.textMuted}>No messages in this session</text>
              <Show when={session()}>
                <text fg={theme.textMuted} marginTop={1}>
                  Session: {session()?.title || props.sessionID}
                </text>
              </Show>
            </box>
          }
        >
          <scrollbox flexGrow={1} paddingLeft={1} paddingRight={1} stickyScroll={true} stickyStart="bottom">
            <For each={messages()}>
              {(message, index) => (
                <Switch>
                  <Match when={message.role === "user"}>
                    <UserMessageView
                      index={index()}
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
        </Show>

        {/* Status bar */}
        <box
          height={1}
          backgroundColor={theme.backgroundElement}
          paddingLeft={1}
          paddingRight={1}
          flexDirection="row"
          justifyContent="space-between"
          flexShrink={0}
        >
          <text fg={theme.textMuted}>
            {messages().length} messages
            <Show when={pending()}>
              <span style={{ fg: theme.warning }}> (streaming...)</span>
            </Show>
          </text>
          <text fg={theme.textMuted}>{session()?.title || "Session"}</text>
        </box>
      </box>
    </ChatViewContext.Provider>
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
  index: number
  pending?: string
}) {
  const ctx = useChatViewContext()
  const local = useLocal()
  const { theme } = useTheme()

  const text = createMemo(() => props.parts.flatMap((x) => (x.type === "text" && !x.synthetic ? [x] : []))[0])
  const files = createMemo(() => props.parts.flatMap((x) => (x.type === "file" ? [x] : [])))
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
          <box paddingTop={1} paddingBottom={1} paddingLeft={2} backgroundColor={theme.backgroundPanel} flexShrink={0}>
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
              {ctx.showUsername() ? `${ctx.sync.data.config.username ?? "You "}` : "You "}
              <Show
                when={queued()}
                fallback={
                  <Show when={ctx.showTimestamps()}>
                    <span style={{ fg: theme.textMuted }}>
                      {ctx.showUsername() ? " · " : " "}
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
  const ctx = useChatViewContext()
  const messages = createMemo(() => ctx.sync.data.message[props.message.sessionID] ?? [])

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

// Simplified part mapping - text and reasoning only for now
// Tools are rendered as summaries rather than full interactive display
const PART_MAPPING = {
  text: TextPartView,
  tool: ToolPartView,
  reasoning: ReasoningPartView,
}

function ReasoningPartView(props: { last: boolean; part: ReasoningPartType; message: AssistantMessage }) {
  const { theme, subtleSyntax } = useTheme()
  const ctx = useChatViewContext()
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
          conceal={true}
          fg={theme.textMuted}
        />
      </box>
    </Show>
  )
}

function TextPartView(props: { last: boolean; part: TextPartType; message: AssistantMessage }) {
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
          conceal={true}
          fg={theme.text}
        />
      </box>
    </Show>
  )
}

function ToolPartView(props: { last: boolean; part: ToolPart; message: AssistantMessage }) {
  const { theme } = useTheme()
  const ctx = useChatViewContext()

  // Simplified tool display - just show name and status
  const shouldShow = createMemo(() => {
    if (!ctx.showDetails()) return false
    // Always show pending/error, optionally hide completed
    return props.part.state.status !== "completed" || ctx.showDetails()
  })

  const statusIcon = createMemo(() => {
    switch (props.part.state.status) {
      case "pending":
        return "◌"
      case "completed":
        return "✓"
      case "error":
        return "✗"
      default:
        return "·"
    }
  })

  const statusColor = createMemo(() => {
    switch (props.part.state.status) {
      case "pending":
        return theme.warning
      case "completed":
        return theme.success
      case "error":
        return theme.error
      default:
        return theme.textMuted
    }
  })

  const errorMessage = createMemo(() => {
    if (props.part.state.status === "error" && "error" in props.part.state) {
      return (props.part.state as { error: string }).error
    }
    return null
  })

  return (
    <Show when={shouldShow()}>
      <box paddingLeft={3} marginTop={1}>
        <text fg={theme.textMuted}>
          <span style={{ fg: statusColor() }}>{statusIcon()}</span> {props.part.tool}
          <Show when={errorMessage()}>
            <span style={{ fg: theme.error }}> - {errorMessage()}</span>
          </Show>
        </text>
      </box>
    </Show>
  )
}
