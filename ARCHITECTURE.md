# OpenFlowKit Architecture Guide

This document is a current high-level map of the codebase. It is intentionally narrower than a full design spec and should stay aligned with the implementation in `src/`.

---

## Overview

OpenFlowKit is a local-first diagram editor built with:

- React 19
- TypeScript 5
- React Flow / XYFlow
- Zustand
- ELK.js

The main application lives in `src/`. Additional repo surfaces include:

- `docs-site/` for canonical public docs content and site generation
- `docs/` for repo-only notes and operational markdown
- `web/` for the marketing site

Main app shape:

```text
src/
  app/                Route state helpers
  components/         UI surfaces and editor shells
  config/             Rollout flags and provider config
  context/            React context providers
  diagram-types/      Diagram family plugins and property panel registration
  hooks/              Feature and editor hooks
  i18n/               Localization
  lib/                Shared types, parsers, compat helpers, utilities
  services/           Domain services
  store/              Zustand state, actions, defaults, persistence
```

Route composition is currently centered in `src/App.tsx`, not in a dedicated `pages/` directory.

---

## Runtime Surfaces

The repository contains four main product/runtime surfaces:

### 1. Main App

The browser editor and related in-app experiences.

Key areas:

- `src/App.tsx`
- `src/components/FlowEditor.tsx`
- `src/components/home/*`

### 2. Docs Site

The public docs site built with Astro/Starlight.

Key area:

- `docs-site/`

### 3. Marketing Site

The public landing/marketing site.

Key area:

- `web/`

### 4. Local Copilot Runtime

Flowpilot uses `@github/copilot-sdk` by default. `server/copilotPlugin.ts` mounts
`/api/copilot/status`, `/api/copilot/chat`, and the `/api/copilot/agent`
WebSocket in the local Vite dev and preview servers. The SDK and CLI credentials
never enter the browser bundle. The hosted server is described in
`docs/hosted-copilot.md`.

- `server/copilotHost.ts` owns SDK startup, CLI authentication, the locked-down
  session options, and fail-closed session cleanup, shared by both paths below.
- `server/copilotRuntime.ts` owns account model discovery and one-shot requests:
  bounded concurrency, streaming, cancellation, and temporary sessions.
- `server/copilotAgentRuntime.ts` runs agent turns with the server-owned system
  message in `server/flowpilotAgentPrompt.ts`. `server/copilotAgentEndpoint.ts`
  accepts the agent socket and relays its frames.
- `server/copilotMiddleware.ts` enforces loopback socket/Host checks, same-origin
  requests, a custom client header, JSON schema/body limits, and explicit terminal
  stream events. It does not enable CORS.
- `src/services/copilot/` owns the shared protocols, the agent tool registry, and
  the browser transports (`client.ts`, `agentClient.ts`).
- `src/services/flowpilot/agent/` validates and applies agent tool calls to the
  live canvas. `src/hooks/ai-generation/useFlowpilotAgent.ts` drives a turn, and
  `src/components/FlowpilotAgentTurn.tsx` shows its steps, questions, and
  confirmations.
- `src/services/aiService.ts` sends the LLM importers and documentation answers
  through the one-shot endpoint; focused property edits run as agent turns. Other providers retain
  their existing transports.
- `src/hooks/ai-generation/` and `src/services/flowpilot/` retain intent routing,
  local asset grounding, DSL parsing/repair, layout, history, and preview approval
  for those requests and for the other providers.

SDK sessions use empty mode with no host tools, MCP servers, skills, ambient
instructions, file hooks, or shared session store. The local CLI sign-in is
reused; inherited automation-token variables are excluded. Each request or turn
replays the browser-owned history as context in one prompt, then deletes only its
own temporary session. Sessions returned after cancellation are cleaned up
without sending a prompt, and cleanup RPCs have bounded waits so they cannot
block a response indefinitely.

**Copilot chat runs as agent turns.** Each Flowpilot message opens one WebSocket
with the `flowpilot-agent.v1` subprotocol, which stands in for the custom client
header that browsers cannot set on a socket. Locally the upgrade also requires the
loopback Origin. The session exposes only `get_canvas`, `edit_canvas`,
`find_icons`, `layout`, `review_architecture`, `list_templates`, `use_template`,
and `ask_user`; every other permission request is rejected. Tool handlers are
relays: the server sends `tool_call`, the browser runs the tool against the live
store, and its `tool_result` goes back to the model. The server performs no
filesystem, environment, or network work for a tool. There are no modes: the
model decides whether to ask, propose, review, or draw, and Copilot prompts are
sent without an edit or create prefix.

While a turn runs, the page is locked for manual edits and changes appear live.
The first edit records one history entry, so **Undo Copilot's changes** reverts
the whole turn while that entry and the resulting canvas are still current.
Removing three or more nodes that existed before the turn, or clearing the page,
waits for the user's confirmation; declining changes nothing and tells the model.
`ask_user` pauses the turn until the user answers, and a question left unanswered
for 10 minutes ends the turn with the reply so far. Stop cancels the session and
rejects tool calls still in flight. A dropped socket, page switch, or server
shutdown ends the turn as interrupted with its work kept; **Continue** starts a
new turn from the current canvas. There is no turn deadline, but startup,
authentication, session creation, and cleanup keep bounded waits. The server
pings every 25 seconds and drops a socket that stays silent for 60 seconds.
Replayed history adds a short note of each earlier turn's canvas changes.

The one-shot `/api/copilot/chat` path keeps its guarantees. Aborts and timeouts
stop model work; a truncated stream cannot be applied as a successful diagram.
Automatic DSL repair remains one additional request, but SDK transport failures
are not replayed by the browser retry loop. The request deadline also covers
startup, authentication, and session creation.

The other providers keep the one-shot Flowpilot conversation, described in the
rest of this section. Flowpilot conversation state is scoped to the active page.
Preview records carry `pending`, `applied`, `discarded`, `superseded`, or `undone`
state and a semantic change summary; their DSL is never replayed as an
authoritative assistant answer. Both conversational and generation requests
receive the live canvas. History writes are serialized per page and rapid turns
retain an explicit sequence. Pending previews expire when a conversation is
reopened instead of becoming implicit applied state. A conversational
confirmation refers only to the latest assistant response, never an older
proposal hidden behind a newer plan or answer. A newer unanswered or cancelled
user turn also invalidates older confirmations. Copilot requests and turns send
at most 200 history entries within the bridge's 8 MiB request limit, dropping the
oldest context and inserting an explicit omission note when needed. Stored
conversation history and the live prompt/canvas are not truncated.

`src/services/flowpilot/changeSummary.ts` compares meaningful node data and
matches edges by endpoints/content rather than regenerated IDs, reserving exact
matches before pairing changed parallel connections. Canvas fingerprints also
include positions, handles, markers, and visibility to prevent stale requests
or previews from overwriting manual changes. Selection and measurement metadata
do not invalidate a draft. When merging a complete DSL response, omitted
DSL-supported attributes are removed; editor-only metadata remains intact.

The Flowpilot composer shares its Copilot model selector with Settings. For the
other providers it persists an explicit `aiSettings.autoApply` opt-in (off when
unset). Prepared AI graphs commit synchronously through store actions, with a
single history entry; React Flow's queued setters are retained for the existing
import path. The inline AI undo control is enabled only while that result and its
undo snapshot are still current. Normal canvas Undo/Redo remains available for
older or intervening edits. Cancellation and page switches prevent late
application.

New installations default to Copilot; persisted provider selections are not
overwritten. Static deployments do not include this Node runtime and cannot read
a user's local CLI login. They show setup guidance and still support alternative
providers. This bridge is not a public or multi-user authentication service.

---

## State Management

The app uses a single public Zustand store exported from `src/store.ts`.

The runtime store is now bootstrapped through:

- `src/store/createFlowStore.ts`
- `src/store/createFlowStoreState.ts`
- `src/store/createFlowStorePersistOptions.ts`

This keeps the public entry stable while moving composition, persistence, and hydration concerns behind explicit seams.

The store is still monolithic at runtime, but it is now partitioned more clearly through slice-typed hooks, selectors, and internal slice factories in `src/store/`.

Current store-facing hook files include:

- `canvasHooks.ts`
- `tabHooks.ts`
- `historyHooks.ts`
- `designSystemHooks.ts`
- `viewHooks.ts`
- `selectionHooks.ts`

Supporting files:

- `defaults.ts`
- `types.ts`
- `selectors.ts`
- `slices/createCanvasEditorSlice.ts`
- `slices/createExperienceSlice.ts`
- `slices/createWorkspaceSlice.ts`
- `persistence.ts`
- `aiSettings.ts`

There is no current top-level `brandHooks.ts` slice in `src/store/`.

---

## Persistence

Persistence is coordinated through:

- `src/store/persistence.ts`
- `src/services/storage/flowPersistStorage.ts`
- `src/services/storage/storageRuntime.ts`
- `src/services/storage/indexedDbStateStorage.ts`

Current behavior at a high level:

- document/tab state is persisted through Zustand persistence
- IndexedDB-backed storage is used where available
- localStorage remains part of the compatibility and fallback story
- persisted nodes/edges are sanitized before storage
- ephemeral UI fields are excluded from persisted state
- browser storage detection and IndexedDB schema readiness are now funneled through a shared storage runtime helper instead of each storage surface bootstrapping itself independently
- IndexedDB store and index definitions are now declared in one schema manifest in `src/services/storage/indexedDbSchema.ts`
- schema migration markers now live in a dedicated IndexedDB schema metadata store instead of sharing the persisted Zustand state store
- local-first chat persistence now uses document-scoped IndexedDB indexes instead of full chat-message store scans
- user images/icons can be stored by content-hash ref in the IndexedDB `assets` store (`assetStoreV1` rollout flag) instead of embedding multi-MB data URLs into every document/history/snapshot copy; nodes hold `imageAssetId` / `iconAssetId` and resolve display URLs at render time

Important constraint:

- persisted storage keys should not be renamed without a migration path

---

## Editor Composition

The editor now follows a clearer four-layer composition path:

1. `src/components/FlowEditor.tsx`
   render shell only
2. `src/components/flow-editor/useFlowEditorScreenModel.ts`
   screen-level composition of store state, domain hooks, and refs
3. `src/components/flow-editor/buildFlowEditorScreenControllerParams.ts`
   pure assembly of controller config from screen-model state
4. `src/components/flow-editor/useFlowEditorController.ts`
   adaptation into shell, studio, panel, and chrome controller surfaces

Key editor concerns composed through that path include:

- tabs and active document selection
- node and edge operations
- history and snapshots
- AI generation
- export/import
- playback
- collaboration
- command bar and studio mode surfaces
- selection and keyboard bindings

This is still the main integration hotspot in the architecture, but it is now bounded more explicitly:

- `FlowEditor.tsx` should stay render-only
- `useFlowEditorScreenModel.ts` should gather state and domain hooks, not render UI
- `buildFlowEditorScreenControllerParams.ts` should stay pure and only map grouped screen state into controller input
- `useFlowEditorController.ts` should adapt grouped inputs into UI-facing shell/panel/chrome props

If future work bypasses those boundaries, editor maintainability will regress quickly.

---

## Domain Hooks

The app uses hooks to compose store state and service logic into editor-facing behaviors.

Examples:

- `useFlowHistory`
- `useFlowOperations`
- `useAIGeneration`
- `useFlowExport`
- `usePlayback`
- `useFlowEditorCollaboration`
- `useFlowEditorActions`
- `useFlowEditorCallbacks`

The architecture intent is:

- services own domain logic
- hooks compose state and side effects
- components render and delegate

---

## Services

`src/services/` contains most of the domain-heavy logic.

Notable service areas:

- `ai/`
- `architectureLint/`
- `collaboration/`
- `diagramDiff/`
- `export/`
- `figma/`
- `infraSync/`
- `mermaid/`
- `playback/`
- `shapeLibrary/`
- `storage/`
- `templateLibrary/`

This is one of the stronger structural parts of the codebase: a significant amount of non-UI logic lives outside React components.

---

## Diagram Families

Built-in diagram families and property panel registration live under:

- `src/diagram-types/`

Examples include:

- architecture
- class diagram
- ER diagram
- journey
- mindmap
- state diagram

These plugins and registrations allow the app to support multiple structured diagram behaviors without collapsing all logic into the base canvas layer.

Built-in diagram capabilities are now bootstrapped through a shared runtime initialization path instead of scattered one-off registration calls:

- `src/diagram-types/bootstrap.ts`
- `src/diagram-types/builtInPlugins.ts`
- `src/diagram-types/builtInPropertyPanels.ts`

---

## Docs Surfaces

The repo currently has two documentation buckets:

### Public docs

- canonical content and runtime in `docs-site/`

### Repo-only notes

- operational and setup markdown in `docs/`

---

## Collaboration

Collaboration currently lives under:

- `src/hooks/useFlowEditorCollaboration.ts`
- `src/services/collaboration/*`

Current implementation notes:

- collaboration runtime construction now flows through `src/services/collaboration/bootstrap.ts`
- realtime transport is built around peer-oriented collaboration
- the current stack includes WebRTC-style transport concerns and signaling configuration
- fallback behavior exists for unsupported environments

This area is functional but still evolving and should be treated as active infrastructure rather than fully settled architecture.

---

## Export Pipeline

Export logic is primarily coordinated through:

- `src/hooks/useFlowExport.ts`
- `src/services/export/*`

Current formats and related capabilities include:

- raster image export
- SVG export
- JSON export
- Mermaid export
- OpenFlow DSL export
- animated export / playback-related export

---

## Testing

Testing is split across:

- Vitest unit and component tests in `src/`
- Playwright end-to-end tests in `e2e/`

Useful commands:

```bash
npm run lint
npm test -- --run
npm run e2e:ci
```

For current repo-health status and phased remediation, see `AUDIT_FIX_LOG.md`.
