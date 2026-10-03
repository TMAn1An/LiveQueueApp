import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LoginPage } from '../pages/LoginPage';
import { recentAuthTimings } from '../utils/authTiming';

/** The branded loader appears only once sign-in has taken over ~300ms. */
let resolveLogin: () => void = () => undefined;
let rejectLogin: (e: Error) => void = () => undefined;
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    login: () =>
      new Promise<void>((resolve, reject) => {
        resolveLogin = resolve;
        rejectLogin = reject;
      }),
  }),
}));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function submit() {
  render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );
  const form = screen.getByRole('button', { name: 'Sign in' }).closest('form')!;
  act(() => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

describe('sign-in loader (login and sign-up only)', () => {
  it('stays hidden for a quick sign-in', async () => {
    submit();
    act(() => vi.advanceTimersByTime(250));
    expect(screen.queryByText('Signing you in…', { selector: 'p' })).not.toBeInTheDocument();
    await act(async () => resolveLogin());
    expect(screen.queryByText('Signing you in…', { selector: 'p' })).not.toBeInTheDocument();
    expect(recentAuthTimings().at(-1)).toMatchObject({ kind: 'login', outcome: 'success' });
  });

  it('shows the branded loader once sign-in takes longer than 300ms, and hides it when done', async () => {
    submit();
    act(() => vi.advanceTimersByTime(301));
    expect(screen.getByRole('status')).toHaveTextContent('Signing you in…');
    expect(screen.getByAltText('LiveQueue')).toBeInTheDocument();
    await act(async () => rejectLogin(new Error('down')));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(recentAuthTimings().at(-1)).toMatchObject({ kind: 'login', outcome: 'error' });
  });
});
