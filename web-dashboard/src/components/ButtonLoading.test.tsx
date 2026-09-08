import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './Button';

/**
 * The shared button is what every async action in the dashboard renders, so
 * proving the loading contract once here covers all of them rather than
 * asserting the same thing per screen.
 */
describe('Button loading state', () => {
  it('marks itself busy and blocks further clicks while loading', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Saving…
      </Button>,
    );

    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');

    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('prevents a double submit on a destructive action', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = render(
      <Button variant="danger" onClick={onClick}>
        Delete
      </Button>,
    );

    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);

    // Once the mutation reports pending, the second click cannot land.
    rerender(
      <Button variant="danger" loading onClick={onClick}>
        Deleting…
      </Button>,
    );
    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is interactive again once the action settles, whatever the outcome', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = render(
      <Button loading onClick={onClick}>
        Saving…
      </Button>,
    );

    // A failed request leaves loading false just like a successful one —
    // nothing can strand the button in a disabled state.
    rerender(<Button onClick={onClick}>Save</Button>);

    const button = screen.getByRole('button');
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute('aria-busy');
    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('still respects an explicit disabled prop', () => {
    render(
      <Button disabled onClick={vi.fn()}>
        Save
      </Button>,
    );

    expect(screen.getByRole('button')).toBeDisabled();
  });
});
