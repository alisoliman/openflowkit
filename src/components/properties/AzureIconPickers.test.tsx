import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { IconPicker } from './IconPicker';
import { ArchitectureNodeSection } from './families/ArchitectureNodeSection';

describe('Azure icon picker labels', () => {
    it('shows product labels in the provider picker and selects a current Azure icon', async () => {
        const onSelectProviderIcon = vi.fn();
        render(
            <IconPicker
                selectedProvider="azure"
                selectedProviderPackId="azure-official-icons-v20"
                selectedProviderShapeId="compute-virtual-machine"
                onSelectBuiltInIcon={vi.fn()}
                onSelectProviderIcon={onSelectProviderIcon}
                onCustomIconChange={vi.fn()}
            />
        );
        fireEvent.change(screen.getByPlaceholderText('Search azure icons...'), { target: { value: 'DocumentDB' } });

        const tile = await screen.findByRole('button', { name: 'Azure DocumentDB' });
        expect(within(tile).getByText('Azure DocumentDB')).toBeVisible();
        fireEvent.click(tile);
        await waitFor(() => expect(onSelectProviderIcon).toHaveBeenCalledWith(expect.objectContaining({
            provider: 'azure',
            category: 'Databases',
            packId: 'azure-official-icons-v20',
            shapeId: 'databases-azure-documentdb',
        })));
    });

    it('shows and applies the same labels in the architecture service picker', async () => {
        const onChange = vi.fn();
        render(
            <ArchitectureNodeSection
                nodeId="azure-service"
                data={{ label: 'Service', color: 'blue', archProvider: 'azure' }}
                onChange={onChange}
            />
        );
        fireEvent.change(screen.getByPlaceholderText('Search AZURE services'), { target: { value: 'SQL Database Fleet Manager' } });

        const tile = await screen.findByRole('button', { name: 'SQL Database Fleet Manager' });
        expect(within(tile).getByText('SQL Database Fleet Manager')).toBeVisible();
        fireEvent.click(tile);
        expect(onChange).toHaveBeenCalledWith('azure-service', expect.objectContaining({
            label: 'SQL Database Fleet Manager',
            subLabel: 'Databases',
            archIconPackId: 'azure-official-icons-v20',
            archIconShapeId: 'databases-sql-database-fleet-manager',
        }));
    });
});
