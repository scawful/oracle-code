# Panes System Roadmap

Working document for completing the which-key pane management integration.

## Current Status (Phase 5 Complete)

**Phase 1 - Infrastructure (Complete):**
- [x] which-key.tsx context with command tree
- [x] which-key-bar.tsx bottom bar component
- [x] panes.tsx context with full tree operations
- [x] pane-container.tsx recursive renderer
- [x] pane-view.tsx with view type switching
- [x] keybind.tsx integration hooks
- [x] app.tsx provider wiring

**Phase 2 - View Extraction (Complete):**
- [x] Create component/views/ directory structure
- [x] ToMView - extracted from panel-tom.tsx
- [x] MetricsView - new component using useMetrics()
- [x] AgentsView - extracted from panel-agents.tsx
- [x] AFSView - extracted from dialog-afs-browser.tsx
- [x] ChatView - read-only message display (simplified from session/index.tsx)
- [x] SessionChatPane - full interactive chat with tool rendering
- [x] Wired all views into pane-view.tsx
- [ ] DiffView / TodoView - minimal placeholders remain

**Phase 3 - Session Route Integration (Complete):**
- [x] Import panes context into session route
- [x] Add hasSecondaryPanes computed signal
- [x] Create SecondaryPaneArea component
- [x] Create SecondaryPaneRenderer for tree traversal (skips "main" pane)
- [x] Conditional layout: main chat 60% / secondary panes 40% when splits active
- [x] Preserve existing UX when no splits (default single-pane view)

**Phase 4 - Polish & Enhancement (Complete):**
- [x] Visual focus indicator - double-line border for active pane
- [x] Focus indicator icons in pane header (●/○/◈)
- [x] Hint text in active pane header (SPC w)
- [x] Nerd font icons for each view type
- [x] Pane history navigation (SPC w TAB, SPC w p)
- [x] Keyboard pane resize (SPC w > / SPC w <)
- [x] Layout presets (SPC w 1/2/3/4 for quick layouts)
- [x] State persistence (save/restore pane layout per session)
- [x] Config options for pane keybinds (20 new keybinds in config schema)

**Working Now:**
- Leader key activates which-key bar
- Command tree navigation (w, b, t, s, a, m, x, g, f groups)
- Pane state management (split, close, focus, maximize)
- All primary view components render in panes (Chat, AFS, ToM, Metrics, Agents)
- Action registration system
- Secondary pane area appears when user splits via which-key (SPC w / or SPC w -)
- Double-line border on active pane
- Focus indicators (●/○/◈) in pane headers
- Pane history (TAB to cycle, p for previous)
- Keyboard resize (> to grow, < to shrink)
- Quick presets (1=single, 2=dual, 3=triple, 4=quad)
- Pane layout persistence (saved per session, auto-restored)
- 20 configurable keybinds for pane operations
- **NEW:** Tab Groups (SPC t) - multiple tabs per pane
- **NEW:** Tab bar UI with clickable tabs
- **NEW:** Tab cycling, closing, reordering
- **NEW:** Floating Panes (SPC w f) - overlay panes with z-stacking
- **NEW:** Workspaces (SPC W) - save/load named layout configurations
- **Stability Fix (2025-12-12):** which-key action execution is now guarded so thrown pane handler errors don’t corrupt the UI; pane IDs now use a `generateId()` helper with WebCrypto fallback to avoid runtime crashes in environments without global `crypto`.
- **UX Fix (2025-12-12):** removed leader/which-key auto-timeouts; leader stays active until an action executes or user cancels (ESC/backspace). Keybind now deactivates leader when which-key deactivates.
- **UI Fix (2025-12-12):** floating panes overlay is now rendered in the session route, so `SPC w f` and related float actions are visible.

**Architecture Notes:**
- "main" pane represents the primary chat (rendered by session/index.tsx)
- SecondaryPaneArea only renders panes that are NOT "main"
- When user splits from main, a new pane appears in the secondary area
- Main chat keeps full interactivity (prompt, permissions, revert state)

---

## Phase 2: View Component Extraction

Extract existing UI components into pane-compatible views.

### 2.1 ChatView Component ✅

**Goal:** Extract chat message rendering from session/index.tsx

**Source:** `routes/session/index.tsx` (lines ~200-900)

**Tasks:**
- [x] Create `component/views/chat-view.tsx`
- [x] Extract message rendering logic (UserMessageView, AssistantMessageView)
- [x] Extract part renderers (TextPartView, ToolPartView, ReasoningPartView)
- [x] Create ChatViewContext for display options
- [ ] Handle prompt integration (deferred - read-only for now)

**Implementation Notes:**
- Created simplified read-only ChatView for pane embedding
- Full session/index.tsx preserved for main chat with prompt
- ChatView suitable for monitoring subagent sessions or reviewing history

### 2.2 AFSBrowserView Component ✅

**Goal:** Adapt dialog-afs-browser.tsx for pane embedding

**Source:** `component/dialog-afs-browser.tsx`

**Tasks:**
- [x] Create `component/views/afs-view.tsx`
- [x] Remove dialog wrapper, keep tree logic
- [x] Add keyboard navigation when pane is active (keyboard ownership + focus blur; 2025-12-12)
- [x] Sync with AFS context

### 2.3 ToMPanelView Component ✅

**Goal:** Adapt panel-tom.tsx for pane embedding

**Source:** `component/panel-tom.tsx`

**Tasks:**
- [x] Create `component/views/tom-view.tsx`
- [x] Preserve belief state display
- [x] Add scrolling for large state

### 2.4 MetricsView Component ✅

**Goal:** Create metrics display for pane

**Tasks:**
- [x] Create `component/views/metrics-view.tsx`
- [x] Display coordination efficiency
- [x] Display error amplification
- [x] Display message density
- [x] Add IRT model stats when available

### 2.5 AgentsView Component ✅

**Goal:** Adapt panel-agents.tsx for pane embedding

**Source:** `component/panel-agents.tsx`

**Tasks:**
- [x] Create `component/views/agents-view.tsx`
- [x] Show active/completed/failed agents
- [x] Add agent selection/interaction

### 2.6 DiffView / TodoView

**Tasks:**
- [ ] Create `component/views/diff-view.tsx` - show current session diffs
- [ ] Create `component/views/todo-view.tsx` - interactive todo list

---

## Phase 3: Session Route Integration

Replace fixed sidebar layout with PaneContainer.

### 3.1 Layout Refactor

**Current structure:**
```
┌─────────────────────────────────────────┐
│                Header                    │
├───────────────────────────┬─────────────┤
│                           │             │
│      Messages + Prompt    │   Sidebar   │
│                           │  (fixed 42) │
│                           │             │
├───────────────────────────┴─────────────┤
│                Footer                    │
└─────────────────────────────────────────┘
```

**Target structure:**
```
┌─────────────────────────────────────────┐
│                Header                    │
├─────────────────────────────────────────┤
│                                         │
│            PaneContainer                │
│   (default: single chat pane)           │
│   (user can split as needed)            │
│                                         │
├─────────────────────────────────────────┤
│                Footer                    │
└─────────────────────────────────────────┘
```

### 3.2 Migration Strategy

1. **Create ChatView** wrapping current message+prompt logic
2. **Keep Sidebar as optional pane** (viewType: "sidebar")
3. **Default layout:** Single chat pane (preserves current UX)
4. **User initiates splits** via which-key commands

### 3.3 State Persistence

- [ ] Save pane layout to session metadata
- [ ] Restore layout on session resume
- [ ] Default layout preference in config

---

## Phase 4: Polish & Enhancement ✅ (Complete)

### 4.1 Pane Resize ✅

- [x] Keyboard resize (SPC w > / SPC w <)
- [x] Min/max pane constraints (0.1 - 0.9 ratio limits)
- [ ] Draggable split borders (deferred to Phase 5)

### 4.2 Pane Presets ✅

- [x] Quick layouts: "SPC w 1" (single), "SPC w 2" (dual), "SPC w 3" (triple), "SPC w 4" (quad)
- [x] Auto-save/restore via persistence (see 4.6)

### 4.3 Focus Indicators ✅

- [x] Visual focus ring on active pane (double-line border ╔═╗)
- [x] Focus indicators in pane header (●/○/◈)
- [x] Hint text showing "SPC w" in active pane

### 4.4 Pane History ✅

- [x] "SPC w TAB" to cycle recent panes
- [x] "SPC w p" to go to previous pane

### 4.5 Config Options ✅

Added 20 configurable keybinds to the config schema:
```typescript
// In config.ts Keybinds schema
window_split_vertical: z.string().optional().default("<leader>w/"),
window_split_horizontal: z.string().optional().default("<leader>w-"),
window_close: z.string().optional().default("<leader>wd"),
window_maximize: z.string().optional().default("<leader>wm"),
window_focus_left: z.string().optional().default("<leader>wh"),
window_focus_down: z.string().optional().default("<leader>wj"),
window_focus_up: z.string().optional().default("<leader>wk"),
window_focus_right: z.string().optional().default("<leader>wl"),
window_balance: z.string().optional().default("<leader>w="),
window_only: z.string().optional().default("<leader>wo"),
window_cycle: z.string().optional().default("<leader>wTAB"),
window_previous: z.string().optional().default("<leader>wp"),
window_grow: z.string().optional().default("<leader>w>"),
window_shrink: z.string().optional().default("<leader>w<"),
window_preset_single: z.string().optional().default("<leader>w1"),
window_preset_dual: z.string().optional().default("<leader>w2"),
window_preset_triple: z.string().optional().default("<leader>w3"),
window_preset_quad: z.string().optional().default("<leader>w4"),
```

### 4.6 State Persistence ✅

- [x] Save pane layout to storage per session (uses Storage module)
- [x] Auto-restore layout when session is loaded
- [x] Debounced saving (500ms after last change)
- [x] Serialization format with version for future compatibility

---

## Phase 5: Advanced Features ✅ (Complete)

### 5.1 Tab Groups ✅ (Complete)

- [x] Multiple tabs per pane (PaneTab interface)
- [x] Tab cycling within pane (SPC t l / SPC t h)
- [x] Tab close (SPC t d)
- [x] Tab reorder (SPC t > / SPC t <)
- [x] Tab bar UI with click-to-switch
- [x] Go to specific tab (SPC t 1-5)
- [x] New tab with specific view type (SPC t n/a/t/m/g)
- [x] Backwards compatibility with legacy panes
- [x] Auto-migration of legacy panes to tabs

### 5.2 Floating Panes ✅ (Complete)

- [x] "SPC w f" to float/dock toggle
- [x] "SPC w F" to close floating pane
- [x] FloatingPane interface with position, size, z-index
- [x] FloatingPaneOverlay component for rendering
- [x] Dock floating pane back to tree
- [x] Bring-to-front on click
- [x] Float indicator in header (󰀁 [FLOAT])
- [x] Z-index stacking for multiple floats
- [x] Move/resize floating panes (API functions)
- [ ] Drag floating panes with mouse (stretch goal)

### 5.3 Workspaces ✅ (Complete)

- [x] Named workspace configurations (Workspace interface)
- [x] Save current layout as workspace (SPC W s / workspace_save)
- [x] Load workspace by name (SPC W l / workspace_load)
- [x] Delete workspace (SPC W d / workspace_delete)
- [x] Rename workspace (SPC W r / workspace_rename)
- [x] List all workspaces (SPC W L / workspace_list)
- [x] Quick slots (SPC W 1-4) for fast workspace switching
- [x] Workspace persistence to storage
- [x] Dialog UI for all workspace operations
- [x] 5 new keybinds in config schema (workspace_save/load/delete/rename/list)

---

## Implementation Notes

### Focus Management

The pane system needs careful focus management:
1. Active pane receives keyboard input
2. Chat pane has prompt focus
3. Other panes have their own focus targets
4. Which-key temporarily steals focus

### Performance

- Use `createMemo` for computed pane properties
- Avoid re-rendering inactive panes
- Virtualize large content (messages, file trees)

### Testing Strategy

1. Unit tests for pane tree operations
2. Integration tests for which-key commands
3. Visual regression for pane layouts

---

## References

- Spacemacs: https://www.spacemacs.org/
- Doom Emacs: https://github.com/doomemacs/doomemacs
- tmux pane management
- Vim window splits

## Related Docs

- `.context/memory/WHICH_KEY_SPEC.md` - System specification
- `.context/memory/AFS_SPEC.md` - Context file system
- `.context/memory/AGENTS_SPEC.md` - Agent architecture
