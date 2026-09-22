import { z } from 'zod';

export const COPILOT_API_PATH = '/api/copilot';
export const COPILOT_CLIENT_HEADER = 'x-flowpilot-client';
export const COPILOT_MAX_BODY_BYTES = 8 * 1024 * 1024;
export const COPILOT_MAX_HISTORY_MESSAGES = 200;
export const COPILOT_MAX_RESPONSE_CHARS = 2 * 1024 * 1024;
export const COPILOT_SETUP_MESSAGE =
  'The local Copilot runtime is unavailable. Run npm run dev (or npm run build && npm run preview) on this computer, then open the local app. Static hosted sites cannot access your Copilot CLI sign-in.';
export const COPILOT_LOGIN_MESSAGE =
  'Sign in with gh copilot login in a terminal, then check the connection in Settings > AI. Your GitHub account must have Copilot access.';
export const COPILOT_HOSTED_LOGIN_MESSAGE =
  'Connect GitHub in Flowpilot or Settings > AI. Your own account must have Copilot access and available quota.';
export const COPILOT_HOSTED_SETUP_MESSAGE =
  'The hosted Copilot service is unavailable. Retry shortly or select an alternative provider in Settings > AI. Your saved diagrams remain on this device.';

export const copilotRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(1_000_000),
  systemInstruction: z.string().min(1).max(100_000),
  model: z.string().trim().min(1).max(200).default('auto'),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(1_000_000),
  }).strict()).max(COPILOT_MAX_HISTORY_MESSAGES).default([]),
  image: z.string().max(7_000_000)
    .regex(/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/)
    .optional(),
}).strict();

export type CopilotRequest = z.infer<typeof copilotRequestSchema>;

export const copilotStatusSchema = z.object({
  runtime: z.literal('github-copilot-sdk'),
  authenticated: z.boolean(),
  login: z.string().optional(),
  models: z.array(z.object({
    id: z.string(),
    name: z.string(),
    vision: z.boolean().optional(),
    multiplier: z.number().optional(),
  })),
  mode: z.enum(['local', 'hosted']).optional(),
  signedIn: z.boolean().optional(),
  issue: z.string().optional(),
});

export type CopilotStatus = z.infer<typeof copilotStatusSchema>;

export const copilotErrorCodeSchema = z.enum([
  'runtime_unavailable',
  'not_authenticated',
  'invalid_request',
  'busy',
  'timeout',
  'request_failed',
  'bad_response',
  'copilot_access_denied',
  'quota_exceeded',
]);

export const copilotErrorSchema = z.object({
  code: copilotErrorCodeSchema,
  message: z.string(),
});

export const copilotStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('delta'), text: z.string() }),
  z.object({ type: z.literal('done'), text: z.string().min(1) }),
  z.object({ type: z.literal('error'), error: copilotErrorSchema }),
]);

export type CopilotStreamEvent = z.infer<typeof copilotStreamEventSchema>;

export class CopilotRequestError extends Error {
  constructor(
    public readonly code: z.infer<typeof copilotErrorCodeSchema>,
    message: string,
    public readonly status = 503,
  ) {
    super(message);
    this.name = 'CopilotRequestError';
  }
}
