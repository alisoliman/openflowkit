import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TopNavMenu } from './TopNavMenu';

describe('TopNavMenu', () => {
    it('closes when clicking outside', async () => {
        const onClose = vi.fn();

        render(
            <div>
                <TopNavMenu
                    isOpen={true}
                    isBeveled={false}
                    onToggle={vi.fn()}
                    onClose={onClose}
                    onGoHome={vi.fn()}
                    onOpenSettings={vi.fn()}
                    onHistory={vi.fn()}
                    onImportJSON={vi.fn()}
                />
                <button type="button">Outside</button>
            </div>
        );

        fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }));

        await waitFor(() => {
            expect(onClose).toHaveBeenCalled();
        });
    });

    it('moves keyboard focus through the menu and restores the trigger on Escape', async () => {
        const onClose = vi.fn();
        render(<TopNavMenu isOpen isBeveled={false} onToggle={vi.fn()} onClose={onClose}
            onGoHome={vi.fn()} onOpenSettings={vi.fn()} onHistory={vi.fn()} onImportJSON={vi.fn()} />);
        const items = await screen.findAllByRole('menuitem');
        expect(items[0]).toHaveFocus();
        fireEvent.keyDown(items[0], { key: 'ArrowDown' });
        expect(items[1]).toHaveFocus();
        fireEvent.keyDown(items[1], { key: 'Escape' });
        expect(onClose).toHaveBeenCalledOnce();
        expect(screen.getByRole('button', { name: 'Open main menu' })).toHaveFocus();
        expect(screen.getByRole('button', { name: 'Open main menu' })).toHaveAttribute('aria-expanded', 'true');
    });

});
