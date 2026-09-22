import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';
import catalog from '../../../assets/third-party-icons/azure/processed/catalog.json';
import { loadProviderCatalog } from './providerCatalog';

const azureRoot = path.resolve('assets/third-party-icons/azure');
const svgModules = import.meta.glob('../../../assets/third-party-icons/azure/processed/**/*.svg');
const temporaryDirectories: string[] = [];

function hash(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex');
}

function normalizeCategory(category: string): string {
    return category.toLowerCase().replace(/\+/g, ' plus ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe('official Azure catalog integrity', () => {
    it('labels every bundled icon exactly once', async () => {
        const items = await loadProviderCatalog('azure');
        const ids = items.map((item) => item.archIconShapeId);

        expect(items).toHaveLength(736);
        expect(Object.keys(svgModules)).toHaveLength(736);
        expect(new Set(ids).size).toBe(736);
        expect(ids.sort()).toEqual(Object.keys(catalog.labels).sort());
        for (const item of items) {
            expect(item.label.trim()).not.toBe('');
            expect(item.label).not.toMatch(/^\d|icon-service|\.svg$/i);
            expect(item.providerShapeCategory).toBeTruthy();
        }
    });

    it('includes every V24 source SVG without altering or overwriting the artwork', async () => {
        const archiveBytes = await readFile(path.join(azureRoot, 'raw/Azure_Public_Service_Icons_V24.zip'));
        expect(hash(archiveBytes)).toBe('921594ccd1bf3d9c0a1bd7b6d924e050551a59342f2b353bb74bdcf761c35141');
        const archive = await JSZip.loadAsync(archiveBytes);
        const sources = Object.values(archive.files).filter((file) => file.name.endsWith('.svg'));
        expect(sources).toHaveLength(714);

        const available = new Map<string, string[]>();
        for (const modulePath of Object.keys(svgModules)) {
            const relativePath = modulePath.split('/processed/')[1];
            const bytes = await readFile(path.join(azureRoot, 'processed', relativePath));
            const key = `${relativePath.split('/')[0]}:${hash(bytes)}`;
            available.set(key, [...(available.get(key) ?? []), relativePath]);
            const xml = new DOMParser().parseFromString(bytes.toString('utf8'), 'image/svg+xml');
            expect(xml.querySelector('parsererror'), relativePath).toBeNull();
            expect(xml.documentElement.localName, relativePath).toBe('svg');
        }

        for (const source of sources) {
            const category = normalizeCategory(source.name.split('/').at(-2) ?? '');
            const key = `${category}:${hash(await source.async('uint8array'))}`;
            expect(available.get(key)?.shift(), `Missing unmodified official SVG: ${source.name}`).toBeTruthy();
        }
        expect([...available.values()].flat()).toHaveLength(22);
    });

    it('retains every shape ID produced by the previous V20 importer', async () => {
        const archive = await JSZip.loadAsync(await readFile(path.join(azureRoot, 'raw/Azure_Public_Service_Icons_V20.zip')));
        const legacyIds = new Set(Object.keys(archive.files).filter((name) => name.endsWith('.svg')).map((name) => {
            const parts = name.split('/');
            const stem = parts.at(-1)?.replace(/^\d+-icon-service-/, '').replace(/\.svg$/, '') ?? '';
            return `${normalizeCategory(parts.at(-2) ?? '')}-${stem.toLowerCase()
                .replace(/&/g, ' and ').replace(/\+/g, ' plus ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
        }));
        expect(legacyIds.size).toBe(676);
        const currentIds = new Set(Object.keys(catalog.labels));
        expect([...legacyIds].filter((id) => !currentIds.has(id))).toEqual([]);
    });
});

describe('Azure pack importer', () => {
    it('preserves colliding variants, product casing, and labels from earlier imports', async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'azure-icon-import-'));
        temporaryDirectories.push(root);
        const oldSource = path.join(root, 'old');
        const newSource = path.join(root, 'new');
        const output = path.join(root, 'processed');
        const importer = path.resolve('scripts/shape-pack/import-azure-official-pack.mjs');
        const oldFiles = {
            'compute/00330-icon-service-Workspaces.svg': '<svg id="workspace-00330"/>',
            'compute/00400-icon-service-Workspaces.svg': '<svg id="workspace-00400"/>',
            'networking/02302-icon-service-Load-Balancer-Hub.svg': '<svg id="hub-02302"/>',
            'iot/10001-icon-service-IoT-Hub.svg': '<svg id="iot"/>',
        };
        const newFiles = {
            'networking/02302-icon-service-Load-Balancer-Hub.svg': '<svg id="hub-02302"/>',
            'networking/029029174-icon-service-Load-Balancer-Hub.svg': '<svg id="hub-029029174"/>',
            'new icons/030777508 -icon-service-Service-Group-Relationships.svg': '<svg id="groups"/>',
            'databases/035656437-icon-service-Azure-DocumentDB.svg': '<svg id="documentdb"/>',
        };
        for (const [source, files] of [[oldSource, oldFiles], [newSource, newFiles]] as const) {
            for (const [name, content] of Object.entries(files)) {
                const file = path.join(source, name);
                await mkdir(path.dirname(file), { recursive: true });
                await writeFile(file, content);
            }
            execFileSync(process.execPath, [importer, source, output]);
        }

        expect(await readFile(path.join(output, 'compute/workspaces.svg'), 'utf8')).toBe(oldFiles['compute/00400-icon-service-Workspaces.svg']);
        expect(await readFile(path.join(output, 'compute/workspaces-00330.svg'), 'utf8')).toBe(oldFiles['compute/00330-icon-service-Workspaces.svg']);
        expect(await readFile(path.join(output, 'networking/load-balancer-hub.svg'), 'utf8')).toBe(oldFiles['networking/02302-icon-service-Load-Balancer-Hub.svg']);
        expect(await readFile(path.join(output, 'networking/load-balancer-hub-029029174.svg'), 'utf8')).toBe(newFiles['networking/029029174-icon-service-Load-Balancer-Hub.svg']);
        const catalogText = await readFile(path.join(output, 'catalog.json'), 'utf8');
        expect(JSON.parse(catalogText)).toMatchObject({
            categories: { iot: 'IoT' },
            labels: {
                'iot-iot-hub': 'IoT Hub',
                'databases-azure-documentdb': 'Azure DocumentDB',
                'new-icons-service-group-relationships': 'Service Group Relationships',
            },
        });

        execFileSync(process.execPath, [importer, newSource, output]);
        expect(await readFile(path.join(output, 'catalog.json'), 'utf8')).toBe(catalogText);
    });

    it('rejects an incorrect source root instead of silently dropping icons', async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'azure-icon-invalid-'));
        temporaryDirectories.push(root);
        const source = path.join(root, 'source');
        await mkdir(source);
        await writeFile(path.join(source, '10001-icon-service-SQL.svg'), '<svg/>');

        expect(() => execFileSync(process.execPath, [
            path.resolve('scripts/shape-pack/import-azure-official-pack.mjs'),
            source,
            path.join(root, 'processed'),
        ], { stdio: 'pipe' })).toThrow(/Expected category\/name\.svg/);
    });
});
