import { describe, expect, it } from 'vitest';
import { getAIReadinessState } from './readiness';

const DEFAULT_STORAGE_MODE = 'local' as const;

describe('getAIReadinessState', () => {
  const copilotSettings = { provider: 'copilot' as const, storageMode: DEFAULT_STORAGE_MODE };

  it('allows an authenticated Copilot account without a provider API key', () => {
    expect(getAIReadinessState(copilotSettings, {
      state: 'ready', status: { runtime: 'github-copilot-sdk', authenticated: true, models: [] },
    }).canGenerate).toBe(true);
  });

  it('waits for Copilot connection discovery and gives CLI-specific recovery guidance', () => {
    expect(getAIReadinessState(copilotSettings).canGenerate).toBe(false);
    const signedOut = getAIReadinessState(copilotSettings, {
      state: 'ready', status: { runtime: 'github-copilot-sdk', authenticated: false, models: [] },
    });
    expect(signedOut.canGenerate).toBe(false);
    expect(signedOut.blockingIssue?.detail).toContain('gh copilot login');
    expect(getAIReadinessState(copilotSettings, {
      state: 'unavailable', message: 'Run the local app',
    }).blockingIssue?.detail).toBe('Run the local app');
  });

  it('blocks stale or disabled Copilot model selections instead of silently changing models', () => {
    const state = getAIReadinessState({ ...copilotSettings, model: 'disabled-model' }, {
      state: 'ready', status: { runtime: 'github-copilot-sdk', authenticated: true, models: [] },
    });
    expect(state.canGenerate).toBe(false);
    expect(state.blockingIssue?.detail).toContain('Choose another model');
  });

  it('blocks hosted providers when the API key is missing', () => {
    const readiness = getAIReadinessState({
      provider: 'openai',
      storageMode: DEFAULT_STORAGE_MODE,
      model: 'gpt-5-mini',
    });

    expect(readiness.canGenerate).toBe(false);
    expect(readiness.blockingIssue?.detail).toContain('OpenAI API key');
    expect(readiness.advisory?.title).toContain('OpenAI');
  });

  it('blocks custom providers when the base URL is invalid', () => {
    const readiness = getAIReadinessState({
      provider: 'custom',
      storageMode: DEFAULT_STORAGE_MODE,
      model: 'llama3.1',
      customBaseUrl: 'localhost:11434/v1',
    });

    expect(readiness.canGenerate).toBe(false);
    expect(readiness.blockingIssue?.detail).toContain('http:// or https://');
  });

  it('allows browser-friendly providers when required config exists', () => {
    const readiness = getAIReadinessState({
      provider: 'gemini',
      storageMode: DEFAULT_STORAGE_MODE,
      apiKey: 'AIza-test',
    });

    expect(readiness.canGenerate).toBe(true);
    expect(readiness.blockingIssue).toBeNull();
    expect(readiness.advisory?.title).toContain('browser-first default');
  });

  it('allows custom endpoints with a valid URL and model', () => {
    const readiness = getAIReadinessState({
      provider: 'custom',
      storageMode: DEFAULT_STORAGE_MODE,
      customBaseUrl: 'http://localhost:11434/v1',
      model: 'llama3.1',
    });

    expect(readiness.canGenerate).toBe(true);
    expect(readiness.blockingIssue).toBeNull();
    expect(readiness.advisory?.title).toBe('Custom endpoint selected');
  });
});
