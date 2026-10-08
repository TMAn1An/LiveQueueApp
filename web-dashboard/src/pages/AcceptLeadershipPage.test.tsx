import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AcceptLeadershipPage } from './AcceptLeadershipPage';
import * as api from '../api/leadership.api';
import { ApiError } from '../api/client';

vi.mock('../api/leadership.api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/leadership.api')>();
  return { ...actual, validateSuccessorLink: vi.fn(), acceptSuccession: vi.fn(), declineSuccession: vi.fn() };
});

const VALID = {
  valid: true as const,
  organizationName: 'Dhaka Clinic',
  currentHeadName: 'Hana Head',
  reason: 'RETIREMENT' as const,
  successorName: 'Nadia Next',
  successorEmail: 'nadia@example.com',
  existingMember: false,
  acceptanceStatement:
    'I accept responsibility as the Organization Head of Dhaka Clinic. I understand that the current Organization Head will lose access when this handover is completed.',
};

function renderPage(search = '?token=t-1') {
  return render(
    <MemoryRouter initialEntries={[`/accept-leadership${search}`]}>
      <Routes>
        <Route path="/accept-leadership" element={<AcceptLeadershipPage />} />
        <Route path="/login" element={<div>Login Page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(api.validateSuccessorLink).mockReset();
  vi.mocked(api.acceptSuccession).mockReset();
  vi.mocked(api.declineSuccession).mockReset();
});

describe('Accepting the Organization Head role (ADR-071)', () => {
  it('checks the link before showing anything', () => {
    vi.mocked(api.validateSuccessorLink).mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByText('Checking your handover link…')).toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  });

  it('an invalid, used or expired link shows nothing actionable', async () => {
    vi.mocked(api.validateSuccessorLink).mockResolvedValue({ data: { valid: false } });
    renderPage();
    expect(await screen.findByText("This handover link can't be used")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept responsibility' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  });

  it('shows the organization, the current Head and the reason, and requires the explicit acknowledgement', async () => {
    vi.mocked(api.validateSuccessorLink).mockResolvedValue({ data: VALID });
    vi.mocked(api.acceptSuccession).mockResolvedValue({ data: { accepted: true, organizationName: 'Dhaka Clinic' } });
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Lead Dhaka Clinic' })).toBeInTheDocument();
    expect(screen.getAllByText('Hana Head').length).toBeGreaterThan(0);
    expect(screen.getByText('Retirement')).toBeInTheDocument();

    const accept = screen.getByRole('button', { name: 'Accept responsibility' });
    await userEvent.type(screen.getByLabelText('Choose a password'), 'Password123');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'Password123');
    expect(accept).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: VALID.acceptanceStatement }));
    expect(accept).toBeEnabled();
    await userEvent.click(accept);
    expect(api.acceptSuccession).toHaveBeenCalledWith('t-1', 'Password123');
    expect(await screen.findByText('You are now the Organization Head')).toBeInTheDocument();
  });

  it('an existing member re-enters their own password; no confirmation field', async () => {
    vi.mocked(api.validateSuccessorLink).mockResolvedValue({ data: { ...VALID, existingMember: true } });
    renderPage();
    expect(await screen.findByLabelText('Your current password')).toBeInTheDocument();
    expect(screen.queryByLabelText('Confirm password')).not.toBeInTheDocument();
  });

  it('the successor can decline', async () => {
    vi.mocked(api.validateSuccessorLink).mockResolvedValue({ data: VALID });
    vi.mocked(api.declineSuccession).mockResolvedValue({ data: { declined: true } });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Decline' }));
    expect(await screen.findByText('Handover declined')).toBeInTheDocument();
  });

  it('a link that became invalid meanwhile switches to the invalid state on accept', async () => {
    vi.mocked(api.validateSuccessorLink).mockResolvedValue({ data: { ...VALID, existingMember: true } });
    vi.mocked(api.acceptSuccession).mockRejectedValue(
      new ApiError(400, 'HEAD_SUCCESSION_INVALID', 'This handover link has expired or is no longer valid.'),
    );
    renderPage();
    await userEvent.type(await screen.findByLabelText('Your current password'), 'Password123');
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Accept responsibility' }));
    expect(await screen.findByText("This handover link can't be used")).toBeInTheDocument();
  });
});
