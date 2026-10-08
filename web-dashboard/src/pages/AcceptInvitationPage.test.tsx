import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AcceptInvitationPage } from './AcceptInvitationPage';
import { AuthLayout } from '../layouts/AuthLayout';
import { acceptInvitation, validateInvitation } from '../api/auth.api';
import { ApiError } from '../api/client';

vi.mock('../api/auth.api', () => ({
  acceptInvitation: vi.fn(),
  validateInvitation: vi.fn(),
}));

type AcceptResult = Awaited<ReturnType<typeof acceptInvitation>>;
const accepted: AcceptResult = { data: { email: 'invited@example.com' } };

beforeEach(() => {
  vi.mocked(acceptInvitation).mockClear();
  vi.mocked(validateInvitation).mockReset();
  vi.mocked(validateInvitation).mockResolvedValue({ data: { valid: true } });
});

/**
 * Rendered through the real `AuthLayout`, in the same arrangement App.tsx
 * mounts it — the duplicate logo was a composition bug, so testing the page
 * on its own would have missed it entirely.
 */
async function renderSetupPage(search = '?token=invite-token-123') {
  const view = renderRaw(search);
  // ADR-071: the link is validated before the form appears.
  if (search) await screen.findByRole('heading', { name: 'Set up your account' });
  return view;
}

function renderRaw(search = '?token=invite-token-123') {
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
  it('renders exactly one LiveQueue logo', async () => {
    await renderSetupPage();
    expect(screen.getAllByAltText('LiveQueue')).toHaveLength(1);
  });

  it('places that logo inside the setup card, alongside the heading', async () => {
    await renderSetupPage();

    const card = screen.getByRole('heading', { name: 'Set up your account' }).parentElement;
    expect(card).not.toBeNull();
    expect(card).toContainElement(screen.getByAltText('LiveQueue'));
  });

  it('leaves the heading as the page\'s only h1, so the logo is not a second one', async () => {
    await renderSetupPage();
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent('Set up your account');
  });
});

describe('AcceptInvitationPage form', () => {
  it('renders both password fields and the sign-in link', async () => {
    await renderSetupPage();

    expect(screen.getByLabelText('New password')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm password')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });

  it('sends the token from the URL with the chosen password', async () => {
    vi.mocked(acceptInvitation).mockResolvedValue(accepted);
    const user = userEvent.setup();
    await renderSetupPage();

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
    await renderSetupPage();

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
    await renderSetupPage();

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
    await renderSetupPage();

    await user.type(screen.getByLabelText('New password'), 'Password123');
    await user.type(screen.getByLabelText('Confirm password'), 'Password123');
    await user.click(screen.getByRole('button', { name: 'Set password' }));

    expect(await screen.findByText('This invitation has expired.')).toBeInTheDocument();
  });
});

describe('AcceptInvitationPage without a token', () => {
  it('explains the link is incomplete and offers no password form', () => {
    renderRaw('');

    expect(screen.getByText('This link is incomplete')).toBeInTheDocument();
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
    expect(acceptInvitation).not.toHaveBeenCalled();
  });

  it('still shows exactly one logo in that state', () => {
    renderRaw('');
    expect(screen.getAllByAltText('LiveQueue')).toHaveLength(1);
  });
});

describe('AcceptInvitationPage validates the link first (ADR-071)', () => {
  it('shows a small checking state, never the password form, while validating', () => {
    vi.mocked(validateInvitation).mockReturnValue(new Promise(() => {}));
    renderRaw();
    expect(screen.getByText('Checking your invitation link…')).toBeInTheDocument();
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
  });

  it('an invalid, expired or used link shows no password fields at all', async () => {
    vi.mocked(validateInvitation).mockResolvedValue({ data: { valid: false } });
    renderRaw();
    expect(
      await screen.findByText(
        'This invitation link has expired or is no longer valid. Ask the person who invited you to send a new one.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Confirm password')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set password' })).not.toBeInTheDocument();
    expect(validateInvitation).toHaveBeenCalledWith('invite-token-123');
  });

  it('if the check cannot reach the server, the form is offered and the submit decides', async () => {
    vi.mocked(validateInvitation).mockRejectedValue(new TypeError('Failed to fetch'));
    renderRaw();
    expect(await screen.findByLabelText('New password')).toBeInTheDocument();
  });

  it('a link that turns out to be used at submit switches to the invalid state', async () => {
    vi.mocked(acceptInvitation).mockRejectedValue(
      new ApiError(400, 'INVITATION_INVALID_OR_EXPIRED', 'This invitation link has expired or is no longer valid.'),
    );
    const user = userEvent.setup();
    await renderSetupPage();
    await user.type(screen.getByLabelText('New password'), 'Password123');
    await user.type(screen.getByLabelText('Confirm password'), 'Password123');
    await user.click(screen.getByRole('button', { name: 'Set password' }));
    expect(await screen.findByText("This invitation can't be used")).toBeInTheDocument();
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
  });
});
