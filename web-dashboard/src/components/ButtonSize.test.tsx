import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from './Button';

/**
 * V2 Dashboard Visual Hierarchy pass: `size` must default to the standard
 * scale, so every call site that never passes it renders the same — only the
 * operationally important actions opt into `lg`. Each size has a fixed
 * height, so buttons of one size line up exactly side by side whatever their
 * variant.
 */
describe('Button size', () => {
  it('defaults to the md scale', () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.className).toContain('h-9 px-3 text-sm');
    expect(button.className).not.toContain('h-11');
  });

  it('renders a visibly larger scale for size="lg"', () => {
    render(<Button size="lg">Create Queue</Button>);
    const button = screen.getByRole('button', { name: 'Create Queue' });
    expect(button.className).toContain('h-11 px-4 text-base');
    expect(button.className).not.toContain('h-9');
  });

  it('every variant has the same height, so equal sizes line up side by side', () => {
    render(
      <>
        <Button variant="primary">A</Button>
        <Button variant="outline">B</Button>
        <Button variant="danger">C</Button>
      </>,
    );
    for (const name of ['A', 'B', 'C']) {
      // A fixed height, not vertical padding: the outline variant's border
      // must not make it taller than its filled neighbours.
      const className = screen.getByRole('button', { name }).className;
      expect(className).toContain('h-9');
      expect(className).not.toMatch(/\bpy-/);
    }
  });

  it('only the outline variant draws a border, and it is a visible one', () => {
    render(
      <>
        <Button variant="outline">Outline</Button>
        <Button variant="primary">Primary</Button>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Outline' }).className).toContain('border border-border-strong');
    // A shared transparent border would override the outline colour.
    expect(screen.getByRole('button', { name: 'Primary' }).className).not.toContain('border-transparent');
  });
});

// ADR-059: a navigation action renders as a link with exactly the button's
// classes — no button nested in a link, no inline wrapper changing its height.
describe('ButtonLink', () => {
  it('is a single link with the same classes as a Button of the same variant and size', async () => {
    const { MemoryRouter } = await import('react-router-dom');
    const { ButtonLink } = await import('./Button');
    render(
      <MemoryRouter>
        <Button variant="secondary" size="lg">Act</Button>
        <ButtonLink to="/go" variant="secondary" size="lg">Go</ButtonLink>
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: 'Go' });
    expect(link.querySelector('button')).toBeNull();
    expect(link.className).toBe(screen.getByRole('button', { name: 'Act' }).className);
  });
});
