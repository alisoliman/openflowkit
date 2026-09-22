export const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
export const OAUTH_LIFETIME_MS = 10 * 60 * 1000;
export const HOSTED_CONCURRENCY = 20;
export const GENERATION_LEASE_MS = 300_000;
export const STATE_TABLE = 'Flowpilot';

export interface HostedConfig {
  origin: string;
  clientId: string;
  clientSecret: string;
  encryptionKey: Buffer;
  storageAccount?: string;
  development: boolean;
  port: number;
}

export class HostedConfigError extends Error {}

export function loadHostedConfig(env: NodeJS.ProcessEnv = process.env): HostedConfig {
  function required(name: string): string {
    const value = env[name]?.trim();
    if (!value) throw new HostedConfigError(`Missing hosted configuration: ${name}`);
    return value;
  }

  const development = env.HOSTED_DEVELOPMENT === 'true';
  let url: URL;
  try { url = new URL(required('PUBLIC_ORIGIN')); }
  catch { throw new HostedConfigError('PUBLIC_ORIGIN must be a valid origin URL.'); }
  const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (
    url.username || url.password || url.search || url.hash || url.pathname !== '/'
    || (development ? !local || url.protocol !== 'http:' : url.protocol !== 'https:')
  ) {
    throw new HostedConfigError('PUBLIC_ORIGIN must be an HTTPS origin, or a loopback HTTP origin in explicit development mode.');
  }
  const encodedKey = required('HOSTED_SESSION_KEY');
  const encryptionKey = Buffer.from(encodedKey, 'base64');
  if (encryptionKey.length !== 32 || encryptionKey.toString('base64') !== encodedKey) {
    throw new HostedConfigError('HOSTED_SESSION_KEY must be a base64-encoded, randomly generated 32-byte key.');
  }
  const storageAccount = development ? undefined : required('HOSTED_STORAGE_ACCOUNT');
  if (storageAccount && !/^[a-z0-9]{3,24}$/.test(storageAccount)) {
    throw new HostedConfigError('HOSTED_STORAGE_ACCOUNT must be an Azure Storage account name.');
  }
  const port = Number(env.PORT ?? 3045);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new HostedConfigError('PORT is invalid.');
  return {
    origin: url.origin,
    clientId: required('HOSTED_GITHUB_CLIENT_ID'),
    clientSecret: required('HOSTED_GITHUB_CLIENT_SECRET'),
    encryptionKey,
    storageAccount,
    development,
    port,
  };
}
