import { describe, expect, it } from 'vitest';
import { listProviderCatalogProviders, loadProviderCatalog, loadProviderCatalogSuggestions, loadProviderShapePreview } from './providerCatalog';
import { createDomainLibraryNode } from '@/services/domainLibrary';
import { matchIcon } from '@/lib/iconMatcher';

describe('providerCatalog', () => {
    it('discovers bundled provider packs from manifest paths', () => {
        expect(listProviderCatalogProviders()).toContain('aws');
        expect(listProviderCatalogProviders()).toContain('azure');
        expect(listProviderCatalogProviders()).toContain('cncf');
        expect(listProviderCatalogProviders()).toContain('developer');
    });

    it('loads the AWS provider catalog from the local manifest pack', async () => {
        const items = await loadProviderCatalog('aws');

        expect(items.length).toBeGreaterThan(300);
        expect(items[0]).toMatchObject({
            category: 'aws',
            nodeType: 'custom',
        });
        expect(items.some((item) => item.archIconShapeId === 'compute-lambda')).toBe(true);
    });

    it('loads a preview for a specific provider icon', async () => {
        const preview = await loadProviderShapePreview('aws-official-starter-v1', 'compute-lambda');

        expect(preview).not.toBeNull();
        expect(preview?.previewUrl.length).toBeGreaterThan(0);
    });

    it('loads Azure and CNCF provider catalogs from local svg packs', async () => {
        const [azureItems, cncfItems] = await Promise.all([
            loadProviderCatalog('azure'),
            loadProviderCatalog('cncf'),
        ]);

        expect(azureItems.length).toBeGreaterThan(200);
        expect(cncfItems.length).toBeGreaterThan(100);
        expect(azureItems[0]?.category).toBe('azure');
        expect(cncfItems[0]?.category).toBe('cncf');
    });

    it('loads the developer icons catalog from the local svg pack', async () => {
        const items = await loadProviderCatalog('developer');

        expect(items.length).toBeGreaterThan(300);
        expect(items[0]?.category).toBe('developer');
        expect(items.some((item) => item.archIconShapeId === 'languages-javascript')).toBe(true);
    });

    it.each([
        ['ai-plus-machine-learning-foundry-agent-service', 'Foundry Agent Service', 'AI + Machine Learning'],
        ['ai-plus-machine-learning-foundry-models', 'Foundry Models', 'AI + Machine Learning'],
        ['ai-plus-machine-learning-foundry-project', 'Foundry Project', 'AI + Machine Learning'],
        ['databases-azure-documentdb', 'Azure DocumentDB', 'Databases'],
        ['databases-sql-database-fleet-manager', 'SQL Database Fleet Manager', 'Databases'],
        ['new-icons-ai-gateway', 'AI Gateway', 'New Icons'],
        ['new-icons-ddos-custom-policy', 'DDoS Custom Policy', 'New Icons'],
        ['new-icons-resiliency', 'Resiliency', 'New Icons'],
        ['containers-aks-network-policy', 'AKS Network Policy', 'Containers'],
        ['hybrid-plus-multicloud-azure-local', 'Azure Local', 'Hybrid + Multicloud'],
    ])('loads and labels the current Azure icon %s', async (shapeId, label, category) => {
        const items = await loadProviderCatalog('azure');
        const item = items.find((candidate) => candidate.archIconShapeId === shapeId);
        expect(item).toMatchObject({ label, providerShapeCategory: category, archIconPackId: 'azure-official-icons-v20' });

        const preview = await loadProviderShapePreview('azure-official-icons-v20', shapeId);
        expect(preview).toMatchObject({ shapeId, label, category });
        expect(preview?.previewUrl).toBeTruthy();
    });

    it.each([
        ['Microsoft Foundry', 'ai-plus-machine-learning-ai-foundry'],
        ['Prometheus', 'other-promethus'],
        ['Azure PubSub', 'integration-pubsub'],
        ['Azure VPN Client for Windows', 'networking-vpnclientwindows'],
    ])('finds Azure icons by the product name %s', async (query, shapeId) => {
        const items = await loadProviderCatalogSuggestions('azure', { query });
        expect(items.some((item) => item.archIconShapeId === shapeId && item.label === query)).toBe(true);
        expect(matchIcon(query, 'azure').some((item) => item.shapeId === shapeId && item.label === query)).toBe(true);
    });

    it('places the product label on inserted Azure diagram nodes', async () => {
        const [item] = await loadProviderCatalogSuggestions('azure', { query: 'Azure DocumentDB' });
        expect(item).toBeDefined();

        const node = createDomainLibraryNode(item, 'documentdb', { x: 0, y: 0 }, 'layer-1');
        expect(node.data).toMatchObject({
            label: 'Azure DocumentDB',
            assetProvider: 'azure',
            archIconPackId: 'azure-official-icons-v20',
            archIconShapeId: 'databases-azure-documentdb',
        });
    });

    it('keeps legacy Azure paths resolvable alongside newer category locations', async () => {
        const previews = await Promise.all([
            'azure-stack-capacity',
            'databases-azure-purview-accounts',
            'new-icons-azure-managed-redis',
            'databases-azure-managed-redis',
            'compute-workspaces',
            'compute-workspaces-00330',
            'networking-load-balancer-hub',
            'networking-load-balancer-hub-029029174',
        ].map((shapeId) => loadProviderShapePreview('azure-official-icons-v20', shapeId)));

        expect(previews.every((preview) => Boolean(preview?.label && preview.previewUrl))).toBe(true);
        expect(previews[4]?.previewUrl).not.toBe(previews[5]?.previewUrl);
        expect(previews[6]?.previewUrl).not.toBe(previews[7]?.previewUrl);
    });
});
