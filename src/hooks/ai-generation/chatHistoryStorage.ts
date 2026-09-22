import type { ChatMessage } from '@/services/aiService';
import { localFirstRepository, type PersistedChatMessage } from '@/services/storage/localFirstRepository';
import { parseLegacyChatMessagesJson } from '@/services/storage/storageSchemas';
import type { AssistantThreadItem } from '@/services/flowpilot/types';
import { assistantThreadToChatMessages } from '@/services/flowpilot/thread';
import { createLogger } from '@/lib/logger';

const STORAGE_KEY_PREFIX = 'ofk_chat_history_';
const logger = createLogger({ scope: 'AssistantThreadStorage' });
const writes = new Map<string, Promise<void>>();

function enqueueWrite(diagramId: string, write: () => Promise<void>): Promise<void> {
  const previous = writes.get(diagramId) ?? Promise.resolve();
  const next = previous.catch((error: unknown) => {
    logger.warn('Previous conversation write failed; retrying with the latest thread.', { error });
  }).then(write);
  writes.set(diagramId, next);
  const release = () => {
    if (writes.get(diagramId) === next) writes.delete(diagramId);
  };
  void next.then(release, release);
  return next;
}

function storageKey(diagramId: string): string {
  return `${STORAGE_KEY_PREFIX}${diagramId}`;
}

function toChatMessages(messages: PersistedChatMessage[]): ChatMessage[] {
  return messages.map((message) => ({
    role: message.role,
    parts: message.parts,
  }));
}

function toAssistantThreadItems(messages: PersistedChatMessage[]): AssistantThreadItem[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    type: (message.threadType as AssistantThreadItem['type']) ?? (message.role === 'user' ? 'user_message' : 'assistant_applied_result'),
    content: message.parts.map((part) => part.text ?? '').join(''),
    createdAt: message.createdAt,
    responseMode: message.responseMode,
    thinkingState: message.thinkingState,
    summary: message.summary,
    previewTitle: message.previewTitle,
    previewDetail: message.previewDetail,
    previewStats: message.previewStats,
    applied: message.applied,
    previewStatus: message.previewStatus,
    changes: message.changes,
    plan: message.plan,
    assetMatches: message.assetMatches,
  }));
}

function toPersistedChatMessages(diagramId: string, messages: ChatMessage[]): PersistedChatMessage[] {
  const startedAt = Date.now();

  return messages.map((message, index) => ({
    id: `${diagramId}:${index}:${message.role}`,
    documentId: diagramId,
    role: message.role,
    parts: message.parts,
    createdAt: new Date(startedAt + index).toISOString(),
  }));
}

function toPersistedThreadItems(
  diagramId: string,
  items: AssistantThreadItem[]
): PersistedChatMessage[] {
  return items.map((item, index) => ({
    id: item.id || `${diagramId}:${index}:${item.type}`,
    documentId: diagramId,
    role: item.role,
    parts: [{ text: item.content }],
    createdAt: item.createdAt,
    threadType: item.type,
    sequence: index,
    responseMode: item.responseMode,
    thinkingState: item.thinkingState,
    summary: item.summary,
    previewTitle: item.previewTitle,
    previewDetail: item.previewDetail,
    previewStats: item.previewStats,
    applied: item.applied,
    previewStatus: item.previewStatus,
    changes: item.changes,
    plan: item.plan,
    assetMatches: item.assetMatches,
  }));
}

function loadLegacyChatHistory(diagramId: string): ChatMessage[] {
  try {
    const raw = localStorage.getItem(storageKey(diagramId));
    return parseLegacyChatMessagesJson(raw);
  } catch {
    return [];
  }
}

function saveLegacyChatHistory(diagramId: string, messages: ChatMessage[]): void {
  try {
    localStorage.setItem(storageKey(diagramId), JSON.stringify(messages));
  } catch {
    // localStorage may be full or unavailable — fail silently
  }
}

function clearLegacyChatHistory(diagramId: string): void {
  try {
    localStorage.removeItem(storageKey(diagramId));
  } catch {
    // fail silently
  }
}

export async function loadChatHistory(diagramId: string): Promise<ChatMessage[]> {
  try {
    const messages = await localFirstRepository.loadChatThread(diagramId);
    return toChatMessages(messages);
  } catch {
    return loadLegacyChatHistory(diagramId);
  }
}

export async function saveChatHistory(diagramId: string, messages: ChatMessage[]): Promise<void> {
  try {
    await localFirstRepository.replaceChatThread(diagramId, toPersistedChatMessages(diagramId, messages));
  } catch {
    saveLegacyChatHistory(diagramId, messages);
  }
}

export async function loadAssistantThreadHistory(diagramId: string): Promise<AssistantThreadItem[]> {
  await writes.get(diagramId);
  try {
    const messages = await localFirstRepository.loadChatThread(diagramId);
    return toAssistantThreadItems(messages);
  } catch {
    return parseLegacyChatMessagesJson(localStorage.getItem(storageKey(diagramId))).map((message, index) => ({
      id: `${diagramId}:legacy:${index}`,
      role: message.role,
      type: message.role === 'user' ? 'user_message' : 'assistant_applied_result',
      content: message.parts.map((part) => part.text ?? '').join(''),
      createdAt: new Date(Date.now() + index).toISOString(),
    }));
  }
}

export function saveAssistantThreadHistory(
  diagramId: string,
  items: AssistantThreadItem[]
): Promise<void> {
  return enqueueWrite(diagramId, async () => {
    try {
      await localFirstRepository.replaceChatThread(diagramId, toPersistedThreadItems(diagramId, items));
    } catch (error) {
      logger.warn('Conversation storage failed; saving safe conversational context locally.', { error });
      saveLegacyChatHistory(diagramId, assistantThreadToChatMessages(items));
    }
  });
}

export async function clearChatHistory(diagramId: string): Promise<void> {
  try {
    await localFirstRepository.clearChatThread(diagramId);
  } catch {
    clearLegacyChatHistory(diagramId);
  }
}

export async function clearAssistantThreadHistory(diagramId: string): Promise<void> {
  await enqueueWrite(diagramId, () => clearChatHistory(diagramId));
}
