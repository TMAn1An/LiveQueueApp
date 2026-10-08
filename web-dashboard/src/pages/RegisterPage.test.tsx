import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RegisterPage } from './RegisterPage';
import * as authApi from '../api/auth.api';
import { resetBackendWarmupForTests } from '../hooks/useBackendWarmup';

vi.mock('../api/auth.api');
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ register: vi.fn() }),
}));

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('RegisterPage — organization name availability', () => {
  it('shows a taken name as you type and blocks creating the organization', async () => {
    vi.mocked(authApi.checkOrganizationNameAvailability).mockResolvedValue({ data: { available: false } } as never);
    renderPage();

    await userEvent.type(screen.getByLabelText('Organization name'), 'Volvo');

    expect(await screen.findByText(/already taken/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create organization' })).toBeDisabled();
  });

  it('shows an available name, and checks it case-insensitively', async () => {
    vi.mocked(authApi.checkOrganizationNameAvailability).mockResolvedValue({ data: { available: true } } as never);
    renderPage();

    await userEvent.type(screen.getByLabelText('Organization name'), '  New   Clinic ');

    expect(await screen.findByText(/is available/i)).toBeInTheDocument();
    expect(authApi.checkOrganizationNameAvailability).toHaveBeenLastCalledWith('new clinic', expect.anything());
    expect(screen.getByRole('button', { name: 'Create organization' })).toBeEnabled();
  });

  it('does not check a name too short to register', async () => {
    renderPage();

    await userEvent.type(screen.getByLabelText('Organization name'), 'A');

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(authApi.checkOrganizationNameAvailability).not.toHaveBeenCalled();
  });
});

describe('RegisterPage — a slow or unreachable server (ADR-071)', () => {
  /** A name check that never answers on its own, but honours cancellation. */
  function hangingCheck() {
    const signals: AbortSignal[] = [];
    vi.mocked(authApi.checkOrganizationNameAvailability).mockImplementation(
      (_name: string, signal?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          if (signal) {
            signals.push(signal);
            signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
          }
        }) as never,
    );
    return signals;
  }

  it('after 2.5 s says you can keep going; the rest of the form stays usable', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      hangingCheck();
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderPage();
      await user.type(screen.getByLabelText('Organization name'), 'Slow Clinic');
      await act(() => vi.advanceTimersByTimeAsync(400));
      expect(screen.getByText('Checking availability…')).toBeInTheDocument();
      await act(() => vi.advanceTimersByTimeAsync(2600));
      expect(screen.getByText('Still checking — you can keep filling in the form.')).toBeInTheDocument();
      await user.type(screen.getByLabelText('Owner email'), 'me@example.com');
      expect(screen.getByLabelText('Owner email')).toHaveValue('me@example.com');
      expect(screen.getByRole('button', { name: 'Create organization' })).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up after 10 s — never claims the name is available — and the server decides on submit', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const signals = hangingCheck();
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderPage();
      await user.type(screen.getByLabelText('Organization name'), 'Slow Clinic');
      await act(() => vi.advanceTimersByTimeAsync(400));
      await act(() => vi.advanceTimersByTimeAsync(10_000));
      expect(
        screen.getByText("Couldn't check right now — we'll confirm the name when you create the organization."),
      ).toBeInTheDocument();
      expect(signals.at(-1)?.aborted).toBe(true);
      expect(screen.queryByText(/is available/i)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Create organization' })).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a network failure is "unknown", not "available"', async () => {
    vi.mocked(authApi.checkOrganizationNameAvailability).mockRejectedValue(new TypeError('Failed to fetch'));
    renderPage();
    await userEvent.type(screen.getByLabelText('Organization name'), 'Offline Clinic');
    expect(
      await screen.findByText("Couldn't check right now — we'll confirm the name when you create the organization."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/is available/i)).not.toBeInTheDocument();
  });

  it('a late answer for an earlier name never shows against the current one', async () => {
    let answerFirst: (available: boolean) => void = () => {};
    vi.mocked(authApi.checkOrganizationNameAvailability).mockImplementation((name: string) =>
      name === 'first clinic'
        ? (new Promise((resolve) => {
            answerFirst = (available) => resolve({ data: { available } });
          }) as never)
        : (Promise.resolve({ data: { available: false } }) as never),
    );
    renderPage();
    const input = screen.getByLabelText('Organization name');
    await userEvent.type(input, 'First Clinic');
    await waitFor(() => expect(authApi.checkOrganizationNameAvailability).toHaveBeenCalledWith('first clinic', expect.anything()));
    await userEvent.clear(input);
    await userEvent.type(input, 'Second Clinic');
    expect(await screen.findByText(/already taken/i)).toBeInTheDocument();
    answerFirst(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(/is available/i)).not.toBeInTheDocument();
    expect(screen.getByText(/already taken/i)).toBeInTheDocument();
  });

  it('wakes the server in the background when the page opens', () => {
    resetBackendWarmupForTests();
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/health$/), expect.objectContaining({ mode: 'no-cors' }));
    vi.unstubAllGlobals();
  });
});
