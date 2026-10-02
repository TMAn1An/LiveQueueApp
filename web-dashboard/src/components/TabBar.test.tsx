import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { TabBar } from './TabBar';

describe('TabBar (ADR-059)', () => {
  it('selects with a click and is reachable from the keyboard', async () => {
    const onSelect = vi.fn();
    render(
      <TabBar
        label="Sections"
        activeId="a"
        onSelect={onSelect}
        items={[
          { id: 'a', label: 'Alpha' },
          { id: 'b', label: 'Beta' },
        ]}
      />,
    );
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Alpha' })).toHaveFocus();
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith('b');
  });

  it('renders links for items with a route, with the same styling', () => {
    render(
      <MemoryRouter>
        <TabBar label="Sections" activeId="x" items={[{ id: 'x', label: 'Live', to: '/live' }]} />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: 'Live' });
    expect(link).toHaveAttribute('href', '/live');
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(link.className).toContain('h-10');
  });
});
