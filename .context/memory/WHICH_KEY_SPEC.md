# Which-Key System Specification

Oracle Code's Spacemacs/Doom-emacs inspired command interface.

## Overview

The which-key system provides a discoverable, hierarchical command interface activated by the leader key. When pressed, a bottom bar displays available commands, and subsequent keypresses navigate the tree or execute actions.

## Architecture

```
┌──────────────────────────────────────────────────┐
│                    App                            │
│  ┌──────────────────────────────────────────────┐│
│  │              KeybindProvider                 ││
│  │  ┌────────────────────────────────────────┐  ││
│  │  │          WhichKeyProvider              │  ││
│  │  │  ┌──────────────────────────────────┐  │  ││
│  │  │  │          PanesProvider           │  │  ││
│  │  │  │                                  │  │  ││
│  │  │  │    [Session/Home Content]        │  │  ││
│  │  │  │                                  │  │  ││
│  │  │  └──────────────────────────────────┘  │  ││
│  │  └────────────────────────────────────────┘  ││
│  └──────────────────────────────────────────────┘│
│  ┌──────────────────────────────────────────────┐│
│  │              WhichKeyBar                     ││
│  │  SPC w-  / split-v  - split-h  d close ...  ││
│  └──────────────────────────────────────────────┘│
└──────────────────────────────────────────────────┘
```

## Key Files

| File | Purpose |
|------|---------|
| `context/which-key.tsx` | State, command tree, key handling |
| `context/panes.tsx` | Window management state & actions |
| `context/keybind.tsx` | Leader key integration hooks |
| `component/which-key-bar.tsx` | Bottom bar UI component |
| `component/pane-container.tsx` | Recursive pane tree renderer |
| `component/pane-view.tsx` | Individual pane with view switching |

## Command Tree

```
SPC (leader) →
├── w (+window)
│   ├── /  split vertical
│   ├── -  split horizontal
│   ├── d  close pane
│   ├── m  maximize/restore
│   ├── h  focus left
│   ├── j  focus down
│   ├── k  focus up
│   ├── l  focus right
│   ├── =  balance sizes
│   └── o  close others (only)
│
├── b (+buffer/view)
│   ├── c  chat
│   ├── a  AFS browser
│   ├── t  ToM panel
│   ├── m  metrics
│   ├── g  agents
│   ├── d  diff view
│   ├── o  todo
│   └── s  sidebar
│
├── s (+session)
│   ├── n  new session
│   ├── l  list sessions
│   ├── e  export
│   ├── c  compact
│   ├── t  timeline
│   ├── r  rename
│   └── T  session tree
│
├── a (+agent)
│   ├── l  list agents
│   ├── n  next agent
│   ├── p  prev agent
│   └── s  agent status
│
├── m (+model)
│   ├── l  list models
│   ├── n  next model
│   └── p  prev model
│
├── x (+analysis)
│   ├── t  toggle ToM
│   ├── m  toggle metrics
│   ├── e  toggle eval
│   ├── c  toggle critic
│   └── n  cycle modes
│
├── g (+git)
│   ├── s  status
│   ├── d  diff
│   └── l  log
│
├── f (+file)
│   ├── f  find file
│   ├── r  recent files
│   └── s  save
│
├── p  command palette (ctrl+p)
├── t  themes
├── e  editor
├── q  quit
├── ?  help
└── SPC  M-x (command palette)
```

## Integration Points

### KeybindProvider → WhichKeyProvider

```typescript
// keybind.tsx exports WhichKeyHandler type
export type WhichKeyHandler = {
  onActivate: () => void
  onDeactivate: () => void
  onKey: (key: string) => boolean
  isActive: () => boolean
}

// WhichKeyConnector wires them together
keybind.setWhichKeyHandler({
  onActivate: () => whichKey.activate(),
  onDeactivate: () => whichKey.deactivate(),
  onKey: (key) => whichKey.handleKey(key),
  isActive: () => whichKey.active,
})
```

### WhichKeyProvider → CommandProvider

```typescript
// Which-key triggers existing keybinds
whichKey.setKeybindTrigger((key) => command.trigger(key))
```

### PanesProvider → Action Registration

```typescript
// panes.tsx registers window/buffer actions on mount
registerWhichKeyAction("window.split.vertical", () => split("vertical"))
registerWhichKeyAction("buffer.afs", () => setView(activeId, "afs"))
// ...etc
```

## Pane System

### Data Structures

```typescript
type PaneViewType = "chat" | "afs" | "tom" | "metrics" | "agents" | "diff" | "todo" | "sidebar"

interface PaneLeaf {
  type: "leaf"
  id: string
  viewType: PaneViewType
  sessionID?: string
  metadata?: Record<string, any>
}

interface PaneSplit {
  type: "split"
  id: string
  direction: "horizontal" | "vertical"
  ratio: number  // 0-1
  first: PaneNode
  second: PaneNode
}

type PaneNode = PaneLeaf | PaneSplit
```

### Navigation Algorithm

Pane navigation (h/j/k/l) uses geometric bounds calculation:
1. Collect all leaves with calculated x/y/w/h bounds
2. Filter candidates in the requested direction
3. Select closest by perpendicular distance (for tiebreaking)

## Usage

1. Press leader key (default: `ctrl+x`)
2. Which-key bar appears at bottom showing available keys
3. Press key to navigate into group or execute action
4. ESC to cancel, BACKSPACE to go back one level, leader-again to cancel
5. No auto-timeout; leader stays active until action or cancel

## Backwards Compatibility

- `ctrl+p` still opens fuzzy command palette directly
- Existing `<leader>+key` shortcuts continue to work
- Which-key provides discovery; power users can use direct shortcuts
