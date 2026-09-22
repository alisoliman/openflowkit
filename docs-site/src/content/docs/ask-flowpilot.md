---
draft: false
title: Ask Flowpilot
description: Use Flowpilot as the chat-based Studio assistant for drafting, revising, and explaining diagrams.
---

Flowpilot is the chat-based assistant inside Studio. It is the fastest way to describe a diagram in plain language, revise an existing draft, or ask for a different structural take before you start polishing the result manually.

## Connect GitHub Copilot

Flowpilot defaults to the GitHub Copilot SDK and uses your CLI sign-in and quota.
Run `gh copilot login`, start the local app with `npm run dev`, then open
**Settings → AI → GitHub Copilot → Check connection**. No provider API key is
required. Models come from your Copilot account; saved alternative-provider
choices are preserved.

The local Node runtime is required: a static hosted site cannot read your local
CLI login. See [AI Generation](/ai-generation/) for setup, deployment boundaries,
usage, and alternative providers.

## Good use cases

Ask Flowpilot when you want to:

- create a first draft from a text prompt
- revise an existing system into a cleaner structure
- expand a rough flow with missing failure branches
- convert source code or structured input into a diagram draft

## What to include in your prompt

Useful prompts specify:

- the audience
- the systems or actors involved
- important branches or constraints
- preferred direction such as `LR` or `TB`
- whether you want a high-level overview or a detailed operational flow

## Example prompt

```text
Create a left-to-right architecture diagram for a SaaS app with:
web client, API gateway, auth service, billing service, Postgres,
Redis cache, background workers, and S3-backed file storage.
Show public ingress, async jobs, and failure-handling paths.
```

## What to do after generation

Flowpilot presents a concise change preview by default. Select **Apply to canvas**
to accept it, or **Discard** to leave the diagram unchanged. **View diagram code**
expands the source only when you need it.

Use **Copilot model** in the composer to choose a model from your account.
For an uninterrupted editing workflow, enable **Apply edits automatically**;
the nearby **Undo AI edit** button reverts the latest applied AI change. The
normal canvas Undo/Redo controls remain available for older changes.

Follow-ups default to **Edit current**. Try “Add a cache,” “Rename it,” or
“Yes, do that” after a plan. Discarded drafts do not become the context for later
answers. Cancellation stops the Copilot request without applying a partial
draft. After applying:

- inspect the structure on the canvas
- relabel and normalize in the [Properties Panel](/properties-panel/)
- run [Smart Layout](/smart-layout/) if spacing is poor
- save a snapshot before the next major rewrite

The composer clears as soon as a message is submitted, so you can draft the next
message while Flowpilot works. A failed or cancelled request restores its text
and attachment only if you have not changed the composer in the meantime.

## Related pages

- [AI Generation](/ai-generation/)
- [Prompting AI Agents](/prompting-agents/)
- [Choose an Input Mode](/choose-input-mode/)
