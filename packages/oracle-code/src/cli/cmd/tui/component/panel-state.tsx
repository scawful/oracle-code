import { For, Show, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme } from "../context/theme"
import { useSync } from "../context/sync"
import type { State } from "@/state"

const SECTION_ORDER: State.Section[] = ["facts", "assumptions", "decisions", "uncertainties", "goals", "context"]

export function StatePanel() {
  const sync = useSync()
  const { theme } = useTheme()

  const [expanded, setExpanded] = createStore({
    state: true,
    sections: {} as Record<string, boolean>,
  })

  const sectionColor = (section: State.Section) => {
    switch (section) {
      case "facts":
        return theme.success
      case "assumptions":
        return theme.warning
      case "decisions":
        return theme.primary
      case "uncertainties":
        return theme.textMuted
      case "goals":
        return theme.accent
      case "context":
      default:
        return theme.text
    }
  }

  const sectionIcon = (section: State.Section) => {
    switch (section) {
      case "facts":
        return "✓"
      case "assumptions":
        return "?"
      case "decisions":
        return "→"
      case "uncertainties":
        return "~"
      case "goals":
        return "◎"
      case "context":
      default:
        return "•"
    }
  }

  const entries = createMemo(() => sync.data.state?.entries ?? [])
  const totalEntries = createMemo(() => entries().length)

  const groupedEntries = createMemo(() => {
    const groups = new Map<State.Section, State.StateEntry[]>()
    for (const entry of entries()) {
      const list = groups.get(entry.section) || []
      list.push(entry)
      groups.set(entry.section, list)
    }
    return groups
  })

  const sectionsWithEntries = createMemo(() =>
    SECTION_ORDER.filter((s) => (groupedEntries().get(s)?.length ?? 0) > 0),
  )

  const truncateValue = (value: string, maxLen: number = 25) => {
    if (value.length <= maxLen) return value
    return value.slice(0, maxLen - 3) + "..."
  }

  return (
    <Show when={totalEntries() > 0}>
      <box marginTop={1}>
        <box flexDirection="row" gap={1} onMouseDown={() => setExpanded("state", !expanded.state)}>
          <text fg={theme.text}>{expanded.state ? "▼" : "▶"}</text>
          <text fg={theme.text}>
            <b>Shared State</b>
          </text>
          <text fg={theme.textMuted}>({totalEntries()})</text>
        </box>
        <Show when={expanded.state}>
          <For each={sectionsWithEntries()}>
            {(section) => {
              const sectionEntries = createMemo(() => groupedEntries().get(section) || [])
              return (
                <box paddingLeft={1}>
                  <box
                    flexDirection="row"
                    gap={1}
                    onMouseDown={() =>
                      sectionEntries().length > 0 &&
                      setExpanded("sections", section, !expanded.sections[section])
                    }
                  >
                    <Show when={sectionEntries().length > 0}>
                      <text fg={theme.textMuted}>{expanded.sections[section] ? "▼" : "▶"}</text>
                    </Show>
                    <text fg={sectionColor(section)}>{sectionIcon(section)}</text>
                    <text fg={theme.text}>{section.charAt(0).toUpperCase() + section.slice(1)}</text>
                    <text fg={theme.textMuted}>({sectionEntries().length})</text>
                  </box>
                  <Show when={expanded.sections[section]}>
                    <For each={sectionEntries().slice(0, 5)}>
                      {(entry) => (
                        <box flexDirection="row" gap={1} paddingLeft={2}>
                          <text fg={theme.text}>
                            <b>{entry.key}</b>:
                          </text>
                          <text fg={theme.textMuted}>{truncateValue(entry.value)}</text>
                        </box>
                      )}
                    </For>
                    <Show when={sectionEntries().length > 5}>
                      <text fg={theme.textMuted} paddingLeft={2}>
                        ... and {sectionEntries().length - 5} more
                      </text>
                    </Show>
                  </Show>
                </box>
              )
            }}
          </For>
        </Show>
      </box>
    </Show>
  )
}
