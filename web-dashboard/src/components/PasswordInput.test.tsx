import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PasswordInput } from './PasswordInput';

describe('PasswordInput', () => {
  it('hides the password by default', () => {
    render(<PasswordInput aria-label="Password" defaultValue="hunter2" />);

    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Show password' })).toBeInTheDocument();
  });

  it('reveals and re-hides the value without changing it', async () => {
    const user = userEvent.setup();
    render(<PasswordInput aria-label="Password" defaultValue="hunter2" />);
    const input = screen.getByLabelText('Password');

    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveValue('hunter2');

    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveValue('hunter2');
  });

  it('is reachable and operable from the keyboard alone', async () => {
    const user = userEvent.setup();
    render(<PasswordInput aria-label="Password" defaultValue="hunter2" />);

    await user.tab();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Show password' })).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
  });

  it('passes through the attributes password managers rely on', () => {
    render(
      <PasswordInput
        id="current-password"
        aria-label="Password"
        autoComplete="current-password"
        required
        minLength={8}
      />,
    );
    const input = screen.getByLabelText('Password');

    expect(input).toHaveAttribute('id', 'current-password');
    expect(input).toHaveAttribute('autocomplete', 'current-password');
    expect(input).toBeRequired();
    expect(input).toHaveAttribute('minlength', '8');
  });
});
