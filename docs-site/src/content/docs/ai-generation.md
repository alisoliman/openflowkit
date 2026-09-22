---
draft: false
title: AI Generation
description: Generate and refine diagrams with the GitHub Copilot SDK and your CLI sign-in, or use alternative providers.
---

OpenFlowKit includes AI-assisted diagram generation through the Studio rail. Flowpilot is best used for first drafts, structural revisions, and code-backed architecture exploration.

AI generation is most valuable when you need to go from ambiguity to structure quickly. It is not the only way to create diagrams in OpenFlowKit, and it is usually not the final step. Think of it as a draft accelerator.

## Access and setup

Flowpilot lives inside Studio and defaults to the **GitHub Copilot SDK**. It uses your Copilot CLI sign-in and quota, without a provider API key. Existing saved provider selections are preserved.

Use Node 20.19+ or 22.12+ and a current GitHub CLI:

```bash
npm install
gh copilot login
npm run dev
```

Open **http://127.0.0.1:3000**, then **Settings → AI → GitHub Copilot → Check connection**. Models are discovered from your account; choose **Copilot default** to let the SDK select its default model. Availability and usage multipliers depend on your plan and organization policy.

The **Copilot model** selector is also available directly in Flowpilot. It uses
the same account model list and saved selection as Settings. The selected model
runs the next turn; switching models does not clear the conversation.

The SDK runs in a local Node process, not in the browser. Both `npm run dev` and `npm run build && npm run preview` provide the local bridge. **Static hosting, including Azure Static Web Apps and the nginx Docker image, cannot access your computer's CLI sign-in.** Run the app locally for Copilot, or choose an alternative provider on the hosted site.

If the CLI is not authenticated, sign in from the terminal and return to the browser or select **Check connection**. If the runtime cannot start, reinstall dependencies and restart the local server. Advanced setups can export `COPILOT_CLI_PATH` to use an existing compatible CLI. Do not put Copilot tokens in browser settings or `VITE_*` variables.

When setup is incomplete, **Set up Flowpilot** opens the shared AI settings modal.

That matters for two reasons:

- the same AI settings surface is used across the product
- provider choice, model choice, and key storage behavior stay consistent whether you open AI from Home, Studio, or Settings

## Where AI lives in the product

AI is available in the Studio panel under **Flowpilot** and through the **Open Flowpilot** command in the Command Center. Common sub-flows include:

| Mode | What it does |
| --- | --- |
| **Flowpilot** | Copilot-powered chat, generation, and iteration |
| **From Code** | Paste source code and generate an architecture diagram |
| **Import** | Paste SQL, Terraform, K8s, or OpenAPI and generate a draft |

Typical generation flow:

1. capture your prompt and optional image
2. send it through the configured provider
3. receive a structured graph representation
4. compose nodes and edges
5. apply layout
6. review the preview, then select **Apply to canvas** to replace or update the current graph

## Follow-up edits and automatic mode

After applying your first draft, Flowpilot defaults to **Edit current**. Short
requests such as “Add Redis” or “Rename it to Orders Cache” prepare edits rather
than another plan. If you explicitly asked for a plan, “Yes, do that” generates
its changes. A confirmation of an existing preview applies that preview without
another model request. **Create new** remains an explicit choice; Enter and the
send button use the same mode.

Previews list actual additions, removals, renames, and changed connections.
Unchanged nodes are not counted as updated. **View diagram code** expands the
DSL when needed. Discarded, replaced, and undone proposals remain marked in the
conversation, but their DSL is not treated as the current diagram. Answers
receive the current canvas, including manual changes.

Review is the default. Enable **Apply edits automatically** in Flowpilot to apply
completed edits without approval. Each edit is one undo step; **Undo AI edit**
reverts the latest AI change while it is still the current canvas operation.
After a manual edit, use the normal Undo/Redo controls so unrelated work is not
reverted accidentally. Automatic mode and model selection follow the existing
AI settings storage preference.

Model selection and automatic mode cannot be changed during a request.
Cancellation never applies a partial response. If you change the canvas while
Flowpilot is working, or before applying a pending preview, request an updated
draft rather than overwrite those changes. Pending previews are not restored
as applied work after a reload.

## Provider model

GitHub Copilot is the default engine, not an OpenAI-compatible API-key preset. The existing diagram harness still owns intent routing, asset grounding, parsing, automatic repair, layout, history, and preview approval.

Requests and automatic DSL repairs use your Copilot quota. Cancellation stops the SDK request. A failed or truncated stream is not applied, silently retried by the browser, or rerouted to another provider. The SDK manages its own transport retries.

CLI credentials remain on your computer. Prompts, conversation context, and attached images go through the local SDK to GitHub Copilot. The bridge accepts only same-origin loopback requests and disables file/shell tools, MCP servers, skills, ambient instructions, and shared session-store access. Temporary SDK sessions are removed after each request. This is not a multi-user public backend.

Alternative providers retain their existing browser-to-provider transports:

- Ollama
- Gemini
- OpenAI
- Claude
- Groq
- NVIDIA
- Cerebras
- Mistral
- OpenRouter
- Custom OpenAI-compatible endpoint

This matters because you are not locked to one hosted AI vendor or one billing model. Ollama can run locally with no API key when its daemon and model are available.

For these alternatives, API keys stay browser-local. Persistent keys can be stored for reuse on the current device, and session-only mode is available when you do not want the key to survive the browser session. Copilot does not use either API-key storage mode.

## When AI is the right tool

Use AI when:

- you are starting from a plain-language idea
- you want a fast first-pass architecture or workflow draft
- you want to revise an existing diagram conceptually rather than move boxes one by one
- you have source code and want a generated architecture view

Avoid AI when:

- you already have a precise text format such as Mermaid or OpenFlow DSL
- you need deterministic output from infrastructure files
- the diagram is small enough that manual editing is faster

In those cases, prefer [OpenFlow DSL](/openflow-dsl/), [Mermaid Integration](/mermaid-integration/), or [Infrastructure Sync](/infra-sync/).

## How to get better results

Strong prompts usually include:

- the intended audience
- the systems or actors involved
- important branches or failure paths
- the preferred diagram direction
- the level of detail you want

Weak prompts ask for “a diagram” without constraints. Strong prompts explain the system.

## Recommended workflow

1. Generate a first draft with Flowpilot.
2. Inspect the structure on the canvas.
3. Use the [Properties Panel](/properties-panel/) to normalize labels, color, and routing.
4. Run [Smart Layout](/smart-layout/) if the structure is right but spacing is poor.
5. Save a snapshot before another major rewrite.

## Practical caution

AI output should be treated as a draft, not a certified system model. For documentation, architecture review, or infra communication, you should still check naming, boundaries, and missing branches before exporting or sharing.

## Related pages

- [Ask Flowpilot](/ask-flowpilot/)
- [MCP Server](/mcp-server/)
- [Studio Overview](/studio-overview/)
- [Choose an Input Mode](/choose-input-mode/)
- [Prompting AI Agents](/prompting-agents/)
