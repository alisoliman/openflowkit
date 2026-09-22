import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Github } from 'lucide-react';
import {
  disconnectHostedCopilot,
  startHostedCopilotConnection,
  type CopilotConnectionState,
} from '@/services/copilot/client';
import { Button } from '@/components/ui/Button';

export function HostedCopilotConnection({ connection, onRefresh }: {
  connection: CopilotConnectionState;
  onRefresh: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const status = connection.state === 'ready' ? connection.status : undefined;
  const signedIn = status?.signedIn === true;
  const checking = connection.state === 'checking';
  const focus = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)]';

  async function connectOrDisconnect(): Promise<void> {
    setPending(true);
    setError(undefined);
    try {
      if (signedIn) {
        await disconnectHostedCopilot();
        onRefresh();
      } else {
        window.location.assign(await startHostedCopilotConnection());
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('copilot.hostedActionFailed'));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <div role="status" aria-live="polite" className="space-y-1 break-words text-sm leading-6 text-[var(--brand-text)]">
        <p>{checking ? t('copilot.checking') : signedIn
          ? t('copilot.hostedSignedIn', { login: status?.login ?? 'GitHub' })
          : t('copilot.notConnected')}</p>
        {status?.issue && <p className="text-[var(--brand-secondary)]">{status.issue}</p>}
        {connection.state === 'unavailable' && <p className="text-[var(--brand-secondary)]">{connection.message}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button" size="sm" variant={signedIn ? 'secondary' : 'primary'}
          disabled={checking} isLoading={pending}
          icon={<Github aria-hidden="true" className="h-4 w-4" />}
          className={focus}
          onClick={() => { void connectOrDisconnect(); }}
        >
          {pending
            ? t(signedIn ? 'copilot.disconnectingGitHub' : 'copilot.connectingGitHub')
            : t(signedIn ? 'copilot.disconnectGitHub' : 'copilot.connectGitHub')}
        </Button>
        <Button type="button" size="sm" variant="ghost" className={focus}
          disabled={checking || pending} onClick={() => { setError(undefined); onRefresh(); }}>
          {t('copilot.checkConnection')}
        </Button>
      </div>
      {error && <p role="alert" className="break-words text-sm leading-6 text-[var(--brand-text)]">{error}</p>}
    </div>
  );
}
