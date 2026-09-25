import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExportMenuPanel } from './ExportMenuPanel';

vi.mock('react-i18next', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-i18next')>();
    return {
        ...actual,
        useTranslation: () => ({
            t: (
                key: string,
                options?: string | { defaultValue?: string; appName?: string }
            ) => {
                if (typeof options === 'string') {
                    return options;
                }

                if (key === 'export.openflowdslLabel') {
                    return `${options?.appName ?? 'OpenFlowKit'} DSL`;
                }

                return options?.defaultValue ?? key;
            },
        }),
    };
});

describe('ExportMenuPanel', () => {
    it('switches categories and updates the format selector content', () => {
        render(<ExportMenuPanel onSelect={vi.fn()} />);

        expect(screen.getByRole('combobox', { name: 'Format' })).toBeTruthy();

        fireEvent.click(screen.getByRole('tab', { name: /Code/i }));

        expect(screen.getByRole('combobox', { name: 'Format' })).toBeTruthy();

        fireEvent.click(within(screen.getByTestId('export-format-select')).getByRole('combobox', { name: 'Format' }));
        fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: /Mermaid/i }));

        expect(screen.getByRole('combobox', { name: 'Format' })).toHaveTextContent('Mermaid');
        expect(screen.getByTestId('export-action-mermaid-download')).toBeTruthy();
        expect(screen.getByTestId('export-action-mermaid-copy')).toBeTruthy();
    });

    it('keeps PNG background solid by default and passes transparency when enabled', () => {
        const onSelect = vi.fn();

        render(<ExportMenuPanel onSelect={onSelect} />);

        expect(screen.getByLabelText(/Transparent background/i)).not.toBeChecked();

        fireEvent.click(screen.getByTestId('export-action-png-download'));
        expect(onSelect).toHaveBeenCalledWith('png', 'download', {
            transparentBackground: false,
        });

        fireEvent.click(screen.getByLabelText(/Transparent background/i));
        fireEvent.click(screen.getByTestId('export-action-png-copy'));

        expect(onSelect).toHaveBeenLastCalledWith('png', 'copy', {
            transparentBackground: true,
        });
    });

    it('fires the selected export key from the primary action button', () => {
        const onSelect = vi.fn();

        render(<ExportMenuPanel onSelect={onSelect} />);

        fireEvent.click(screen.getByRole('tab', { name: /Code/i }));
        fireEvent.click(within(screen.getByTestId('export-format-select')).getByRole('combobox', { name: 'Format' }));
        fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: /Figma Editable/i }));
        fireEvent.click(screen.getByTestId('export-action-figma-copy'));

        expect(onSelect).toHaveBeenCalledWith('figma', 'copy', {
            transparentBackground: undefined,
        });
    });

    it('removes share and PlantUML copy actions from the export panel', () => {
        render(<ExportMenuPanel onSelect={vi.fn()} />);

        fireEvent.click(screen.getByRole('tab', { name: /Code/i }));
        fireEvent.click(within(screen.getByTestId('export-format-select')).getByRole('combobox', { name: 'Format' }));
        fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: /PlantUML/i }));

        expect(screen.getByTestId('export-action-plantuml-download')).toBeTruthy();
        expect(screen.queryByTestId('export-action-plantuml-copy')).toBeNull();
        expect(screen.queryByText(/Share & Embed/i)).toBeNull();
    });

    it('shows cinematic build options in the video section', () => {
        render(<ExportMenuPanel onSelect={vi.fn()} />);

        fireEvent.click(screen.getByRole('tab', { name: /Video/i }));

        expect(screen.getByTestId('export-format-summary')).toBeTruthy();
        expect(screen.getByText(/Cinematic Build Video/i)).toBeTruthy();
        expect(screen.queryByTestId('export-format-select')).toBeNull();
    });

    it('renders video controls before the download action and uses shared control interactions', () => {
        const onCinematicSpeedChange = vi.fn();
        const onCinematicResolutionChange = vi.fn();

        render(
            <ExportMenuPanel
                onSelect={vi.fn()}
                cinematicSpeed="normal"
                onCinematicSpeedChange={onCinematicSpeedChange}
                cinematicResolution="1080p"
                onCinematicResolutionChange={onCinematicResolutionChange}
            />
        );

        fireEvent.click(screen.getByRole('tab', { name: /Video/i }));
        const downloadButton = screen.getByTestId('export-action-cinematic-video-download');
        expect(downloadButton).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: '2×' }));
        fireEvent.click(screen.getByRole('button', { name: '4K' }));

        expect(onCinematicSpeedChange).toHaveBeenCalledWith('fast');
        expect(onCinematicResolutionChange).toHaveBeenCalledWith('4k');
    });

    it('offers the wired native OpenFlow DSL format for download and copy', () => {
        const onSelect = vi.fn();
        render(<ExportMenuPanel onSelect={onSelect} />);
        fireEvent.click(screen.getByRole('tab', { name: 'Code' }));
        fireEvent.click(screen.getByRole('combobox', { name: 'Format' }));
        fireEvent.click(screen.getByRole('option', { name: /OpenFlow DSL/i }));
        fireEvent.click(screen.getByRole('button', { name: 'Download OpenFlow DSL' }));
        expect(onSelect).toHaveBeenCalledWith('openflow', 'download', { transparentBackground: undefined });
        expect(screen.getByRole('button', { name: 'Copy OpenFlow DSL' })).toBeEnabled();
    });

    it('supports category keyboard navigation and keeps pending actions disabled', () => {
        const props = { onSelect: vi.fn(), onClose: vi.fn() };
        const view = render(<ExportMenuPanel {...props} />);
        fireEvent.keyDown(screen.getByRole('tab', { name: 'Image' }), { key: 'ArrowRight' });
        expect(screen.getByRole('tab', { name: 'Video' })).toHaveFocus();
        expect(screen.getByRole('tab', { name: 'Video' })).toHaveAttribute('aria-selected', 'true');
        view.rerender(<ExportMenuPanel {...props} pendingAction={{ key: 'cinematic-video', action: 'download' }} />);
        expect(screen.getByRole('button', { name: 'Download Cinematic Build Video' })).toBeDisabled();
        expect(screen.getByRole('tab', { name: 'Image' })).toBeDisabled();
        expect(screen.getByRole('status')).toHaveTextContent('Preparing your export');
        expect(screen.getByRole('button', { name: 'Close export' })).toBeEnabled();
    });

    it('shows a handled failure in context so its settings can be retried', () => {
        render(<ExportMenuPanel onSelect={vi.fn()} errorMessage="Clipboard permission denied." />);
        expect(screen.getByRole('alert')).toHaveTextContent('Clipboard permission denied.');
        expect(screen.getByRole('button', { name: 'Copy PNG' })).toBeEnabled();
    });

});
