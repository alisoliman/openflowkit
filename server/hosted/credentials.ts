import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export function opaqueId(): string {
  return randomBytes(32).toString('base64url');
}

export function stateKey(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function encryptState(value: unknown, key: Buffer, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}

export function decryptState(value: string, key: Buffer, context: string): unknown {
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length < 29) throw new Error('Invalid encrypted authentication state.');
  const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'));
}
