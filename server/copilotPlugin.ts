import type { Connect, Plugin, ViteDevServer } from 'vite';
import { createCopilotAgentEndpoint } from './copilotAgentEndpoint';
import { createCopilotMiddleware } from './copilotMiddleware';
import { createCopilotRuntime } from './copilotRuntime';

export function copilotPlugin(): Plugin {
  function attach(middlewares: Connect.Server, server: ViteDevServer['httpServer']) {
    const runtime = createCopilotRuntime();
    const agent = createCopilotAgentEndpoint(runtime);
    middlewares.use(createCopilotMiddleware(runtime));
    server?.on('upgrade', agent.upgrade);
    server?.once('close', () => {
      void Promise.all([agent.close(), runtime.stop()]).catch((error: unknown) => {
        console.error('[Flowpilot] Copilot shutdown failed.', error);
      });
    });
  }

  return {
    name: 'flowpilot-copilot',
    apply: 'serve',
    configureServer(server) {
      attach(server.middlewares, server.httpServer);
    },
    configurePreviewServer(server) {
      attach(server.middlewares, server.httpServer);
    },
  };
}
