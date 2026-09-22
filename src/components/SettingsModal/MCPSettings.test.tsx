import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/i18n/locales/en/translation.json';
import { HomeMCPView } from '../home/HomeMCPView';
import { buildCopilotCommand, buildMcpConfig, MCPSettings } from './MCPSettings';

const i18n = createInstance();
const writeText = vi.fn<Clipboard['writeText']>();
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

beforeEach(async () => {
  vi.stubEnv('VITE_APP_URL', '');
  await i18n.init({
    lng: 'en',
    resources: { en: { translation: en } },
    interpolation: { escapeValue: false },
  });
  writeText.mockReset().mockResolvedValue();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  if (originalClipboard) {
    Object.defineProperty(navigator, 'clipboard', originalClipboard);
  } else {
    Reflect.deleteProperty(navigator, 'clipboard');
  }
});

function renderSettings(variant: 'page' | 'panel' = 'panel'): void {
  render(
    <I18nextProvider i18n={i18n}>
      <MCPSettings variant={variant} />
    </I18nextProvider>
  );
}

describe('buildMcpConfig', () => {
  it('points MCP viewer links at the current hosted app', () => {
    const config = JSON.parse(buildMcpConfig('https://example.azurestaticapps.net/'));

    expect(config.mcpServers.openflowkit.env).toEqual({
      OPENFLOWKIT_APP_URL: 'https://example.azurestaticapps.net',
    });
  });

  it.each(['copilot-app', 'copilot-cli'] as const)('uses the Copilot schema for %s', (client) => {
    const config = JSON.parse(buildMcpConfig('https://example.test', client));

    expect(config).toEqual({
      mcpServers: {
        openflowkit: {
          type: 'local',
          command: 'npx',
          args: ['-y', '@vrun-design/openflowkit-mcp'],
          env: { OPENFLOWKIT_APP_URL: 'https://example.test' },
          tools: ['*'],
        },
      },
    });
  });

  it.each(['claude-code', 'claude', 'cursor', 'windsurf'] as const)(
    'keeps the standard client configuration for %s',
    (client) => {
      const config = JSON.parse(buildMcpConfig('https://example.test/', client));

      expect(config.mcpServers.openflowkit).toEqual({
        command: 'npx',
        args: ['-y', '@vrun-design/openflowkit-mcp'],
        env: { OPENFLOWKIT_APP_URL: 'https://example.test' },
      });
    }
  );
});

describe('buildCopilotCommand', () => {
  it('registers the server and preserves the current deployment URL', () => {
    expect(buildCopilotCommand('https://example.azurestaticapps.net/')).toBe(
      'copilot mcp add openflowkit --env "OPENFLOWKIT_APP_URL=https://example.azurestaticapps.net" -- npx -y @vrun-design/openflowkit-mcp'
    );
  });
});

describe('MCP setup experience', () => {
  it('uses the deployment URL in the App settings, copied JSON, setup prompt, and CLI command', async () => {
    const appUrl = 'https://diagrams.example.com/openflowkit';
    vi.stubEnv('VITE_APP_URL', ` ${appUrl}/ `);
    renderSettings();

    expect(screen.getByText(`OPENFLOWKIT_APP_URL=${appUrl}`, { exact: true })).toBeVisible();
    fireEvent.click(screen.getByText('JSON configuration and setup prompt'));
    fireEvent.click(screen.getByRole('button', { name: 'Copy MCP config' }));
    await waitFor(() => {
      expect(writeText).toHaveBeenLastCalledWith(buildMcpConfig(appUrl));
    });

    fireEvent.click(screen.getByRole('button', { name: 'Copy setup prompt' }));
    await waitFor(() => {
      expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining(appUrl));
    });
    expect(writeText.mock.lastCall?.[0]).not.toContain(window.location.origin);

    fireEvent.click(screen.getByRole('radio', { name: 'GitHub Copilot CLI' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy setup command' }));
    await waitFor(() => {
      expect(writeText).toHaveBeenLastCalledWith(buildCopilotCommand(appUrl));
    });

    fireEvent.click(screen.getByRole('radio', { name: 'Cursor' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy MCP config' }));
    await waitFor(() => {
      expect(writeText).toHaveBeenLastCalledWith(buildMcpConfig(appUrl, 'cursor'));
    });
  });

  it('features App and CLI first and defaults to Copilot App', () => {
    renderSettings();

    const clients = screen.getAllByRole('radio');
    expect(clients.map((client) => client.getAttribute('aria-label'))).toEqual([
      'GitHub Copilot App',
      'GitHub Copilot CLI',
      'Claude Code',
      'Claude Desktop',
      'Cursor',
      'Windsurf',
    ]);
    expect(clients[0]).toBeChecked();
    expect(screen.getByRole('heading', { name: 'GitHub Copilot App setup' })).toBeVisible();
    expect(screen.getByText(/open Customize → MCP/)).toBeVisible();
    expect(screen.getByText(/One configuration, both clients/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'GitHub Copilot setup guide' })).toHaveAttribute(
      'href',
      expect.stringContaining('/github-copilot-app/')
    );
  });

  it('switches to CLI-specific registration and verification instructions', async () => {
    renderSettings();
    fireEvent.click(screen.getByRole('radio', { name: 'GitHub Copilot CLI' }));

    expect(screen.getByRole('heading', { name: 'GitHub Copilot CLI setup' })).toBeVisible();
    expect(screen.getByText(/\/mcp show openflowkit/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'GitHub Copilot setup guide' })).toHaveAttribute(
      'href',
      expect.stringContaining('/copilot-cli/')
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy setup command' }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(buildCopilotCommand(window.location.origin));
    });
    expect(screen.getByText('Copied')).toBeVisible();
  });

  it('copies the shared Copilot JSON and a non-destructive setup prompt', async () => {
    renderSettings();
    fireEvent.click(screen.getByText('JSON configuration and setup prompt'));
    fireEvent.click(screen.getByRole('button', { name: 'Copy MCP config' }));

    await waitFor(() => {
      expect(writeText).toHaveBeenLastCalledWith(buildMcpConfig(window.location.origin));
    });

    fireEvent.click(screen.getByRole('button', { name: 'Copy setup prompt' }));
    await waitFor(() => {
      expect(writeText).toHaveBeenLastCalledWith(
        expect.stringContaining('preserving all other servers and settings')
      );
    });
    expect(writeText.mock.lastCall?.[0]).toContain('~/.copilot/mcp-config.json');
    expect(writeText.mock.lastCall?.[0]).toContain('%USERPROFILE%\\.copilot\\mcp-config.json');
    expect(writeText.mock.lastCall?.[0]).toContain('GitHub Copilot App');
    expect(writeText.mock.lastCall?.[0]).toContain(window.location.origin);
  });

  it.each([
    { name: 'Claude Code', id: 'claude-code', path: '.mcp.json' },
    {
      name: 'Claude Desktop',
      id: 'claude',
      path: '~/Library/Application Support/Claude/claude_desktop_config.json',
    },
    { name: 'Cursor', id: 'cursor', path: '~/.cursor/mcp.json' },
    { name: 'Windsurf', id: 'windsurf', path: '~/.codeium/windsurf/mcp_config.json' },
  ] as const)('keeps $name setup and copy actions working', async ({ name, id, path }) => {
    renderSettings();
    fireEvent.click(screen.getByRole('radio', { name }));

    expect(screen.getByRole('heading', { name: `${name} setup` })).toBeVisible();
    expect(screen.getByText(path, { exact: true })).toBeVisible();
    expect(
      screen.queryByRole('link', { name: 'GitHub Copilot setup guide' })
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copy MCP config' }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(buildMcpConfig(window.location.origin, id));
    });
  });

  it('surfaces clipboard errors and lets the user retry', async () => {
    writeText.mockRejectedValueOnce(new Error('Permission denied'));
    renderSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Copy setup command' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Clipboard access failed. Select and copy the text above manually.'
    );
    expect(screen.queryByText('Copied')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Copy setup command' }));
    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Copied')).toBeVisible();
  });

  it('offers a tools-only first diagram prompt and all eight tools', async () => {
    renderSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Copy diagram prompt' }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(en.mcpSettings.diagramPrompt);
    });
    expect(writeText.mock.lastCall?.[0]).toContain('get_starter_template');
    expect(writeText.mock.lastCall?.[0]).not.toContain('openflowkit://');

    fireEvent.click(screen.getByText('Explore the 8 diagramming tools'));
    for (const tool of [
      'validate_openflow_dsl',
      'create_viewer_url',
      'analyze_codebase',
      'find_icon',
      'list_starter_templates',
      'get_starter_template',
      'list_diagram_node_types',
      'server_info',
    ]) {
      expect(screen.getByText(tool, { exact: true })).toBeVisible();
    }
  });

  it('uses distinct control groups when page and settings are mounted together', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <MCPSettings variant="page" />
        <MCPSettings />
      </I18nextProvider>
    );

    const clients = screen.getAllByRole('radio', { name: 'GitHub Copilot App' });
    expect(clients[0].getAttribute('name')).not.toBe(clients[1].getAttribute('name'));
    const headings = screen.getAllByRole('heading', { name: 'GitHub Copilot App setup' });
    expect(headings[0].id).not.toBe(headings[1].id);
  });

  it('updates the standalone page heading and connection visual', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <HomeMCPView />
      </I18nextProvider>
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'Diagram with GitHub Copilot' })
    ).toBeVisible();
    expect(screen.getByRole('figure')).toHaveAccessibleName(en.mcp.visualAlt);
    expect(screen.getByText(en.mcp.visualCaption)).toBeVisible();
    expect(
      screen.queryByRole('heading', { name: 'Connect GitHub Copilot' })
    ).not.toBeInTheDocument();
  });
});
