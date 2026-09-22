import { beforeEach, describe, expect, it, vi } from 'vitest';
import { localFirstRepository, type PersistedChatMessage } from './localFirstRepository';
import { getAllRecordsByIndex, putRecord, withDatabase } from './indexedDbHelpers';

vi.mock('./indexedDbHelpers', () => ({
  withDatabase: vi.fn(async (operation: (database: undefined) => Promise<unknown>) => operation(undefined)),
  getAllRecordsByIndex: vi.fn(async () => []),
  putRecord: vi.fn(async () => undefined),
  deleteRecordsByIndex: vi.fn(async () => undefined),
  deleteRecord: vi.fn(async () => undefined),
  getAllRecords: vi.fn(), getRecord: vi.fn(), deleteWhereDocumentId: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.mocked(getAllRecordsByIndex).mockResolvedValue([]);
});

describe('conversation repository persistence', () => {
  it('returns an empty new conversation without recursively reloading it', async () => {
    expect(await localFirstRepository.loadChatThread('new-document')).toEqual([]);
    expect(getAllRecordsByIndex).toHaveBeenCalledOnce();
  });

  it('orders rapid same-timestamp messages by their persisted sequence', async () => {
    vi.mocked(getAllRecordsByIndex).mockResolvedValue([
      { id: 'model', documentId: 'doc', role: 'model', parts: [], createdAt: 'same', sequence: 1 },
      { id: 'user', documentId: 'doc', role: 'user', parts: [], createdAt: 'same', sequence: 0 },
    ]);
    expect((await localFirstRepository.loadChatThread('doc')).map((message) => message.id)).toEqual(['user', 'model']);
  });

  it('retains discard metadata through localStorage fallback and later migration', async () => {
    const message: PersistedChatMessage = {
      id: 'preview', documentId: 'doc', role: 'model', parts: [{ text: 'flow: Discarded' }],
      createdAt: '2026-09-22T00:00:00Z', sequence: 0,
      threadType: 'assistant_canvas_preview', previewStatus: 'discarded', applied: false,
    };
    vi.mocked(withDatabase).mockRejectedValueOnce(new Error('IndexedDB unavailable'));
    await localFirstRepository.replaceChatThread('doc', [message]);
    expect(JSON.parse(localStorage.getItem('ofk_chat_history_doc') ?? '[]')[0]).toMatchObject({
      id: 'preview', previewStatus: 'discarded', threadType: 'assistant_canvas_preview',
    });
    expect(await localFirstRepository.loadChatThread('doc')).toEqual([message]);
    expect(putRecord).toHaveBeenCalledWith(undefined, expect.any(String), expect.objectContaining({ previewStatus: 'discarded' }));
    expect(localStorage.getItem('ofk_chat_history_doc')).toBeNull();
  });
});
