import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AcceptInvitationPage } from './AcceptInvitationPage';
import { AuthLayout } from '../layouts/AuthLayout';
import { acceptInvitation } from '../api/auth.api';
import { ApiError } from '../api/client';

vi.mock('../api/auth.api', () => ({
  acceptInvitation: vi.fn(),
}));

type AcceptResult = Awaited<ReturnType<typeof acceptInvitation>>;
const accepted: AcceptResult = { data: { email: 'invited@example.com' } };

beforeEach(() => {
  vi.mocked(acceptInvitation).mockClear();
});

/**
 * Rendered through the real `AuthLayout`, in the same arrangement App.tsx
 * mounts it — the duplicate logo was a composition bug, so testing the page
 * on its own would have missed it entirely.
 */
function renderSetupPage(search = '?token=invite-token-123') {
  return render(
    <MemoryRouter initialEntries={[`/accept-invitation${search}`]}>
      <Routes>
        <Route element={<AuthLayout brand="inside" />}>
          <Route path="/accept-invitation" element={<AcceptInvitationPage />} />
        </Route>
        <Route path="/login" element={<div>Login Page Content</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AcceptInvitationPage branding', () => {
  it('renders exactly one LiveQueue logo', () => {
    renderSetupPage();
    expect(screen.getAllByAltText('LiveQueue')).toHaveLength(1);
  });

  it('places that logo inside the setup card, alongside the heading', () => {
    renderSetupPage();

    const card = screen.getByRole('heading', { name: 'Set up your account' }).parentElement;
    expect(card).not.toBeNull();
    expect(card).toContainElement(screen.getByAltText('LiveQueue'));
  });

  it('leaves the heading as the page\'s only h1, so the logo is not a second one', () => {
    renderSetupPage();
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent('Set up your account');
  });
});

describe('AcceptInvitationPage form', () => {
  it('renders both password fields and the sign-in link', () => {
    renderSetupPage();

    expect(screen.getByLabelText('New password')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm password')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });

  it('sends the token from the URL with the chosen password', async () => {
    vi.mocked(acceptInvitation).mockResolvedValue(accepted);
    const user = userEvent.setup();
    renderSetupPage();

    await user.type(screen.getByLabelText('New password'), 'Password123');
    await user.type(screen.getByLabelText('Confirm password'), 'Password123');
    await user.click(screen.getByRole('button', { name: 'Set password' }));

    await waitFor(() =>
      expect(acceptInvitation).toHaveBeenCalledWith('invite-token-123', 'Password123'),
    );
    expect(await screen.findByText('Your account is ready')).toBeInTheDocument();
  });

  it('keeps Set password disabled until both fields match and are long enough', async () => {
    const user = userEvent.setup();
    renderSetupPage();

    const submit = screen.getByRole('button', { name: 'Set password' });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText('New password'), 'Password123');
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText('Confirm password'), 'Password12');
    expect(screen.getByText('These do not match.')).toBeInTheDocument();
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText('Confirm password'), '3');
    expect(submit).toBeEnabled();
  });

  it('shows the in-flight label while the request is outstanding', async () => {
    let release: () => void = () => {};
    vi.mocked(acceptInvitation).mockReturnValue(
      new Promise<AcceptResult>((resolve) => {
        release = () => resolve(accepted);
      }),
    );
    const user = userEvent.setup();
    renderSetupPage();

    await user.type(screen.getByLabelText('New password'), 'Password123');
    await user.type(screen.getByLabelText('Confirm password'), 'Password123');
    await user.click(screen.getByRole('button', { name: 'Set password' }));

    const submit = await screen.findByRole('button', { name: 'Setting up…' });
    expect(submit).toBeDisabled();

    release();
    await waitFor(() => expect(screen.getByText('Your account is ready')).toBeInTheDocument());
  });

  it('surfaces the server message when the invitation is rejected', async () => {
    vi.mocked(acceptInvitation).mockRejectedValue(
      new ApiError(410, 'INVITATION_EXPIRED', 'This invitation has expired.'),
    );
    const user = userEvent.setup();
    renderSetupPage();

    await user.type(screen.getByLabelText('New password'), 'Password123');
    await user.type(screen.getByLabelText('Confirm password'), 'Password123');
    await user.click(screen.getByRole('button', { name: 'Set password' }));

    expect(await screen.findByText('This invitation has expired.')).toBeInTheDocument();
  });
});

describe('AcceptInvitationPage without a token', () => {
  it('explains the link is incomplete and offers no password form', () => {
    renderSetupPage('');

    expect(screen.getByText('This link is incomplete')).toBeInTheDocument();
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
    expect(acceptInvitation).not.toHaveBeenCalled();
  });

  it('still shows exactly one logo in that state', () => {
    renderSetupPage('');
    expect(screen.getAllByAltText('LiveQueue')).toHaveLength(1);
  });
});
