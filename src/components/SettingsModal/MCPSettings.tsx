import React, { useEffect, useId, useState } from 'react';
import { ArrowUpRight, Check, Code2, Copy, MousePointer2, Terminal, Wind } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getAppUrl } from '@/lib/appUrl';
import { CopilotIcon } from '../icons/CopilotIcon';

type ClientId = 'copilot-app' | 'copilot-cli' | 'claude-code' | 'claude' | 'cursor' | 'windsurf';

interface ClientOption {
  id: ClientId;
  label: string;
  configPath: string;
  windowsConfigPath?: string;
}

const CLIENTS: ClientOption[] = [
  {
    id: 'copilot-app',
    label: 'GitHub Copilot App',
    configPath: '~/.copilot/mcp-config.json',
    windowsConfigPath: '%USERPROFILE%\\.copilot\\mcp-config.json',
  },
  {
    id: 'copilot-cli',
    label: 'GitHub Copilot CLI',
    configPath: '~/.copilot/mcp-config.json',
    windowsConfigPath: '%USERPROFILE%\\.copilot\\mcp-config.json',
  },
  { id: 'claude-code', label: 'Claude Code', configPath: '.mcp.json' },
  {
    id: 'claude',
    label: 'Claude Desktop',
    configPath: '~/Library/Application Support/Claude/claude_desktop_config.json',
    windowsConfigPath: '%APPDATA%\\Claude\\claude_desktop_config.json',
  },
  { id: 'cursor', label: 'Cursor', configPath: '~/.cursor/mcp.json' },
  { id: 'windsurf', label: 'Windsurf', configPath: '~/.codeium/windsurf/mcp_config.json' },
];

const SERVER_COMMAND = 'npx -y @vrun-design/openflowkit-mcp';
const COPILOT_DOCS = {
  app: 'https://docs.github.com/en/copilot/how-tos/github-copilot-app/customize-github-copilot-app#configuring-mcp-servers',
  cli: 'https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers',
};

export function buildMcpConfig(appUrl: string, client: ClientId = 'copilot-app'): string {
  const isCopilot = client === 'copilot-app' || client === 'copilot-cli';

  return JSON.stringify(
    {
      mcpServers: {
        openflowkit: {
          ...(isCopilot ? { type: 'local' } : {}),
          command: 'npx',
          args: ['-y', '@vrun-design/openflowkit-mcp'],
          env: {
            OPENFLOWKIT_APP_URL: appUrl.replace(/\/+$/, ''),
          },
          ...(isCopilot ? { tools: ['*'] } : {}),
        },
      },
    },
    null,
    2
  );
}

export function buildCopilotCommand(appUrl: string): string {
  const environment = `OPENFLOWKIT_APP_URL=${appUrl.replace(/\/+$/, '')}`;
  return `copilot mcp add openflowkit --env ${JSON.stringify(environment)} -- ${SERVER_COMMAND}`;
}

function ClientIcon({
  client,
  className = 'h-5 w-5',
}: {
  client: ClientId;
  className?: string;
}): React.ReactElement {
  switch (client) {
    case 'copilot-app':
      return <CopilotIcon className={className} />;
    case 'copilot-cli':
      return <Terminal aria-hidden="true" className={className} />;
    case 'claude-code':
      return <Code2 aria-hidden="true" className={className} />;
    case 'claude':
      return (
        <span
          aria-hidden="true"
          className={`shrink-0 bg-current ${className}`}
          style={{
            mask: 'url("/logos/claude.svg") center / contain no-repeat',
            WebkitMask: 'url("/logos/claude.svg") center / contain no-repeat',
          }}
        />
      );
    case 'cursor':
      return <MousePointer2 aria-hidden="true" className={className} />;
    case 'windsurf':
      return <Wind aria-hidden="true" className={className} />;
  }
}

function CodeSurface({
  code,
  ariaLabel,
  caption,
  wrap = false,
}: {
  code: string;
  ariaLabel: string;
  caption: string;
  wrap?: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');

  useEffect(() => {
    if (copyState !== 'copied') return;
    const timeout = window.setTimeout(() => setCopyState('idle'), 1400);
    return () => window.clearTimeout(timeout);
  }, [copyState]);

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      setCopyState('copied');
    } catch {
      setCopyState('error');
    }
  }

  return (
    <div className="min-w-0 max-w-full overflow-hidden rounded-lg border border-[var(--color-brand-border)] bg-[var(--brand-background)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-brand-border)] px-3 py-1.5">
        <span className="min-w-0 break-all font-mono text-xs text-[var(--brand-secondary)]">
          {caption}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={ariaLabel}
          className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-[var(--brand-secondary)] transition-colors hover:bg-[var(--brand-surface)] hover:text-[var(--brand-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)]"
        >
          {copyState === 'copied' ? (
            <Check aria-hidden="true" className="h-3.5 w-3.5" />
          ) : (
            <Copy aria-hidden="true" className="h-3.5 w-3.5" />
          )}
          <span aria-live="polite">
            {copyState === 'copied'
              ? t('mcpSettings.copied', 'Copied')
              : t('mcpSettings.copy', 'Copy')}
          </span>
        </button>
      </div>
      <pre
        className={`px-3 py-3 font-mono text-xs leading-relaxed text-[var(--brand-text)] ${
          wrap ? 'whitespace-pre-wrap break-words' : 'overflow-x-auto'
        }`}
      >
        <code>{code}</code>
      </pre>
      {copyState === 'error' && (
        <p
          role="alert"
          className="border-t border-[var(--color-brand-border)] px-3 py-2 text-xs text-[var(--color-surface-danger-text)]"
        >
          {t(
            'mcpSettings.copyError',
            'Clipboard access failed. Select and copy the text above manually.'
          )}
        </p>
      )}
    </div>
  );
}

function StepRail({
  index,
  title,
  children,
  isLast,
}: {
  index: number;
  title: string;
  children: React.ReactNode;
  isLast?: boolean;
}): React.ReactElement {
  return (
    <li className="grid grid-cols-[28px_minmax(0,1fr)] gap-3 sm:gap-4">
      <div className="flex flex-col items-center">
        <span
          aria-hidden="true"
          className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[var(--color-brand-border)] bg-[var(--brand-surface)] text-xs font-semibold text-[var(--brand-text)]"
        >
          {index}
        </span>
        {!isLast && (
          <span aria-hidden="true" className="mt-1 w-px flex-1 bg-[var(--color-brand-border)]" />
        )}
      </div>
      <div className="min-w-0 pb-7">
        <h3 className="pt-0.5 text-sm font-semibold text-[var(--brand-text)]">{title}</h3>
        <div className="mt-3 space-y-3 text-sm leading-relaxed text-[var(--brand-secondary)]">
          {children}
        </div>
      </div>
    </li>
  );
}

interface MCPSettingsProps {
  variant?: 'page' | 'panel';
}

export function MCPSettings({ variant = 'panel' }: MCPSettingsProps = {}): React.ReactElement {
  const { t } = useTranslation();
  const pickerId = useId();
  const [client, setClient] = useState<ClientId>('copilot-app');
  const activeClient = CLIENTS.find((option) => option.id === client)!;
  const isCopilot = client === 'copilot-app' || client === 'copilot-cli';
  const appUrl = getAppUrl();
  const config = buildMcpConfig(appUrl, client);
  const environment = `OPENFLOWKIT_APP_URL=${appUrl}`;
  const instructions: Record<ClientId, { add: string; verify: string }> = {
    'copilot-app': {
      add: t(
        'mcpSettings.appSetup',
        'In GitHub Copilot App, open Customize → MCP and add a custom server. Choose a local/stdio server and use these settings.'
      ),
      verify: t(
        'mcpSettings.appVerify',
        'Save the server, then open Customize → Installed to manage it. If you edited the JSON file, start a new Copilot session to load the change.'
      ),
    },
    'copilot-cli': {
      add: t(
        'mcpSettings.cliSetup',
        'With Copilot CLI installed and signed in, run this in your terminal. It registers OpenFlowKit in your user-level MCP configuration.'
      ),
      verify: t(
        'mcpSettings.cliVerify',
        'Start a new copilot session, then run /mcp show openflowkit to check its tools. You can also add servers interactively with /mcp add; those are available immediately.'
      ),
    },
    'claude-code': {
      add: t(
        'mcpSettings.claudeCodeSetup',
        'Merge this configuration into .mcp.json at your project root. Keep any existing servers.'
      ),
      verify: t(
        'mcpSettings.claudeCodeVerify',
        'Start Claude Code in the project, approve the project MCP server when prompted, and use /mcp to check the connection.'
      ),
    },
    claude: {
      add: t(
        'mcpSettings.claudeSetup',
        'Open Claude Desktop settings, go to Developer → Edit Config, and merge this server into your configuration.'
      ),
      verify: t(
        'mcpSettings.claudeVerify',
        'Restart Claude Desktop, then check that openflowkit appears in the available tools.'
      ),
    },
    cursor: {
      add: t(
        'mcpSettings.cursorSetup',
        'Merge this server into your Cursor MCP configuration. Keep any existing servers.'
      ),
      verify: t(
        'mcpSettings.cursorVerify',
        'Open Cursor settings → Tools & MCP and enable openflowkit. Use Agent mode to access its tools.'
      ),
    },
    windsurf: {
      add: t(
        'mcpSettings.windsurfSetup',
        'Merge this server into your Windsurf MCP configuration. Keep any existing servers.'
      ),
      verify: t(
        'mcpSettings.windsurfVerify',
        'Refresh MCP servers in Windsurf settings, then open Cascade and check that openflowkit is available.'
      ),
    },
  };
  const toolGroups = [
    {
      label: t('mcpSettings.author', 'Author'),
      tools: [
        {
          name: 'validate_openflow_dsl',
          desc: t('mcpSettings.toolValidate', 'Validate agent-authored DSL'),
        },
        {
          name: 'create_viewer_url',
          desc: t('mcpSettings.toolViewer', 'Create an editable diagram link'),
        },
      ],
    },
    {
      label: t('mcpSettings.inspect', 'Inspect'),
      tools: [
        {
          name: 'analyze_codebase',
          desc: t('mcpSettings.toolAnalyze', 'Inspect a local codebase'),
        },
        { name: 'find_icon', desc: t('mcpSettings.toolIcons', 'Find cloud and developer icons') },
      ],
    },
    {
      label: t('mcpSettings.discover', 'Discover'),
      tools: [
        {
          name: 'list_starter_templates',
          desc: t('mcpSettings.toolTemplates', 'Browse starter templates'),
        },
        {
          name: 'get_starter_template',
          desc: t('mcpSettings.toolTemplate', 'Read a template and its DSL'),
        },
        {
          name: 'list_diagram_node_types',
          desc: t('mcpSettings.toolNodes', 'Explore node types and shapes'),
        },
        { name: 'server_info', desc: t('mcpSettings.toolInfo', 'Check version and capabilities') },
      ],
    },
  ];
  const installPrompt = t('mcpSettings.installPrompt', {
    defaultValue:
      'Add an MCP server named "openflowkit" to {{path}} for {{client}}. Merge the entry below into the existing mcpServers object, preserving all other servers and settings. Create the file if it does not exist. Explain how to reload the client after saving.\n\n{{config}}',
    path: activeClient.windowsConfigPath
      ? `${activeClient.configPath} (Windows: ${activeClient.windowsConfigPath})`
      : activeClient.configPath,
    client: activeClient.label,
    config,
  });

  function renderClient(option: ClientOption, featured: boolean): React.ReactElement {
    const selected = option.id === client;
    return (
      <label key={option.id} className="relative cursor-pointer">
        <input
          type="radio"
          name={pickerId}
          value={option.id}
          checked={selected}
          onChange={() => setClient(option.id)}
          aria-label={option.label}
          className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0"
        />
        <span
          className={`flex h-full items-center gap-3 rounded-lg border transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--brand-primary)] ${
            featured ? 'min-h-24 px-4 py-4' : 'min-h-11 px-3 py-2'
          } ${
            selected
              ? 'border-[var(--brand-primary)] bg-[var(--brand-background)] text-[var(--brand-text)]'
              : 'border-[var(--color-brand-border)] text-[var(--brand-secondary)] hover:border-[var(--brand-secondary)] hover:text-[var(--brand-text)]'
          }`}
        >
          <ClientIcon
            client={option.id}
            className={featured ? 'h-7 w-7 shrink-0' : 'h-4 w-4 shrink-0'}
          />
          <span className="min-w-0 flex-1">
            <span className={`block font-semibold ${featured ? 'text-sm' : 'text-xs'}`}>
              {option.label}
            </span>
            {featured && (
              <span className="mt-1 block text-xs font-normal text-[var(--brand-secondary)]">
                {option.id === 'copilot-app'
                  ? t('mcpSettings.appDescription', 'Set up in your desktop workspace')
                  : t('mcpSettings.cliDescription', 'Set up from your terminal')}
              </span>
            )}
          </span>
          {featured && (
            <Check
              aria-hidden="true"
              className={`h-4 w-4 shrink-0 ${selected ? '' : 'invisible'}`}
            />
          )}
        </span>
      </label>
    );
  }

  return (
    <div className="min-w-0 space-y-7">
      {variant === 'panel' && (
        <header>
          <div className="flex items-center gap-2.5 text-[var(--brand-text)]">
            <CopilotIcon />
            <h3 className="text-base font-semibold tracking-tight">
              {t('mcpSettings.title', 'Connect GitHub Copilot')}
            </h3>
          </div>
          <p className="mt-2 max-w-[70ch] text-sm leading-relaxed text-[var(--brand-secondary)]">
            {t(
              'mcpSettings.intro',
              'Bring OpenFlowKit diagramming tools to GitHub Copilot App or CLI. Claude Code, Claude Desktop, Cursor, and Windsurf are supported too.'
            )}
          </p>
        </header>
      )}

      <fieldset className="min-w-0 space-y-3">
        <legend className="mb-3 text-base font-semibold text-[var(--brand-text)]">
          {t('mcpSettings.clientPicker', 'Choose your client')}
        </legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {CLIENTS.slice(0, 2).map((option) => renderClient(option, true))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-xs text-[var(--brand-secondary)]">
            {t('mcpSettings.otherClients', 'Other MCP clients')}
          </span>
          {CLIENTS.slice(2).map((option) => renderClient(option, false))}
        </div>
      </fieldset>

      <section
        key={client}
        aria-labelledby={`${pickerId}-setup`}
        className="min-w-0 border-t border-[var(--color-brand-border)] pt-6"
      >
        <div className="mb-5">
          <h2
            id={`${pickerId}-setup`}
            className="text-lg font-semibold tracking-tight text-[var(--brand-text)]"
          >
            {t('mcpSettings.setupTitle', {
              defaultValue: '{{client}} setup',
              client: activeClient.label,
            })}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-[var(--brand-secondary)]">
            {t(
              'mcpSettings.installNote',
              'Requires Node.js 18+ where your client runs. No global server install needed; npx downloads it on first use.'
            )}
          </p>
          {isCopilot && (
            <p className="mt-2 text-xs leading-relaxed text-[var(--brand-secondary)]">
              {t(
                'mcpSettings.sharedConfig',
                'One configuration, both clients: MCP servers configured for Copilot CLI are also available in Copilot App.'
              )}
            </p>
          )}
        </div>

        <ol className="list-none" aria-label={t('mcpSettings.stepsLabel', 'Setup steps')}>
          <StepRail index={1} title={t('mcpSettings.configHeading', 'Add the server')}>
            <p>{instructions[client].add}</p>
            {isCopilot && (
              <CodeSurface
                code={client === 'copilot-cli' ? buildCopilotCommand(appUrl) : SERVER_COMMAND}
                ariaLabel={t('mcpSettings.copyInstall', 'Copy setup command')}
                caption={client === 'copilot-cli' ? 'terminal' : 'command'}
                wrap
              />
            )}
            {client === 'copilot-app' && (
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-xs">
                <dt>{t('mcpSettings.serverName', 'Server name')}</dt>
                <dd className="font-mono text-[var(--brand-text)]">openflowkit</dd>
                <dt>{t('mcpSettings.transport', 'Transport')}</dt>
                <dd className="font-mono text-[var(--brand-text)]">stdio</dd>
                <dt>{t('mcpSettings.environment', 'Environment')}</dt>
                <dd className="break-all font-mono text-[var(--brand-text)]">{environment}</dd>
              </dl>
            )}

            <details open={!isCopilot} className="min-w-0">
              <summary className="w-fit cursor-pointer rounded py-1 text-xs font-semibold text-[var(--brand-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)]">
                {t('mcpSettings.manualConfig', 'JSON configuration and setup prompt')}
              </summary>
              <div className="mt-3 space-y-3">
                <p className="text-xs">
                  {t(
                    'mcpSettings.mergeNote',
                    'Merge the openflowkit entry into mcpServers. Preserve your other servers and settings.'
                  )}
                </p>
                {activeClient.windowsConfigPath && (
                  <p className="break-all text-xs">
                    Windows:{' '}
                    <code className="font-mono text-[var(--brand-text)]">
                      {activeClient.windowsConfigPath}
                    </code>
                  </p>
                )}
                <CodeSurface
                  code={config}
                  ariaLabel={t('mcpSettings.copyConfig', 'Copy MCP config')}
                  caption={activeClient.configPath}
                />
                <p className="text-xs">
                  {t(
                    'mcpSettings.installPromptHint',
                    'Or ask your coding assistant to merge the configuration for you:'
                  )}
                </p>
                <CodeSurface
                  code={installPrompt}
                  ariaLabel={t('mcpSettings.copyInstallPrompt', 'Copy setup prompt')}
                  caption="prompt"
                  wrap
                />
              </div>
            </details>
          </StepRail>

          <StepRail index={2} title={t('mcpSettings.verifyHeading', 'Check the connection')}>
            <p>{instructions[client].verify}</p>
            <CodeSurface
              code={t(
                'mcpSettings.connectionPrompt',
                'Call server_info from the openflowkit MCP server and report its version and available tools.'
              )}
              ariaLabel={t('mcpSettings.copyConnectionPrompt', 'Copy connection test prompt')}
              caption="prompt"
              wrap
            />
          </StepRail>

          <StepRail
            index={3}
            title={t('mcpSettings.tryItHeading', 'Create your first diagram')}
            isLast
          >
            <p>
              {t(
                'mcpSettings.tryItIntro',
                'Paste this into your connected client. It will author the diagram, validate it, and return an OpenFlowKit viewer link.'
              )}
            </p>
            <CodeSurface
              code={t(
                'mcpSettings.diagramPrompt',
                'Use the openflowkit MCP tools to create a checkout flow with cart, shipping, a promo-code decision, payment, and confirmation. Start with list_starter_templates and get_starter_template to learn the DSL. Call validate_openflow_dsl, fix any errors, then call create_viewer_url. Return the final DSL and viewer link.'
              )}
              ariaLabel={t('mcpSettings.copyTestPrompt', 'Copy diagram prompt')}
              caption="prompt"
              wrap
            />
          </StepRail>
        </ol>
      </section>

      <details className="border-t border-[var(--color-brand-border)] pt-4">
        <summary className="w-fit cursor-pointer rounded py-1 text-sm font-semibold text-[var(--brand-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)]">
          {t('mcpSettings.toolsHeading', 'Explore the 8 diagramming tools')}
        </summary>
        <div className="mt-4 divide-y divide-[var(--color-brand-border)]">
          {toolGroups.map((group) => (
            <section
              key={group.label}
              className="grid gap-2 py-4 sm:grid-cols-[100px_minmax(0,1fr)]"
            >
              <h3 className="text-sm font-semibold text-[var(--brand-text)]">{group.label}</h3>
              <ul className="space-y-3">
                {group.tools.map((tool) => (
                  <li key={tool.name} className="grid gap-0.5 lg:grid-cols-2 lg:gap-3">
                    <code className="break-all font-mono text-xs text-[var(--brand-text)]">
                      {tool.name}
                    </code>
                    <span className="text-xs text-[var(--brand-secondary)]">{tool.desc}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </details>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-brand-border)] pt-4 text-xs">
        <a
          href="https://github.com/Vrun-design/openflowkit/tree/main/mcp-server#readme"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded font-semibold text-[var(--brand-text)] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)]"
        >
          {t('mcpSettings.docsLink', 'Full MCP documentation')}
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
        {isCopilot && (
          <a
            href={client === 'copilot-app' ? COPILOT_DOCS.app : COPILOT_DOCS.cli}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded text-[var(--brand-secondary)] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)]"
          >
            {t('mcpSettings.copilotDocs', 'GitHub Copilot setup guide')}
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        )}
      </footer>
    </div>
  );
}
