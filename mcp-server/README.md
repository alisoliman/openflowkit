<div align="center">

# OpenFlowKit MCP Server

**Turn prompts and code into editable diagrams with GitHub Copilot App and CLI.**

Also works with Claude Code, Claude Desktop, Cursor, Windsurf, and other MCP clients.

[![npm](https://img.shields.io/npm/v/@vrun-design/openflowkit-mcp?style=flat-square&color=f97316)](https://www.npmjs.com/package/@vrun-design/openflowkit-mcp)
[![MIT License](https://img.shields.io/badge/License-MIT-f97316.svg?style=flat-square)](https://github.com/Vrun-design/openflowkit/blob/main/LICENSE)
[![Node 18+](https://img.shields.io/badge/Node-18%2B-339933.svg?style=flat-square)](https://nodejs.org/)

</div>

---

OpenFlowKit MCP is **local-first by design** — its tools run on your machine over stdio with no OpenFlowKit API key. GitHub Copilot or your other MCP client provides the model; OpenFlowKit provides diagram-specific tools. Model requests and tool results remain subject to your AI client's data policies.

It gives the agent diagram-specific powers:

- read the OpenFlow DSL reference
- inspect starter templates
- analyze local codebases
- find exact cloud and developer icon slugs
- validate agent-authored DSL
- create shareable OpenFlowKit viewer URLs

No API keys, no telemetry, no account, no server-side storage.

```
You:     Create a checkout flow with a promo-code branch
Copilot: finds a starter template and reads its DSL
         writes OpenFlow DSL itself
         calls validate_openflow_dsl
         fixes any issues
         calls create_viewer_url
         returns DSL + viewer link
```

---

## Before you start

Requires **Node.js 18+** on the machine running your MCP client. No global server installation is needed: the client launches `npx -y @vrun-design/openflowkit-mcp`, and `npx` downloads the package on first use.

Running the server command alone waits for an MCP client over stdio. It does not register the server with Copilot.

## GitHub Copilot App

1. Open **Customize → MCP** in the sidebar and add a custom server.
2. Choose a **local/stdio** server named `openflowkit`.
3. Set the command to `npx -y @vrun-design/openflowkit-mcp`.
4. Set `OPENFLOWKIT_APP_URL` to your OpenFlowKit deployment, such as `https://openflowkit.com`.
5. Save, then use **Customize → Installed** to manage the server.

Servers configured for Copilot CLI are automatically available in Copilot App too. There is no need to add the server twice. When editing the JSON file directly, start a new session afterward.

See the [official Copilot App guide](https://docs.github.com/en/copilot/how-tos/github-copilot-app/customize-github-copilot-app#configuring-mcp-servers).

## GitHub Copilot CLI

With Copilot CLI installed and signed in, run:

```bash
copilot mcp add openflowkit --env "OPENFLOWKIT_APP_URL=https://openflowkit.com" -- npx -y @vrun-design/openflowkit-mcp
```

Replace the app URL with your own deployment if needed. The MCP page automatically populates `OPENFLOWKIT_APP_URL` from its hosting origin. To override it, set the web app's build-time `VITE_APP_URL` variable and rebuild; copied commands, configuration, and share links will use that URL instead.

Start a new `copilot` session, then check the server:

```text
/mcp show openflowkit
```

You can also use `/mcp add` inside an interactive session: choose **Local** or **STDIO**, enter the server command, set the environment variables to `{"OPENFLOWKIT_APP_URL":"https://openflowkit.com"}`, leave **Tools** as `*`, and press **Ctrl+S**. Servers added through this form are available immediately.

See the [official Copilot CLI guide](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers).

### Shared App and CLI JSON configuration

Merge this entry into `~/.copilot/mcp-config.json`, or `%USERPROFILE%\.copilot\mcp-config.json` on Windows. Preserve your existing servers and settings:

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

These clients use the same server command and environment variable:

| Client | Configuration file | After saving |
|---|---|---|
| Claude Code | `.mcp.json` at the project root | Start Claude Code in the project, approve the project server when prompted, and check `/mcp` |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS), `%APPDATA%\Claude\claude_desktop_config.json` (Windows) | Restart and check the available tools |
| Cursor | `~/.cursor/mcp.json` | Enable `openflowkit` under **Tools & MCP** and use Agent mode |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | Refresh MCP servers and check Cascade |

Merge this entry into the selected client's configuration without removing existing servers:

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

Other clients can use this command, arguments, and environment variable in their own stdio configuration format.

## Check the connection

Ask your connected client:

```text
Call server_info from the openflowkit MCP server and report its version and available tools.
```

If the tools are missing, check that Node.js and `npx` are available to the client, that `openflowkit` is enabled, and that your organization's MCP policies permit the server.

---

## Tools

All tools run locally and require no provider key.

| Tool | What it does |
|---|---|
| `validate_openflow_dsl` | Lint OpenFlow DSL with structured diagnostics |
| `create_viewer_url` | Encode OpenFlow DSL into a shareable OpenFlowKit viewer URL |
| `analyze_codebase` | Detect platforms, services, top-level structure, and language mix from a local repo |
| `find_icon` | Fuzzy-search 1,600+ AWS, Azure, GCP, CNCF, and developer icons |
| `list_starter_templates` | Browse built-in starter templates |
| `get_starter_template` | Fetch a named starter template as DSL |
| `list_diagram_node_types` | Return DSL node and edge reference data |
| `server_info` | Return version and capability metadata |

---

## Resources

Clients that support MCP resources can read these directly. Clients that expose only tools can use `list_starter_templates`, `get_starter_template`, and `list_diagram_node_types` to learn the DSL.

| URI | Description |
|---|---|
| `openflowkit://docs/dsl-cheatsheet` | OpenFlow DSL syntax reference |
| `openflowkit://templates` | Starter template catalog |
| `openflowkit://templates/{name}` | DSL for a named starter template |
| `openflowkit://icons` | Full icon catalog |
| `openflowkit://icons/{provider}` | Icon catalog for one provider pack |

Provider packs are `aws`, `azure`, `gcp`, `cncf`, and `developer`.

---

## Prompts

Clients can surface three prompt templates:

- `flowchart_from_description` — agent writes, validates, and links a flowchart
- `convert_mermaid_to_openflow` — agent converts Mermaid into OpenFlow DSL, validates it, and links it
- `architecture_from_codebase` — agent scans a local repo, picks icon slugs, validates DSL, and links the result

---

## Recommended agent workflow

Ask your MCP client:

```text
Use the openflowkit MCP tools to create a checkout flow with cart, shipping, a promo-code decision, payment, and confirmation. Start with list_starter_templates and get_starter_template to learn the DSL. Call validate_openflow_dsl, fix any errors, then call create_viewer_url. Return the final DSL and viewer link.
```

For architecture diagrams:

```text
Using openflowkit: call analyze_codebase on /path/to/project, use list_starter_templates and get_starter_template for an architecture example, use find_icon for exact icons, write OpenFlow DSL, validate it, then create a viewer URL.
```

---

## Privacy model

- **No telemetry.** The server never phones home.
- **No provider keys.** The MCP client model authors diagrams directly.
- **No OpenFlowKit account.** Viewer URLs encode the DSL locally in the URL hash.
- **Local filesystem access only when requested.** Codebase analysis only reads the path passed to `analyze_codebase`.
- **Your client's policies still apply.** Tool results are returned to your AI client, which handles model requests.

---

## Development

This package lives in the [openflowkit monorepo](https://github.com/Vrun-design/openflowkit).

```bash
# From the repo root
npm install --workspace=mcp-server
npm run --workspace=mcp-server build
npm run --workspace=mcp-server test:run

# Run locally against the MCP Inspector
npx @modelcontextprotocol/inspector dist/index.js
```

The MCP Inspector gives you a UI to manually call every tool, browse every resource, and verify client behavior before publishing.
