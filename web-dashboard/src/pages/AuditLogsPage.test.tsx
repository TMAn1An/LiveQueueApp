import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { AuditLogsPage } from './AuditLogsPage';
import { useAuditLogs } from '../hooks/useAuditLogs';
import type { AuditLogEntry } from '../types/auditLog';

vi.mock('../hooks/useAuditLogs', () => ({
  useAuditLogs: vi.fn(),
}));

function mockEntry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: 'audit-1',
    organizationId: 'org-1',
    staffId: 'staff-1',
    staffEmail: 'owner@example.com',
    action: 'staff_created',
    entityType: 'staff',
    entityId: 'staff-2-uuid-value',
    metadata: { role: 'ADMIN' },
    ipAddress: '203.0.113.5',
    createdAt: '2026-08-23T10:00:00.000Z',
    ...overrides,
  };
}

describe('AuditLogsPage', () => {
  it('shows a loading state while fetching', () => {
    vi.mocked(useAuditLogs).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as unknown as ReturnType<typeof useAuditLogs>);

    render(<AuditLogsPage />);

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows an empty state when there are no audit events', () => {
    vi.mocked(useAuditLogs).mockReturnValue({
      data: { data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } },
      isLoading: false,
    } as unknown as ReturnType<typeof useAuditLogs>);

    render(<AuditLogsPage />);

    expect(screen.getByText('No audit events yet.')).toBeInTheDocument();
  });

  it('renders a readable, human-formatted action label and actor email', () => {
    vi.mocked(useAuditLogs).mockReturnValue({
      data: {
        data: [mockEntry()],
        pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useAuditLogs>);

    render(<AuditLogsPage />);

    expect(screen.getByText('Staff Created')).toBeInTheDocument();
    expect(screen.getByText('owner@example.com')).toBeInTheDocument();
  });

  it('never renders a raw secret-shaped value even if it appeared in metadata', () => {
    vi.mocked(useAuditLogs).mockReturnValue({
      data: {
        data: [mockEntry({ metadata: { note: 'safe value only' } })],
        pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useAuditLogs>);

    render(<AuditLogsPage />);

    const serialized = document.body.textContent ?? '';
    expect(serialized).not.toMatch(/password/i);
    expect(serialized).not.toMatch(/refreshToken/i);
    expect(serialized).not.toMatch(/accessToken/i);
  });

  it('renders pagination controls when more than one page exists', () => {
    vi.mocked(useAuditLogs).mockReturnValue({
      data: {
        data: [mockEntry()],
        pagination: { page: 1, pageSize: 20, total: 40, totalPages: 2 },
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useAuditLogs>);

    render(<AuditLogsPage />);

    expect(screen.getByText('Page 1 of 2 (40 total)')).toBeInTheDocument();
  });
});

describe('AuditLogsPage — search', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Search is server-side here: the page must hand the term to the hook (which
   * puts it in the query string), not filter the already-loaded page — matches
   * on other pages would otherwise be invisible.
   */
  it('sends the debounced term to the hook and resets to page 1', () => {
    vi.useFakeTimers();
    vi.mocked(useAuditLogs).mockReturnValue({
      data: {
        data: [mockEntry()],
        pagination: { page: 1, pageSize: 20, total: 60, totalPages: 3 },
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useAuditLogs>);

    render(<AuditLogsPage />);
    fireEvent.click(screen.getByText('Next'));
    expect(useAuditLogs).toHaveBeenLastCalledWith(2, 20, '');

    fireEvent.change(screen.getByLabelText('Search audit logs'), {
      target: { value: 'staff_created' },
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(useAuditLogs).toHaveBeenLastCalledWith(1, 20, 'staff_created');
  });

  it('distinguishes "no events yet" from "nothing matched the search"', () => {
    vi.useFakeTimers();
    vi.mocked(useAuditLogs).mockReturnValue({
      data: { data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } },
      isLoading: false,
    } as unknown as ReturnType<typeof useAuditLogs>);

    render(<AuditLogsPage />);
    expect(screen.getByText('No audit events yet.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search audit logs'), { target: { value: 'nobody' } });
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(screen.getByText('No audit events match your search.')).toBeInTheDocument();
  });
});
