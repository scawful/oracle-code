import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useAFS } from "../context/afs"
import { useDialog } from "../ui/dialog"
import { Show, For, createMemo, createSignal, createEffect, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import type { AFS } from "@/afs"
import * as path from "path"
import { useKeyboardMode, useKeyboardOwnership } from "../context/keyboard-mode"

type ViewMode = "tree" | "file"
type FileViewMode = "text" | "hex" | "markdown"

interface TreeItem {
  type: "directory" | "file"
  name: string
  path: string
  dirName?: string
  size?: number
  isExpanded?: boolean
  depth: number
}

/**
 * Full AFS browser dialog with vim navigation and file viewing
 */
export function DialogAFSBrowser() {
  const afs = useAFS()
  const { theme } = useTheme()
  const dialog = useDialog()
  const keyboard = useKeyboardMode()

  dialog.setSize("large")

  // Acquire keyboard ownership using the helper
  useKeyboardOwnership(
    "afs-browser",
    {
      mode: "vim-navigation",
      priority: 100,
      onKey: (evt) => handleKeyboard(evt),
    },
    keyboard,
  )

  // Clear timeout on cleanup
  onCleanup(() => {
    if (gPendingTimeout) {
      clearTimeout(gPendingTimeout)
      gPendingTimeout = null
    }
  })

  // View state
  const [viewMode, setViewMode] = createSignal<ViewMode>("tree")
  const [fileViewMode, setFileViewMode] = createSignal<FileViewMode>("text")
  const [selectedFile, setSelectedFile] = createSignal<string | null>(null)
  const [fileContent, setFileContent] = createSignal<string>("")
  const [fileError, setFileError] = createSignal<string | null>(null)
  const [scrollOffset, setScrollOffset] = createSignal(0)

  // Tree state - use paths as keys to support nested directories
  const [cursorIndex, setCursorIndex] = createSignal(0)
  const [expanded, setExpanded] = createStore<Record<string, boolean>>({
    memory: true,
    knowledge: false,
    tools: false,
    scratchpad: true,
    history: false,
  })

  // Helper to toggle expansion by path
  const toggleExpanded = (itemPath: string, dirName?: string) => {
    // For top-level dirs, use the name; for nested, use the full path
    const key = dirName === undefined ? itemPath : itemPath
    setExpanded(key, !expanded[key])
  }

  const isExpanded = (itemPath: string, dirName?: string) => {
    // For top-level dirs, check by name; for nested, check by path
    return expanded[itemPath] ?? false
  }

  // g key state for gg command
  const [gPending, setGPending] = createSignal(false)
  let gPendingTimeout: ReturnType<typeof setTimeout> | null = null

  // Build flat tree items for navigation with recursive expansion
  const treeItems = createMemo(() => {
    const items: TreeItem[] = []
    const root = afs.root ?? ""

    // Build a map of all files by their relative path for quick lookup
    const filesByPath = new Map<string, AFS.FileInfo[]>()
    for (const dir of afs.directories) {
      for (const file of dir.files) {
        const parentPath = path.dirname(file.relativePath)
        if (!filesByPath.has(parentPath)) {
          filesByPath.set(parentPath, [])
        }
        filesByPath.get(parentPath)!.push(file)
      }
    }

    // Recursive function to add items
    function addItems(dirPath: string, depth: number, topLevelDir?: string) {
      const files = filesByPath.get(dirPath) ?? []

      // Sort: directories first, then files, both alphabetically
      const sortedFiles = [...files].sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1
        if (!a.isDirectory && b.isDirectory) return 1
        return a.name.localeCompare(b.name)
      })

      for (const file of sortedFiles) {
        const fullPath = path.join(root, file.relativePath)
        const isDir = file.isDirectory

        items.push({
          type: isDir ? "directory" : "file",
          name: file.name,
          path: fullPath,
          dirName: topLevelDir,
          size: isDir ? undefined : file.size,
          depth,
          isExpanded: isDir ? (expanded[fullPath] ?? expanded[file.name] ?? false) : undefined,
        })

        // Recursively add children if this directory is expanded
        if (isDir && (expanded[fullPath] || expanded[file.name])) {
          addItems(file.relativePath, depth + 1, topLevelDir)
        }
      }
    }

    // Add top-level AFS directories
    for (const dir of afs.directories) {
      const dirPath = path.join(root, dir.name)
      const isExp = expanded[dir.name] ?? false

      items.push({
        type: "directory",
        name: dir.name,
        path: dirPath,
        isExpanded: isExp,
        depth: 0,
      })

      // Add children if expanded
      if (isExp && dir.files.length > 0) {
        addItems(dir.name, 1, dir.name)
      }
    }

    return items
  })

  // Clamp cursor when tree changes
  createEffect(() => {
    const items = treeItems()
    if (items.length === 0) {
      setCursorIndex(0)
    } else if (cursorIndex() >= items.length) {
      setCursorIndex(items.length - 1)
    }
  })

  // Load file content
  async function loadFile(filePath: string) {
    try {
      setFileError(null)
      const file = Bun.file(filePath)
      const exists = await file.exists()
      if (!exists) {
        setFileError("File not found")
        return
      }

      const size = file.size
      if (size > 1024 * 1024) {
        setFileError("File too large (>1MB)")
        return
      }

      const ext = path.extname(filePath).toLowerCase()
      const textExts = [".md", ".txt", ".json", ".ts", ".js", ".tsx", ".jsx", ".py", ".sh", ".yaml", ".yml", ".toml", ".xml", ".html", ".css"]
      const isBinary = !textExts.includes(ext) && size > 0

      if (isBinary) {
        const buffer = await file.arrayBuffer()
        const bytes = new Uint8Array(buffer).slice(0, 512)
        let hexStr = ""
        for (let i = 0; i < bytes.length; i += 16) {
          const chunk = bytes.slice(i, i + 16)
          const hex = Array.from(chunk)
            .map((b) => b.toString(16).padStart(2, "0"))
            .join(" ")
          const ascii = Array.from(chunk)
            .map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : "."))
            .join("")
          hexStr += `${i.toString(16).padStart(8, "0")}  ${hex.padEnd(48)}  ${ascii}\n`
        }
        if (size > 512) {
          hexStr += `\n... (${size - 512} more bytes)`
        }
        setFileContent(hexStr)
        setFileViewMode("hex")
      } else {
        const content = await file.text()
        setFileContent(content)
        if (ext === ".md") {
          setFileViewMode("markdown")
        } else {
          setFileViewMode("text")
        }
      }

      setSelectedFile(filePath)
      setViewMode("file")
      setScrollOffset(0)
    } catch (e) {
      setFileError(String(e))
    }
  }

  // Keyboard handler called via keyboard mode API
  function handleKeyboard(evt: { name: string; ctrl?: boolean; shift?: boolean; meta?: boolean }): boolean {
    // Reset g pending on any key except g
    if (evt.name !== "g" && gPending()) {
      setGPending(false)
    }

    if (viewMode() === "tree") {
      return handleTreeKeyboard(evt)
    }
    return handleFileKeyboard(evt)
  }

  function handleTreeKeyboard(evt: { name: string; ctrl?: boolean; shift?: boolean }): boolean {
    const items = treeItems()
    const idx = cursorIndex()
    const item = items[idx]

    // Handle global keys first (always work regardless of selection)
    switch (evt.name) {
      case "q":
      case "escape":
        dialog.clear()
        return true

      case "r":
        afs.refresh()
        return true
    }

    // Return early if no items
    if (items.length === 0) return false

    switch (evt.name) {
      case "j":
      case "down":
        if (idx < items.length - 1) setCursorIndex(idx + 1)
        return true

      case "k":
      case "up":
        if (idx > 0) setCursorIndex(idx - 1)
        return true

      case "g":
        if (gPending()) {
          // gg - go to top
          setCursorIndex(0)
          setGPending(false)
          if (gPendingTimeout) {
            clearTimeout(gPendingTimeout)
            gPendingTimeout = null
          }
        } else {
          setGPending(true)
          // Reset after 1 second
          if (gPendingTimeout) clearTimeout(gPendingTimeout)
          gPendingTimeout = setTimeout(() => {
            setGPending(false)
            gPendingTimeout = null
          }, 1000)
        }
        return true

      case "G":
        setCursorIndex(items.length - 1)
        return true

      case "h":
      case "left":
        // Use path for nested dirs, name for top-level
        const collapseKey = item?.depth === 0 ? item?.name : item?.path
        if (item?.type === "directory" && collapseKey && expanded[collapseKey]) {
          setExpanded(collapseKey, false)
        } else if (item && item.depth > 0) {
          // Navigate to parent directory
          const parentPath = path.dirname(item.path)
          const parentIdx = items.findIndex((i) => i.path === parentPath)
          if (parentIdx >= 0) setCursorIndex(parentIdx)
        }
        return true

      case "l":
      case "right":
        if (item?.type === "directory") {
          // Use path for nested dirs, name for top-level
          const expandKey = item.depth === 0 ? item.name : item.path
          if (!expanded[expandKey]) {
            setExpanded(expandKey, true)
          } else if (idx + 1 < items.length && items[idx + 1].depth > item.depth) {
            setCursorIndex(idx + 1)
          }
        } else if (item?.type === "file") {
          loadFile(item.path)
        }
        return true

      case "return":
      case "o":
        if (item?.type === "directory") {
          // Use path for nested dirs, name for top-level
          const toggleKey = item.depth === 0 ? item.name : item.path
          setExpanded(toggleKey, !expanded[toggleKey])
        } else if (item?.type === "file") {
          loadFile(item.path)
        }
        return true

      case "space":
        if (item?.type === "directory") {
          const spaceKey = item.depth === 0 ? item.name : item.path
          setExpanded(spaceKey, !expanded[spaceKey])
        }
        return true
    }

    return false
  }

  function handleFileKeyboard(evt: { name: string; ctrl?: boolean; shift?: boolean }): boolean {
    const lines = fileContent().split("\n")
    const maxScroll = Math.max(0, lines.length - 20)

    switch (evt.name) {
      case "q":
      case "escape":
      case "backspace":
      case "h":
      case "left":
        setViewMode("tree")
        setSelectedFile(null)
        return true

      case "j":
      case "down":
        setScrollOffset((s) => Math.min(s + 1, maxScroll))
        return true

      case "k":
      case "up":
        setScrollOffset((s) => Math.max(s - 1, 0))
        return true

      case "d":
        if (evt.ctrl) {
          setScrollOffset((s) => Math.min(s + 10, maxScroll))
          return true
        }
        return false

      case "u":
        if (evt.ctrl) {
          setScrollOffset((s) => Math.max(s - 10, 0))
          return true
        }
        return false

      case "G":
        setScrollOffset(maxScroll)
        return true

      case "g":
        if (gPending()) {
          setScrollOffset(0)
          setGPending(false)
          if (gPendingTimeout) {
            clearTimeout(gPendingTimeout)
            gPendingTimeout = null
          }
        } else {
          setGPending(true)
          if (gPendingTimeout) clearTimeout(gPendingTimeout)
          gPendingTimeout = setTimeout(() => {
            setGPending(false)
            gPendingTimeout = null
          }, 1000)
        }
        return true

      case "m":
        if (fileViewMode() === "markdown") {
          setFileViewMode("text")
        } else if (fileViewMode() === "text" && selectedFile()?.endsWith(".md")) {
          setFileViewMode("markdown")
        }
        return true

      case "x":
        if (fileViewMode() === "hex") {
          setFileViewMode("text")
        } else {
          setFileViewMode("hex")
        }
        return true
    }

    return false
  }

  const totalFiles = createMemo(() => afs.directories.reduce((sum, d) => sum + d.fileCount, 0))

  const getFileIcon = (name: string) => {
    if (name.endsWith(".md")) return "󰍔"
    if (name.endsWith(".ts") || name.endsWith(".tsx")) return "󰛦"
    if (name.endsWith(".js") || name.endsWith(".jsx")) return "󰌞"
    if (name.endsWith(".json")) return "󰘦"
    if (name.endsWith(".yaml") || name.endsWith(".yml")) return "󰅪"
    if (name.endsWith(".sh")) return "󰆍"
    if (name.endsWith(".py")) return "󰌠"
    return "󰈔"
  }

  const getDirColor = (name: string) => {
    switch (name) {
      case "memory":
        return theme.info
      case "knowledge":
        return theme.info
      case "tools":
        return theme.warning
      case "scratchpad":
        return theme.success
      case "history":
        return theme.textMuted
      default:
        return theme.text
    }
  }

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1}>
      {/* Header */}
      <box flexDirection="row" justifyContent="space-between" marginBottom={1}>
        <box flexDirection="row" gap={2}>
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            AFS Browser
          </text>
          <Show when={viewMode() === "file" && selectedFile()}>
            <text fg={theme.textMuted}>
              › {path.basename(selectedFile()!)}
            </text>
            <text
              fg={
                fileViewMode() === "hex"
                  ? theme.warning
                  : fileViewMode() === "markdown"
                    ? theme.info
                    : theme.textMuted
              }
            >
              [{fileViewMode().toUpperCase()}]
            </text>
          </Show>
          <Show when={gPending()}>
            <text fg={theme.warning}>[g...]</text>
          </Show>
        </box>
        <text fg={theme.textMuted}>
          {viewMode() === "tree" ? "q:quit j/k:nav l/enter:open r:refresh" : "q/h:back j/k:scroll m:md x:hex"}
        </text>
      </box>

      <Show when={!afs.exists}>
        <box gap={1}>
          <text fg={theme.warning}>⚠ AFS not initialized</text>
          <text fg={theme.textMuted}>Run 'ocode afs init' to set up the Agentic File System</text>
          <box paddingLeft={2} marginTop={1}>
            <text fg={theme.info}>• memory/</text>
            <text fg={theme.textMuted} paddingLeft={2}>Long-term specs and decisions</text>
            <text fg={theme.info}>• knowledge/</text>
            <text fg={theme.textMuted} paddingLeft={2}>Reference materials</text>
            <text fg={theme.warning}>• tools/</text>
            <text fg={theme.textMuted} paddingLeft={2}>Scripts and automation</text>
            <text fg={theme.success}>• scratchpad/</text>
            <text fg={theme.textMuted} paddingLeft={2}>Working memory and plans</text>
            <text fg={theme.textMuted}>• history/</text>
            <text fg={theme.textMuted} paddingLeft={2}>Archived sessions</text>
          </box>
        </box>
      </Show>

      <Show when={afs.exists}>
        {/* Tree View */}
        <Show when={viewMode() === "tree"}>
          {/* Stats bar */}
          <box flexDirection="row" gap={2} marginBottom={1}>
            <text fg={theme.textMuted}>
              {totalFiles()} files • {afs.directories.filter((d) => d.exists).length} dirs
            </text>
            <Show when={afs.planExists}>
              <text fg={theme.success}>● plan.md</text>
            </Show>
          </box>

          {/* Tree */}
          <box maxHeight={20}>
            <scrollbox>
              <For each={treeItems()}>
                {(item, index) => {
                  const isSelected = () => index() === cursorIndex()
                  const indent = "  ".repeat(item.depth)

                  return (
                    <box
                      flexDirection="row"
                      gap={1}
                      backgroundColor={isSelected() ? theme.backgroundElement : undefined}
                      paddingLeft={1}
                      paddingRight={1}
                      onMouseDown={() => {
                        setCursorIndex(index())
                        if (item.type === "file") {
                          loadFile(item.path)
                        } else {
                          const clickKey = item.depth === 0 ? item.name : item.path
                          setExpanded(clickKey, !expanded[clickKey])
                        }
                      }}
                    >
                      <text fg={theme.textMuted}>{indent}</text>
                      <Show when={item.type === "directory" && item.depth === 0}>
                        {/* Top-level AFS directory */}
                        <text fg={isSelected() ? theme.text : theme.textMuted}>
                          {expanded[item.name] ? "▼" : "▶"}
                        </text>
                        <text
                          fg={getDirColor(item.name)}
                          attributes={isSelected() ? TextAttributes.BOLD : undefined}
                        >
                          {item.name}/
                        </text>
                        <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
                          ({afs.directories.find((d) => d.name === item.name)?.fileCount || 0})
                        </text>
                      </Show>
                      <Show when={item.type === "directory" && item.depth > 0}>
                        {/* Nested subdirectory */}
                        <text fg={isSelected() ? theme.text : theme.textMuted}>
                          {expanded[item.path] ? "▼" : "▶"}
                        </text>
                        <text fg={isSelected() ? theme.info : theme.textMuted}>
                          📁
                        </text>
                        <text
                          fg={isSelected() ? theme.text : theme.textMuted}
                          attributes={isSelected() ? TextAttributes.BOLD : undefined}
                        >
                          {item.name}/
                        </text>
                      </Show>
                      <Show when={item.type === "file"}>
                        <text fg={isSelected() ? theme.text : theme.textMuted}>
                          {getFileIcon(item.name)}
                        </text>
                        <text fg={isSelected() ? theme.text : theme.textMuted}>
                          {item.name}
                        </text>
                        <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
                          {formatSize(item.size ?? 0)}
                        </text>
                      </Show>
                    </box>
                  )
                }}
              </For>
            </scrollbox>
          </box>

          {/* Footer */}
          <box marginTop={1} flexDirection="row" justifyContent="space-between">
            <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
              {afs.root}
            </text>
            <text fg={theme.textMuted}>
              {cursorIndex() + 1}/{treeItems().length}
            </text>
          </box>
        </Show>

        {/* File View */}
        <Show when={viewMode() === "file"}>
          <Show when={fileError()}>
            <box>
              <text fg={theme.error}>Error: {fileError()}</text>
              <text fg={theme.textMuted} marginTop={1}>Press q or h to go back</text>
            </box>
          </Show>

          <Show when={!fileError()}>
            <box
              backgroundColor={theme.backgroundElement}
              paddingTop={1}
              paddingBottom={1}
              paddingLeft={2}
              paddingRight={2}
              maxHeight={18}
            >
              <scrollbox>
                <Show when={fileViewMode() === "hex"}>
                  <For each={fileContent().split("\n").slice(scrollOffset(), scrollOffset() + 20)}>
                    {(line, idx) => (
                      <text fg={theme.text}>
                        <span style={{ fg: theme.warning }}>{line.slice(0, 10)}</span>
                        <span style={{ fg: theme.text }}>{line.slice(10, 58)}</span>
                        <span style={{ fg: theme.success }}>{line.slice(58)}</span>
                      </text>
                    )}
                  </For>
                </Show>

                <Show when={fileViewMode() === "text"}>
                  <For each={fileContent().split("\n").slice(scrollOffset(), scrollOffset() + 20)}>
                    {(line, idx) => (
                      <text fg={theme.text} wrapMode="word">
                        <span style={{ fg: theme.textMuted }}>
                          {(scrollOffset() + idx() + 1).toString().padStart(4, " ")}│
                        </span>
                        {line || " "}
                      </text>
                    )}
                  </For>
                </Show>

                <Show when={fileViewMode() === "markdown"}>
                  <For each={fileContent().split("\n").slice(scrollOffset(), scrollOffset() + 20)}>
                    {(line) => {
                      const isH1 = line.startsWith("# ")
                      const isH2 = line.startsWith("## ")
                      const isH3 = line.startsWith("### ")
                      const isBullet = /^\s*[-*]\s/.test(line)
                      const isCode = line.startsWith("```") || /^\s{4}/.test(line)
                      const isQuote = line.startsWith(">")

                      let fg = theme.text
                      let attrs: typeof TextAttributes.BOLD | undefined

                      if (isH1) {
                        fg = theme.info
                        attrs = TextAttributes.BOLD
                      } else if (isH2) {
                        fg = theme.info
                        attrs = TextAttributes.BOLD
                      } else if (isH3) {
                        fg = theme.info
                      } else if (isBullet) {
                        fg = theme.success
                      } else if (isCode) {
                        fg = theme.warning
                      } else if (isQuote) {
                        fg = theme.textMuted
                      }

                      return (
                        <text fg={fg} attributes={attrs} wrapMode="word">
                          {line || " "}
                        </text>
                      )
                    }}
                  </For>
                </Show>
              </scrollbox>
            </box>

            {/* Status bar */}
            <box flexDirection="row" justifyContent="space-between" marginTop={1}>
              <text fg={theme.textMuted}>
                {scrollOffset() + 1}-{Math.min(scrollOffset() + 20, fileContent().split("\n").length)} of{" "}
                {fileContent().split("\n").length} lines
              </text>
              <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
                {selectedFile()}
              </text>
            </box>
          </Show>
        </Show>
      </Show>
    </box>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}
