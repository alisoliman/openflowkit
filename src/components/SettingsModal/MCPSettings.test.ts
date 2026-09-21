import { describe, expect, it } from 'vitest';
import { buildMcpConfig } from './MCPSettings';

describe('buildMcpConfig', () => {
  it('points MCP viewer links at the current hosted app', () => {
    const config = JSON.parse(buildMcpConfig('https://example.azurestaticapps.net/'));

    expect(config.mcpServers.openflowkit.env).toEqual({
      OPENFLOWKIT_APP_URL: 'https://example.azurestaticapps.net',
    });
  });
});
