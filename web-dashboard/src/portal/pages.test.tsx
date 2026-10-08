import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { PortalApp, PortalRoutes } from './PortalApp';

/**
 * ADR-068 portal flows against a fake backend (fetch) and a fake socket.
 * Real Safari push delivery is NOT exercised here — see the ADR's
 * "automated vs real iOS QA" note.
 */

type Handler = (url: URL, init: RequestInit) => { status?: number; body: unknown } | undefined;
let handlers: Handler[] = [];
const calls: { method: string; path: string; body: unknown; headers: Record<string, string> }[] = [];

function ok(data: unknown, status = 200) {
  return { status, body: { success: true, data } };
}

beforeEach(() => {
  handlers = [];
  calls.length = 0;
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(input);
      calls.push({
        method: init.method ?? 'GET',
        path: url.pathname + url.search,
        body: init.body ? JSON.parse(String(init.body)) : undefined,
        headers: (init.headers ?? {}) as Record<string, string>,
      });
      for (const handler of handlers) {
        const hit = handler(url, init);
        if (hit) {
          return new Response(hit.status === 204 ? null : JSON.stringify(hit.body), { status: hit.status ?? 200 });
        }
      }
      return new Response(JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: 'Not found.' } }), {
        status: 404,
      });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// --- fake socket.io --------------------------------------------------------
const socketHandlers: Record<string, ((...args: unknown[]) => void)[]> = {};
const fakeSocket = {
  connected: false,
  emitted: [] as unknown[][],
  on(event: string, cb: (...args: unknown[]) => void) {
    (socketHandlers[event] ??= []).push(cb);
    return fakeSocket;
  },
  emit(...args: unknown[]) {
    fakeSocket.emitted.push(args);
  },
  connect() {
    fakeSocket.connected = true;
    socketHandlers.connect?.forEach((cb) => cb());
  },
  disconnect() {
    fakeSocket.connected = false;
  },
  removeAllListeners() {
    for (const key of Object.keys(socketHandlers)) delete socketHandlers[key];
  },
  io: { on: () => undefined, off: () => undefined },
};
vi.mock('socket.io-client', () => ({ io: () => fakeSocket }));
function fire(event: string, envelope: unknown = {}) {
  socketHandlers[event]?.forEach((cb) => cb(envelope));
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PortalRoutes />
    </MemoryRouter>,
  );
}

const ORG = {
  organization: { name: 'ABC Hospital', publicCode: 'abc123def456' },
  queues: [
    {
      id: 'q-em',
      name: 'Emergency',
      description: null,
      availability: 'JOINABLE',
      closedReason: null,
      message: null,
      waitingCount: 8,
      estimatedWaitMinutes: 18,
      timezone: 'UTC',
      todaySessions: null,
      nextSessionStartMinute: null,
    },
    {
      id: 'q-bill',
      name: 'Billing',
      description: null,
      availability: 'CLOSED',
      closedReason: 'SCHEDULE',
      message: 'Opens tomorrow at 9:00 AM',
      waitingCount: 0,
      estimatedWaitMinutes: null,
      timezone: 'UTC',
      todaySessions: null,
      nextSessionStartMinute: null,
    },
  ],
};

describe('gate', () => {
  it.each([
    ['android', 'LiveQueue for Android is available through the Android app.'],
    ['ios-other', 'Open this link in Safari to use LiveQueue.'],
    ['desktop', 'This portal is designed for iPhone and iPad.'],
  ] as const)('%s sees a friendly pointer, and nothing is fetched', (kind, text) => {
    render(<PortalApp kind={kind} />);
    expect(screen.getByRole('heading', { name: text })).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });
});

describe('organization QR → queue list', () => {
  it('lists the organization’s queues with their public state', async () => {
    handlers.push((url) => (url.pathname === '/api/public/organizations/abc123def456' ? ok(ORG) : undefined));
    renderAt('/visit/abc123def456');

    expect(await screen.findByRole('heading', { name: 'ABC Hospital' })).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Queues' });
    const [emergency, billing] = within(list).getAllByRole('listitem');
    expect(within(emergency!).getByText('8 people waiting · About 18 min wait')).toBeInTheDocument();
    expect(within(emergency!).getByRole('link', { name: 'Join now' })).toHaveAttribute(
      'href',
      '/visit/abc123def456/q/q-em',
    );
    expect(within(billing!).getByText('Closed')).toBeInTheDocument();
    expect(within(billing!).getByText('Opens tomorrow at 9:00 AM')).toBeInTheDocument();
    expect(within(billing!).queryByRole('link', { name: 'Join now' })).not.toBeInTheDocument();
  });

  it('an unknown code says so', async () => {
    renderAt('/visit/zzzzzzzzzzzz');
    expect(await screen.findByRole('alert')).toHaveTextContent('Not found.');
  });
});

const CONFIG = {
  id: 'q-em',
  name: 'Emergency',
  description: null,
  status: 'ACTIVE',
  // ADR-071 D1: a stale/retired false — the portal must not treat it as a
  // single-service queue.
  allowMultipleServices: false,
  identity: { requiresVerifiedEmail: false, configurationRequired: false, repeatRestricted: false },
  schedule: { acceptingJoins: true, message: null },
  services: [
    { id: 's1', serviceName: 'Triage', description: null, durationMinutes: 10 },
    { id: 's2', serviceName: 'Dressing', description: null, durationMinutes: 5 },
  ],
  formFields: [
    { id: 'f1', key: 'full_name', label: 'Full name', type: 'text', required: true, placeholder: null, options: [] },
  ],
};

const TOKEN = {
  id: 'tok-1',
  queueId: 'q-em',
  serialNumber: 'E009',
  status: 'WAITING',
  position: 3,
  estimatedWaitMinutes: 12,
  etaUnavailableReason: null,
  counter: null,
  services: [{ id: 's1', serviceName: 'Triage' }],
  serviceStartVerificationRequired: false,
};

describe('queue → services → form → join', () => {
  it('joins with this browser’s installation id and an idempotency key, then tracks the visit', async () => {
    handlers.push((url, init) => {
      if (url.pathname === '/api/public/queues/q-em/config') return ok(CONFIG);
      if (url.pathname === '/api/tokens' && init.method === 'POST') return ok(TOKEN, 201);
      if (url.pathname === '/api/tokens/tok-1') return ok(TOKEN);
      if (url.pathname === '/api/public/web-push/config') return ok({ enabled: true, vapidPublicKey: 'BAAA' });
      return undefined;
    });
    renderAt('/visit/abc123def456/q/q-em');

    expect(await screen.findByRole('heading', { name: 'Emergency' })).toBeInTheDocument();
    const join = screen.getByRole('button', { name: 'Join queue' });
    expect(join).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /Add Triage/ }));
    expect(join).toBeDisabled(); // the required question is still empty
    await userEvent.type(screen.getByLabelText(/Full name/), 'Sami');
    await userEvent.click(join);

    expect(await screen.findByTestId('serial')).toHaveTextContent('E009');
    const post = calls.find((c) => c.method === 'POST' && c.path === '/api/tokens')!;
    expect(post.body).toEqual({
      queueId: 'q-em',
      serviceIds: ['s1'],
      deviceIdentifier: localStorage.getItem('livequeue.portal.browserInstallationId'),
      formData: { full_name: 'Sami' },
    });
    expect(post.headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(localStorage.getItem('livequeue.portal.visits')!)[0]).toMatchObject({
      tokenId: 'tok-1',
      serialNumber: 'E009',
      queueName: 'Emergency',
    });
  });

  it('shows the backend’s refusal as-is (e.g. already in this queue)', async () => {
    handlers.push((url, init) => {
      if (url.pathname === '/api/public/queues/q-em/config') return ok({ ...CONFIG, formFields: [] });
      if (url.pathname === '/api/tokens' && init.method === 'POST')
        return { status: 409, body: { success: false, error: { code: 'ACTIVE_TOKEN_EXISTS', message: 'You are already in this queue.' } } };
      return undefined;
    });
    renderAt('/visit/abc123def456/q/q-em');
    await userEvent.click(await screen.findByRole('button', { name: /Add Dressing/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Join queue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('You are already in this queue.');
  });

  it('a closed queue offers no way to join', async () => {
    handlers.push((url) =>
      url.pathname === '/api/public/queues/q-em/config'
        ? ok({ ...CONFIG, schedule: { acceptingJoins: false, message: 'Closed for today.' } })
        : undefined,
    );
    renderAt('/visit/abc123def456/q/q-em');
    expect(await screen.findByText('Closed for today.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Join queue' })).not.toBeInTheDocument();
  });

  it('a verified-email queue verifies before joining and sends the proof, never the code', async () => {
    handlers.push((url, init) => {
      if (url.pathname === '/api/public/queues/q-em/config')
        return ok({ ...CONFIG, formFields: [], identity: { ...CONFIG.identity, requiresVerifiedEmail: true } });
      if (url.pathname === '/api/public/email-verification/start') return ok({ verificationId: '11111111-2222-4333-8444-555555555555' }, 201);
      if (url.pathname === '/api/public/email-verification/confirm') return ok({ verificationProof: 'opaque-proof' });
      if (url.pathname === '/api/tokens' && init.method === 'POST') return ok(TOKEN, 201);
      if (url.pathname === '/api/tokens/tok-1') return ok(TOKEN);
      return undefined;
    });
    renderAt('/visit/abc123def456/q/q-em');
    await userEvent.click(await screen.findByRole('button', { name: /Add Triage/ }));
    expect(screen.getByRole('button', { name: 'Join queue' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Email'), 'sami@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send code' }));
    await userEvent.type(await screen.findByLabelText('6-digit code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Verify code' }));
    expect(await screen.findByText('Email verified.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Join queue' }));
    await screen.findByTestId('serial');
    const post = calls.find((c) => c.method === 'POST' && c.path === '/api/tokens')!;
    expect(post.body).toMatchObject({ emailVerificationProof: 'opaque-proof' });
    expect(JSON.stringify(post.body)).not.toContain('123456');
  });
});

describe('live tracking', () => {
  it('joins the token room, applies events without re-reading, re-reads on reconnect, and shows the counter when called', async () => {
    let current: Record<string, unknown> = { ...TOKEN };
    handlers.push((url) => (url.pathname === '/api/tokens/tok-1' ? ok(current) : undefined));
    renderAt('/visit/token/tok-1');

    expect(await screen.findByText('You are in the queue')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(fakeSocket.emitted).toContainEqual(['join:token', { tokenId: 'tok-1' }, expect.any(Function)]);
    expect(screen.getByTestId('live-indicator')).toHaveTextContent('Live');

    // ADR-075: a position update is applied from the event itself — no read.
    const readsBefore = () => calls.filter((c) => c.path === '/api/tokens/tok-1').length;
    let reads = readsBefore();
    await act(async () =>
      fire('token.position_changed', {
        tokenId: 'tok-1',
        data: { position: 1, estimatedWaitMinutes: 4, estimatedReadyAt: null, etaUnavailableReason: null },
      }),
    );
    expect(await screen.findByText('1')).toBeInTheDocument();
    expect(readsBefore()).toBe(reads);

    // A lifecycle event carries the full customer view: shown as is, no read.
    current = { ...TOKEN, status: 'CALLED', position: null, counter: { id: 'c1', name: 'Desk 3' } };
    reads = readsBefore();
    await act(async () => fire('token.called', { tokenId: 'tok-1', data: current }));
    expect(await screen.findByText('It’s your turn')).toBeInTheDocument();
    expect(screen.getByText('Desk 3')).toBeInTheDocument();
    expect(readsBefore()).toBe(reads);

    // A drop and reconnect re-reads the truth rather than trusting old state.
    await act(async () => fire('disconnect'));
    expect(screen.getByTestId('live-indicator')).toHaveTextContent('Reconnecting…');
    current = { ...current, status: 'IN_PROGRESS' };
    const before = calls.filter((c) => c.path === '/api/tokens/tok-1').length;
    await act(async () => fire('connect'));
    expect(await screen.findByText('You are being served')).toBeInTheDocument();
    expect(calls.filter((c) => c.path === '/api/tokens/tok-1').length).toBeGreaterThan(before);
  });

  it.each([
    ['SKIPPED', 'Your token was skipped'],
    ['COMPLETED', 'Your visit is complete'],
    ['CANCELLED', 'You left the queue'],
  ])('%s is shown as final, without notifications or leave', async (status, text) => {
    handlers.push((url) => (url.pathname === '/api/tokens/tok-1' ? ok({ ...TOKEN, status }) : undefined));
    renderAt('/visit/token/tok-1');
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Notifications' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Leave queue' })).not.toBeInTheDocument();
  });

  it('shows the service-start code to its own browser when called', async () => {
    handlers.push((url) => {
      if (url.pathname === '/api/tokens/tok-1')
        return ok({ ...TOKEN, status: 'CALLED', serviceStartVerificationRequired: true, counter: { id: 'c', name: 'Desk 1' } });
      if (url.pathname === '/api/tokens/tok-1/verification-code') return ok({ code: '482913', expiresAt: null });
      return undefined;
    });
    renderAt('/visit/token/tok-1');
    expect(await screen.findByTestId('service-code')).toHaveTextContent('482913');
    const read = calls.find((c) => c.path.startsWith('/api/tokens/tok-1/verification-code'))!;
    expect(read.path).toContain(`deviceIdentifier=${localStorage.getItem('livequeue.portal.browserInstallationId')}`);
  });

  it('leaving asks first, then cancels with this browser’s installation id', async () => {
    let current: Record<string, unknown> = { ...TOKEN };
    handlers.push((url, init) => {
      if (url.pathname === '/api/tokens/tok-1/cancel' && init.method === 'POST') {
        current = { ...TOKEN, status: 'CANCELLED' };
        return ok(current);
      }
      if (url.pathname === '/api/tokens/tok-1') return ok(current);
      return undefined;
    });
    renderAt('/visit/token/tok-1');
    await userEvent.click(await screen.findByRole('button', { name: 'Leave queue' }));
    expect(screen.getByText(/Your place will be given up/)).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Leave queue' }).at(-1)!);
    expect(await screen.findByText('You left the queue')).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/api/tokens/tok-1/cancel')!.body).toEqual({
      deviceIdentifier: localStorage.getItem('livequeue.portal.browserInstallationId'),
    });
  });
});

describe('ordered journey (ADR-070)', () => {
  const MULTI = {
    ...CONFIG,
    allowMultipleServices: true,
    formFields: [],
    services: [
      { id: 's1', serviceName: 'Triage', description: null, durationMinutes: 10, maxOccurrencesPerJourney: 2 },
      { id: 's2', serviceName: 'Dressing', description: null, durationMinutes: 5, maxOccurrencesPerJourney: 1 },
    ],
    recommendedJourney: ['s2', 's1'],
  };

  function steps() {
    return within(screen.getByRole('list', { name: 'Steps in order' }))
      .getAllByRole('listitem')
      .map((li) => li.textContent?.replace(/[↑↓✕]/g, '').trim());
  }

  it('starts from the recommended order, lets the person rearrange it, and sends that order', async () => {
    handlers.push((url, init) => {
      if (url.pathname === '/api/public/queues/q-em/config') return ok(MULTI);
      if (url.pathname === '/api/tokens' && init.method === 'POST') return ok(TOKEN, 201);
      if (url.pathname === '/api/tokens/tok-1') return ok(TOKEN);
      return undefined;
    });
    renderAt('/visit/abc123def456/q/q-em');
    await screen.findByRole('heading', { name: 'Emergency' });
    expect(steps()).toEqual(['1Step 1: Dressing', '2Step 2: Triage']);

    // Keyboard reorder: focus Triage's handle and press ↑.
    screen.getByRole('button', { name: /Reorder step 2, Triage/ }).focus();
    await userEvent.keyboard('{ArrowUp}');
    expect(steps()).toEqual(['1Step 1: Triage', '2Step 2: Dressing']);

    // Triage may come back once more (not right after itself); Dressing may not.
    expect(screen.getByRole('button', { name: /Add Dressing/ })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /Add Triage/ }));
    expect(steps()).toEqual(['1Step 1: Triage', '2Step 2: Dressing', '3Step 3: Triage']);

    await userEvent.click(screen.getByRole('button', { name: 'Join queue' }));
    await screen.findByTestId('serial');
    const post = calls.find((c) => c.method === 'POST' && c.path === '/api/tokens')!;
    expect((post.body as { serviceIds: string[] }).serviceIds).toEqual(['s1', 's2', 's1']);
  });

  it('will not join with the same service twice in a row', async () => {
    handlers.push((url) => (url.pathname === '/api/public/queues/q-em/config' ? ok({ ...MULTI, recommendedJourney: [] }) : undefined));
    renderAt('/visit/abc123def456/q/q-em');
    await screen.findByRole('heading', { name: 'Emergency' });
    await userEvent.click(screen.getByRole('button', { name: /Add Triage/ }));
    // Right after Triage, Triage cannot be added again.
    expect(screen.getByRole('button', { name: /Add Triage/ })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /Add Dressing/ }));
    await userEvent.click(screen.getByRole('button', { name: /Add Triage/ }));
    // Removing the middle step brings the two Triage steps together.
    await userEvent.click(screen.getByRole('button', { name: 'Remove step 2, Dressing' }));
    expect(screen.getByRole('alert')).toHaveTextContent("Triage can't be two steps in a row.");
    expect(screen.getByRole('button', { name: 'Join queue' })).toBeDisabled();
  });

  it('after joining shows the journey read-only: current and next step, and no way to change it', async () => {
    const journey = {
      totalSteps: 2,
      currentStepNumber: 2,
      current: { stepNumber: 2, serviceId: 's2', serviceName: 'Dressing', status: 'PENDING', counter: null },
      next: null,
      referredTo: { id: 'c2', name: 'Desk 2' },
      steps: [
        { stepNumber: 1, serviceId: 's1', serviceName: 'Triage', status: 'COMPLETED', counter: { id: 'c1', name: 'Desk 1' } },
        { stepNumber: 2, serviceId: 's2', serviceName: 'Dressing', status: 'PENDING', counter: null },
      ],
    };
    handlers.push((url) => (url.pathname === '/api/tokens/tok-1' ? ok({ ...TOKEN, journey }) : undefined));
    renderAt('/visit/token/tok-1');
    expect(await screen.findByText('Step 2 of 2')).toBeInTheDocument();
    expect(screen.getByText('You have been referred to Desk 2 for this step.')).toBeInTheDocument();
    const progress = screen.getByRole('region', { name: 'Your service steps' });
    expect(within(progress).getByText(/Done · Desk 1/)).toBeInTheDocument();
    expect(within(progress).queryAllByRole('button')).toHaveLength(0);
  });

  it('a visit cancelled because its queue was deleted shows the reason to that person', async () => {
    handlers.push((url) =>
      url.pathname === '/api/tokens/tok-1'
        ? ok({ ...TOKEN, status: 'CANCELLED', queueRemoved: { reason: 'Clinic closed for renovation.' } })
        : undefined,
    );
    renderAt('/visit/token/tok-1');
    expect(await screen.findByText('Your place was cancelled')).toBeInTheDocument();
    expect(screen.getByText(/Reason: Clinic closed for renovation\./)).toBeInTheDocument();
  });
});

describe('one service or many, whatever the config says (ADR-071 D1)', () => {
  it('a config with the retired false, or without the field, still offers an ordered multi-service journey', async () => {
    for (const config of [{ ...CONFIG, allowMultipleServices: false, formFields: [] }, (() => {
      const { allowMultipleServices: _omit, ...rest } = { ...CONFIG, formFields: [] };
      void _omit;
      return rest;
    })()]) {
      handlers.length = 0;
      handlers.push((url) => (url.pathname === '/api/public/queues/q-em/config' ? ok(config) : undefined));
      const view = renderAt('/visit/abc123def456/q/q-em');
      expect(await screen.findByText('Your services, in order')).toBeInTheDocument();
      expect(screen.queryByRole('radio')).not.toBeInTheDocument();
      view.unmount();
    }
  });
});
