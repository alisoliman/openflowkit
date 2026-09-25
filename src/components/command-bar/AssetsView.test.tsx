import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AssetsView } from './AssetsView';

vi.mock('@/services/shapeLibrary/providerCatalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/shapeLibrary/providerCatalog')>();

  return {
    ...actual,
    getProviderCatalogCount: vi.fn((provider: string) => (provider === 'aws' || provider === 'azure' ? 2 : 0)),
    loadProviderCatalog: vi.fn(async (provider: string) => provider === 'azure' ? [
      {
        id: 'azure-official-icons-v20:ai-plus-machine-learning-foundry-agent-service',
        category: 'azure',
        label: 'Foundry Agent Service',
        description: 'AZURE AI + Machine Learning',
        icon: 'Box',
        color: 'blue',
        nodeType: 'custom',
        assetPresentation: 'icon',
        providerShapeCategory: 'AI + Machine Learning',
        archIconPackId: 'azure-official-icons-v20',
        archIconShapeId: 'ai-plus-machine-learning-foundry-agent-service',
      },
      {
        id: 'azure-official-icons-v20:databases-azure-documentdb',
        category: 'azure',
        label: 'Azure DocumentDB',
        description: 'AZURE Databases',
        icon: 'Box',
        color: 'blue',
        nodeType: 'custom',
        assetPresentation: 'icon',
        providerShapeCategory: 'Databases',
        archIconPackId: 'azure-official-icons-v20',
        archIconShapeId: 'databases-azure-documentdb',
      },
    ] : [
      {
        id: 'aws-official-starter-v1:analytics-athena',
        category: 'aws',
        label: 'Analytics Athena',
        description: 'AWS Analytics',
        icon: 'Box',
        color: 'amber',
        nodeType: 'custom',
        assetPresentation: 'icon',
        providerShapeCategory: 'Analytics',
        archIconPackId: 'aws-official-starter-v1',
        archIconShapeId: 'analytics-athena',
      },
      {
        id: 'aws-official-starter-v1:compute-lambda',
        category: 'aws',
        label: 'Compute Lambda',
        description: 'AWS Compute',
        icon: 'Box',
        color: 'amber',
        nodeType: 'custom',
        assetPresentation: 'icon',
        providerShapeCategory: 'Compute',
        archIconPackId: 'aws-official-starter-v1',
        archIconShapeId: 'compute-lambda',
      },
    ]),
    loadProviderShapePreview: vi.fn(async () => ({
      packId: 'aws-official-starter-v1',
      shapeId: 'analytics-athena',
      label: 'Analytics Athena',
      category: 'Analytics',
      previewUrl: '/mock/athena.svg',
    })),
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

describe('AssetsView', () => {
  it('opens on developer assets and switches to cloud tabs', async () => {
    render(
      <AssetsView
        onClose={vi.fn()}
        handleBack={vi.fn()}
        onAddDomainLibraryItem={vi.fn()}
      />
    );

    expect(screen.getByRole('tab', { name: /DEVELOPER/i, selected: true })).toBeTruthy();
    expect(screen.queryByText('Sticky Note')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: /AWS/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Analytics Athena/i })).toBeTruthy()
    );
    expect(screen.getByRole('combobox', { name: 'Asset category' }).textContent).toContain('All categories');
    expect(screen.queryByText('Sticky Note')).toBeNull();
  });

  it('filters assets from the always-visible search bar', async () => {
    render(
      <AssetsView
        onClose={vi.fn()}
        handleBack={vi.fn()}
        onAddDomainLibraryItem={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByRole('tab', { name: /AWS/i })).toBeTruthy());

    fireEvent.click(screen.getByRole('tab', { name: /AWS/i }));
    fireEvent.change(
      screen.getByPlaceholderText('Search developer logos, AWS services, Azure diagrams, CNCF assets, icons...'),
      {
        target: { value: 'lambda' },
      }
    );

    expect(screen.getByRole('button', { name: /Compute Lambda/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Analytics Athena/i })).toBeNull();
  });

  it('supports pending multi-select before adding provider icons', async () => {
    const onClose = vi.fn();
    const onAddDomainLibraryItem = vi.fn();

    render(
      <AssetsView
        onClose={onClose}
        handleBack={vi.fn()}
        onAddDomainLibraryItem={onAddDomainLibraryItem}
      />
    );

    fireEvent.click(screen.getByRole('tab', { name: /AWS/i }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Compute Lambda/i })).toBeTruthy()
    );
    fireEvent.click(screen.getByRole('button', { name: /Compute Lambda/i }), { ctrlKey: true });

    expect(screen.getByText('1 asset selected')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Add selected/i }));

    await waitFor(() => expect(onAddDomainLibraryItem).toHaveBeenCalledTimes(1));
    expect(onAddDomainLibraryItem.mock.calls[0]?.[0]?.label).toBe('Compute Lambda');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows Azure product names without hover and preserves them when searching and inserting', async () => {
    const onAddDomainLibraryItem = vi.fn();
    const onClose = vi.fn();
    render(<AssetsView onClose={onClose} handleBack={vi.fn()} onAddDomainLibraryItem={onAddDomainLibraryItem} />);

    fireEvent.click(screen.getByRole('tab', { name: /AZURE/i }));
    const foundry = await screen.findByRole('button', { name: 'Foundry Agent Service' });
    expect(within(foundry).getByText('Foundry Agent Service')).toBeVisible();

    fireEvent.change(
      screen.getByPlaceholderText('Search developer logos, AWS services, Azure diagrams, CNCF assets, icons...'),
      { target: { value: 'documentdb' } }
    );
    const documentDb = screen.getByRole('button', { name: 'Azure DocumentDB' });
    expect(within(documentDb).getByText('Azure DocumentDB')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Foundry Agent Service' })).toBeNull();
    fireEvent.click(documentDb);

    await waitFor(() => expect(onAddDomainLibraryItem).toHaveBeenCalledWith(expect.objectContaining({
      label: 'Azure DocumentDB',
      archIconPackId: 'azure-official-icons-v20',
      archIconShapeId: 'databases-azure-documentdb',
    })));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
