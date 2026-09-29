import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from './Button';

/**
 * V2 Dashboard Visual Hierarchy pass: `size` must default to the button's
 * exact pre-existing appearance, so every call site that never passes it
 * (almost all of them) renders unchanged — only the operationally important
 * actions the spec names opt into `lg`.
 */
describe('Button size', () => {
  it('defaults to the original md padding/type scale', () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.className).toContain('px-3 py-2 text-sm');
    expect(button.className).not.toContain('px-4 py-2.5 text-base');
  });

  it('renders a visibly larger scale for size="lg"', () => {
    render(<Button size="lg">Create Queue</Button>);
    const button = screen.getByRole('button', { name: 'Create Queue' });
    expect(button.className).toContain('px-4 py-2.5 text-base');
    expect(button.className).not.toContain('px-3 py-2 text-sm');
  });
});
