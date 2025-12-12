import { For, Show, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme } from "../context/theme"
import { useAFS } from "../context/afs"
import type { AFS } from "@/afs"

export function AFSPanel() {
  const afs = useAFS()
  const { theme } = useTheme()

  const [expanded, setExpanded] = createStore({
    afs: true,
    directories: {} as Record<string, boolean>,
  })

  const policyColor = (policy: AFS.Policy) => {
    switch (policy) {
      case "writable":
        return theme.success
      case "executable":
        return theme.warning
      case "read_only":
      default:
        return theme.textMuted
    }
  }

  const policyIcon = (policy: AFS.Policy) => {
    switch (policy) {
      case "writable":
        return "[W]"
      case "executable":
        return "[X]"
      case "read_only":
      default:
        return "[R]"
    }
  }

  const totalFiles = createMemo(() =>
    afs.directories.reduce((sum, d) => sum + d.fileCount, 0),
  )

  return (
    <box>
      <box
        flexDirection="row"
        gap={1}
        onMouseDown={() => setExpanded("afs", !expanded.afs)}
      >
        <text fg={theme.text}>{expanded.afs ? "▼" : "▶"}</text>
        <text fg={afs.exists ? theme.success : theme.textMuted}>●</text>
        <text fg={theme.text}>
          <b>AFS Context</b>
        </text>
        <Show when={afs.exists} fallback={<text fg={theme.textMuted}>(not found)</text>}>
          <text fg={theme.textMuted}>({totalFiles()} files)</text>
        </Show>
      </box>
      <Show when={expanded.afs}>
        <Show when={!afs.exists}>
          <box paddingLeft={2}>
            <text fg={theme.textMuted}>No .context directory found.</text>
            <text fg={theme.textMuted}>Run 'ocode afs init' to initialize.</text>
          </box>
        </Show>
        <Show when={afs.exists}>
          <For each={afs.directories}>
            {(dir) => (
              <box paddingLeft={1}>
                <box
                  flexDirection="row"
                  gap={1}
                  onMouseDown={() =>
                    dir.fileCount > 0 &&
                    setExpanded("directories", dir.name, !expanded.directories[dir.name])
                  }
                >
                  <Show when={dir.fileCount > 0}>
                    <text fg={theme.textMuted}>
                      {expanded.directories[dir.name] ? "▼" : "▶"}
                    </text>
                  </Show>
                  <Show when={dir.fileCount === 0}>
                    <text fg={theme.textMuted}>·</text>
                  </Show>
                  <text fg={policyColor(dir.policy)}>{policyIcon(dir.policy)}</text>
                  <text fg={theme.text}>{dir.name}/</text>
                  <Show when={dir.fileCount > 0}>
                    <text fg={theme.textMuted}>({dir.fileCount})</text>
                  </Show>
                  <Show when={!dir.exists}>
                    <text fg={theme.textMuted}>(not created)</text>
                  </Show>
                </box>
                <Show when={expanded.directories[dir.name] && dir.files.length > 0}>
                  <For each={dir.files.filter((f) => !f.isDirectory).slice(0, 10)}>
                    {(file) => (
                      <box flexDirection="row" gap={1} paddingLeft={2}>
                        <text fg={theme.textMuted}>📄 {file.name}</text>
                      </box>
                    )}
                  </For>
                  <Show when={dir.files.filter((f) => !f.isDirectory).length > 10}>
                    <text fg={theme.textMuted} paddingLeft={2}>
                      ... and {dir.files.filter((f) => !f.isDirectory).length - 10} more
                    </text>
                  </Show>
                </Show>
              </box>
            )}
          </For>
          <Show when={afs.planExists}>
            <box flexDirection="row" gap={1} paddingLeft={1} paddingTop={1}>
              <text fg={theme.success}>📋</text>
              <text fg={theme.text}>plan.md</text>
              <text fg={theme.textMuted}>(active)</text>
            </box>
          </Show>
        </Show>
      </Show>
    </box>
  )
}
