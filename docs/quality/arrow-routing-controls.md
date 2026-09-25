# Arrow routing controls

## Interaction

Select a standard connection to show its route controls.

- Curved/straight connectors: drag a round plus handle to create a bend; drag a filled bend handle to move it. Click a plus or press Enter to add a point without dragging. Arrow keys move a focused bend; Shift moves in larger steps. Delete or double-click removes a bend.
- Step connectors: rectangular handles move whole segments perpendicular to their direction. Horizontal segments move up/down; vertical segments move left/right. Endpoint segments create doglegs while preserving attachment to their nodes. Step corners remain sharp and smoothstep corners remain rounded.
- The Route inspector accepts precise bend coordinates and provides Remove bend and Reset path. Display values round to two decimals without changing saved precision until edited.
- A completed drag is one undo step. Escape or pointer cancellation restores the route and its prior undo/redo history, unless a newer edit has taken ownership.
- Copy/paste and template insertion translate bends alongside nodes. Native OpenFlowKit JSON imports preserve the saved layout and routes.

## Boundaries

Sequence messages and automatic self-loops retain their existing dedicated routing. Manual points remain in canvas coordinates when individual nodes move; step routes reconnect with right-angle segments. Curved controls describe the curve's control polygon and may sit off the rendered curve. Editor controls are hidden from image exports, cinematic exports, and Flowpilot canvas captures.

## Verification

- 149 focused tests across 13 files passed, including route geometry, pointer/keyboard interaction, cancellation, undo/redo preservation, copy/paste, native import, screenshot filtering, and existing edge interactions.
- TypeScript, full ESLint, production build, and entry/lazy bundle budgets passed.
- Real integrated-browser checks passed: select a connection, switch to Step, drag a horizontal segment down (with simultaneous sideways movement ignored), drag a vertical segment sideways (with vertical movement ignored), preserve endpoints, single-step Undo/Redo, switch to Smoothstep, Reset path, and Undo reset.
- Browser verification used a separate QA diagram; the active user diagram was preserved.
