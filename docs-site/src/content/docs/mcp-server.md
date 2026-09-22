---
draft: false
title: MCP Server
description: Set up OpenFlowKit diagramming tools in GitHub Copilot App and CLI, with options for Claude Code, Claude Desktop, Cursor, and Windsurf.
---

Give **GitHub Copilot App and CLI** local tools to turn prompts and code into editable diagrams. Copilot uses its own model to author diagrams; OpenFlowKit supplies validation, templates, icon lookup, codebase analysis, and viewer links. Claude Code, Claude Desktop, Cursor, Windsurf, and other MCP clients remain supported.

The package is `@vrun-design/openflowkit-mcp`. Its tools run locally over MCP's stdio transport and require no OpenFlowKit API key. Your AI client's model requests still follow that client's data policies.

## Before you start

Install **Node.js 18 or newer** on the machine running your client. No global server installation is needed: your MCP client launches the following command, and `npx` downloads the package on first use.

```bash
npx -y @vrun-design/openflowkit-mcp
```

Running this command by itself starts the stdio server and waits for an MCP client. It does **not** register the server with Copilot.

## GitHub Copilot App

1. Open **Customize → MCP** in the app sidebar and add a custom server.
2. Choose a **local/stdio** server named `openflowkit`.
3. Set the command to `npx -y @vrun-design/openflowkit-mcp`.
4. Set the environment variable `OPENFLOWKIT_APP_URL` to your OpenFlowKit deployment, for example `https://openflowkit.com`.
5. Save the server. Use **Customize → Installed** to manage it.

MCP servers configured for Copilot CLI are also available in Copilot App; you do not need to add the same server twice. If you edit the JSON configuration directly, start a new Copilot session to load the change.

See GitHub's [Copilot App customization guide](https://docs.github.com/en/copilot/how-tos/github-copilot-app/customize-github-copilot-app#configuring-mcp-servers).

## GitHub Copilot CLI

With Copilot CLI installed and signed in, register the server from your terminal:

```bash
copilot mcp add openflowkit --env "OPENFLOWKIT_APP_URL=https://openflowkit.com" -- npx -y @vrun-design/openflowkit-mcp
```

Replace the app URL with your own deployment if needed. The MCP page automatically populates `OPENFLOWKIT_APP_URL` from its hosting origin. For a fixed override, set the web app's build-time `VITE_APP_URL` variable and rebuild. The MCP setup commands, JSON configuration, and share links will all use that URL.

Start a new `copilot` session, then run:

```text
/mcp show openflowkit
```

Alternatively, run `/mcp add` inside an interactive session. Enter `openflowkit` as the name, choose **Local** or **STDIO**, use the server command above, and set the environment variables to `{"OPENFLOWKIT_APP_URL":"https://openflowkit.com"}`. Keep **Tools** as `*`, then press **Ctrl+S**. Servers added through this form are available immediately.

See GitHub's [Copilot CLI MCP guide](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers).

### Shared App and CLI configuration

You can also merge this entry into `~/.copilot/mcp-config.json` (`%USERPROFILE%\.copilot\mcp-config.json` on Windows). Preserve existing servers and settings rather than replacing the file:

```json
{
  "mcpServers": {
    "openflowkit": {
      "type": "local",
      "command": "npx",
      "args": ["-y", "@vrun-design/openflowkit-mcp"],
      "env": {
        "OPENFLOWKIT_APP_URL": "https://openflowkit.com"
      },
      "tools": ["*"]
    }
  }
}
```

## Other MCP clients

Use the same server with your preferred client. Merge the following entry into the appropriate configuration file, keeping any existing servers:

| Client | Configuration | After saving |
| --- | --- | --- |
| Claude Code | `.mcp.json` at your project root | Start in that project, approve the project server when prompted, and check `/mcp` |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS; `%APPDATA%\Claude\claude_desktop_config.json` on Windows | Restart Claude Desktop and check its available tools |
| Cursor | `~/.cursor/mcp.json` | Enable `openflowkit` in **Tools & MCP** and use Agent mode |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | Refresh MCP servers and check Cascade |

```json
{
  "mcpServers": {
    "openflowkit": {
      "command": "npx",
      "args": ["-y", "@vrun-design/openflowkit-mcp"],
      "env": {
        "OPENFLOWKIT_APP_URL": "https://openflowkit.com"
      }
    }
  }
}
```

Other clients can use the same command, arguments, and environment variable in their own stdio configuration format.

## Check the connection

Ask your connected client:

```text
Call server_info from the openflowkit MCP server and report its version and available tools.
```

If the tools do not appear, check that Node.js and `npx` are available to the client, that the server is enabled, and that your organization's MCP policies allow it.

## How generation works

OpenFlowKit MCP is agent-native:

1. The agent uses `list_starter_templates` and `get_starter_template` to learn the DSL, or reads `openflowkit://docs/dsl-cheatsheet` if its client supports MCP resources.
2. The agent writes OpenFlow DSL itself.
3. The agent calls `find_icon` when it needs exact cloud or developer icon slugs.
4. The agent calls `validate_openflow_dsl`.
5. The agent fixes any diagnostics.
6. The agent calls `create_viewer_url`.
7. The agent returns editable DSL and a viewer link.

No OpenFlowKit API key is required. Copilot or your other AI client handles model access.

## Tools

The current server exposes 8 local-first tools (no API key, deterministic, run on your machine):

| Tool | What it does |
| --- | --- |
| `validate_openflow_dsl` | Lint DSL with structured diagnostics |
| `create_viewer_url` | Create a shareable OpenFlowKit viewer URL from DSL |
| `analyze_codebase` | Detect platforms, services, top-level structure, and language mix from a local repo |
| `find_icon` | Search 1,600+ provider and developer icons for exact `archProvider` and `archResourceType` values |
| `list_starter_templates` | Browse built-in templates |
| `get_starter_template` | Fetch a template's DSL |
| `list_diagram_node_types` | Return DSL node and edge reference data |
| `server_info` | Return version and capability metadata |

## Resources and prompts

The server exposes five resources:

| URI | Description |
| --- | --- |
| `openflowkit://docs/dsl-cheatsheet` | OpenFlow DSL syntax reference |
| `openflowkit://templates` | Starter template catalog |
| `openflowkit://templates/{name}` | DSL for a named starter template |
| `openflowkit://icons` | Full architecture icon catalog |
| `openflowkit://icons/{provider}` | Icons for one provider pack (`aws`, `azure`, `gcp`, `cncf`, or `developer`) |

Clients can also surface three prompt templates: `flowchart_from_description`, `convert_mermaid_to_openflow`, and `architecture_from_codebase`.

## Try it

Paste this into a connected MCP client:

```text
Use the openflowkit MCP tools to create a checkout flow with cart, shipping, a promo-code decision, payment, and confirmation. Start with list_starter_templates and get_starter_template to learn the DSL. Call validate_openflow_dsl, fix any errors, then call create_viewer_url. Return the final DSL and viewer link.
```

For codebases:

```text
Using openflowkit: call analyze_codebase on /path/to/project, use list_starter_templates and get_starter_template for an architecture example, use find_icon for exact icons, write OpenFlow DSL, validate it, then create a viewer URL.
```

## Privacy model

The server does not store diagrams, require an OpenFlowKit account, ask for provider keys, or phone home. Local tools run on your machine. Codebase analysis only reads the directory you explicitly pass to `analyze_codebase`. Tool results are returned to your AI client; that client's model and data policies still apply.

## Related pages

- [OpenFlow DSL](/openflow-dsl/)
- [AI Generation](/ai-generation/)
- [Prompting AI Agents](/prompting-agents/)
