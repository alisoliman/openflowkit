import { z } from 'zod';
import { AGENT_TOOL_NAMES, ASK_USER_TOOL_NAME } from './agentTools';
import {
  COPILOT_API_PATH,
  COPILOT_MAX_BODY_BYTES,
  COPILOT_MAX_RESPONSE_CHARS,
  copilotErrorSchema,
  copilotRequestSchema,
} from './protocol';

export const AGENT_PROTOCOL_VERSION = 1;
export const AGENT_API_PATH = `${COPILOT_API_PATH}/agent`;
export const AGENT_SUBPROTOCOL = 'flowpilot-agent.v1';
export const AGENT_MAX_SELECTED_IDS = 1_000;
export const AGENT_MAX_ANSWER_CHARS = 4_000;
export const AGENT_MAX_TOOL_ERROR_CHARS = 20_000;
export const AGENT_SERVER_MESSAGE_MAX_BYTES = COPILOT_MAX_BODY_BYTES;
export const AGENT_MAX_ID_CHARS = 200;
// A canvas picture from capture_canvas; the browser keeps each one below this many base64 characters.
export const AGENT_MAX_TOOL_IMAGE_CHARS = 2_500_000;
export const AGENT_MAX_TOOL_IMAGES = 1;
export const AGENT_INVALID_START_MESSAGE = 'Flowpilot could not send this request. Check the prompt, conversation length, and image format (PNG, JPEG, WebP, or GIF).';

// zod v3, as it reuses the request schemas in protocol.ts. The tool schemas use zod/v4 for JSON Schema output.
const idSchema = z.string().min(1).max(AGENT_MAX_ID_CHARS);

function message<Type extends string, Shape extends z.ZodRawShape>(type: Type, shape: Shape) {
  return z.object({ v: z.literal(AGENT_PROTOCOL_VERSION), type: z.literal(type), ...shape }).strict();
}

const agentClientMessageSchemas = {
  start: message('start', {
    turnId: idSchema,
    prompt: copilotRequestSchema.shape.prompt,
    model: copilotRequestSchema.shape.model,
    history: copilotRequestSchema.shape.history,
    image: copilotRequestSchema.shape.image,
    canvas: z.object({
      pageName: z.string().max(500),
      nodeCount: z.number().int().nonnegative(),
      edgeCount: z.number().int().nonnegative(),
      selectedIds: z.array(idSchema).max(AGENT_MAX_SELECTED_IDS),
    }).strict(),
  }),
  tool_result: z.discriminatedUnion('ok', [
    message('tool_result', {
      callId: idSchema,
      ok: z.literal(true),
      result: z.union([z.string(), z.record(z.unknown())]),
      images: z.array(z.object({
        mimeType: z.enum(['image/jpeg', 'image/png']),
        data: z.string().min(1).max(AGENT_MAX_TOOL_IMAGE_CHARS).regex(/^[A-Za-z0-9+/]+={0,2}$/),
      }).strict()).min(1).max(AGENT_MAX_TOOL_IMAGES).optional(),
    }),
    message('tool_result', {
      callId: idSchema,
      ok: z.literal(false),
      error: z.string().min(1).max(AGENT_MAX_TOOL_ERROR_CHARS),
      resultType: z.enum(['failure', 'rejected']).optional(),
    }),
  ]),
  answer: message('answer', {
    questionId: idSchema,
    answer: z.string().trim().min(1).max(AGENT_MAX_ANSWER_CHARS),
    wasFreeform: z.boolean(),
  }),
  cancel: message('cancel', {}),
  pong: message('pong', {}),
};

const agentServerMessageSchemas = {
  accepted: message('accepted', { turnId: idSchema }),
  reply_delta: message('reply_delta', { text: z.string().max(COPILOT_MAX_RESPONSE_CHARS) }),
  tool_call: message('tool_call', { callId: idSchema, name: z.enum(AGENT_TOOL_NAMES), args: z.unknown() }),
  step: message('step', {
    callId: idSchema,
    name: z.enum([...AGENT_TOOL_NAMES, ASK_USER_TOOL_NAME]),
    status: z.enum(['started', 'succeeded', 'failed']),
  }),
  question: message('question', {
    questionId: idSchema,
    question: z.string().min(1).max(20_000),
    choices: z.array(z.string().min(1).max(2_000)).max(50).optional(),
    allowFreeform: z.boolean(),
  }),
  question_expired: message('question_expired', { questionId: idSchema }),
  done: message('done', { reply: z.string().max(COPILOT_MAX_RESPONSE_CHARS) }),
  error: message('error', copilotErrorSchema.shape),
  ping: message('ping', {}),
};

export type AgentClientMessage = z.infer<(typeof agentClientMessageSchemas)[keyof typeof agentClientMessageSchemas]>;
export type AgentServerMessage = z.infer<(typeof agentServerMessageSchemas)[keyof typeof agentServerMessageSchemas]>;

export const AGENT_CLIENT_MESSAGE_MAX_BYTES = {
  start: COPILOT_MAX_BODY_BYTES,
  // Room for a canvas picture next to the JSON result.
  tool_result: 4 * 1024 * 1024,
  answer: 16 * 1024,
  cancel: 16 * 1024,
  pong: 16 * 1024,
} satisfies Record<AgentClientMessage['type'], number>;

const encoder = new TextEncoder();

function parseFrame(raw: string, schemas: Record<string, z.ZodTypeAny>, maxBytes: number, typeMaxBytes: Record<string, number> = {}): unknown {
  // Every UTF-16 code unit needs at least one UTF-8 byte, so this rejects huge frames before encoding them.
  if (raw.length > maxBytes) return null;
  const bytes = encoder.encode(raw).byteLength;
  if (bytes > maxBytes) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const type = (value as { type?: unknown } | null)?.type;
  if (typeof type !== 'string' || !Object.hasOwn(schemas, type) || bytes > (typeMaxBytes[type] ?? maxBytes)) return null;
  const parsed = schemas[type].safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Returns null for oversized, malformed, unknown or invalid frames; the server then closes the socket. */
export function parseAgentClientMessage(raw: string): AgentClientMessage | null {
  return parseFrame(raw, agentClientMessageSchemas, COPILOT_MAX_BODY_BYTES, AGENT_CLIENT_MESSAGE_MAX_BYTES) as AgentClientMessage | null;
}

/** Returns null for oversized, malformed, unknown or invalid frames; the browser then ends the turn. */
export function parseAgentServerMessage(raw: string): AgentServerMessage | null {
  return parseFrame(raw, agentServerMessageSchemas, AGENT_SERVER_MESSAGE_MAX_BYTES) as AgentServerMessage | null;
}
