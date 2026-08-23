import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TokenActions } from './TokenActions';
import { useCounters } from '../hooks/useCounters';
import { useCallToken, useCompleteToken, useSkipToken, useStartToken } from '../hooks/useTokenActions';

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ hasPermission: () => true }),
}));
vi.mock('../hooks/useCounters');
vi.mock('../hooks/useTokenActions');

const callMutate = vi.fn();
const startMutate = vi.fn();
const completeMutate = vi.fn();
const skipMutate = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useCounters).mockReturnValue({
    data: [
      { id: 'c1', queueId: 'q1', name: 'Counter 1', status: 'ACTIVE', staffId: null, createdAt: '', updatedAt: '' },
      { id: 'c2', queueId: 'q1', name: 'Counter 2', status: 'OFFLINE', staffId: null, createdAt: '', updatedAt: '' },
    ],
  } as unknown as ReturnType<typeof useCounters>);
  vi.mocked(useCallToken).mockReturnValue({ mutate: callMutate } as unknown as ReturnType<typeof useCallToken>);
  vi.mocked(useStartToken).mockReturnValue({ mutate: startMutate } as unknown as ReturnType<typeof useStartToken>);
  vi.mocked(useCompleteToken).mockReturnValue({ mutate: completeMutate } as unknown as ReturnType<typeof useCompleteToken>);
  vi.mocked(useSkipToken).mockReturnValue({ mutate: skipMutate } as unknown as ReturnType<typeof useSkipToken>);
});

describe('TokenActions — state-gated buttons (mirrors the backend state machine)', () => {
  it('WAITING shows Call and Skip, not Start or Complete', () => {
    render(<TokenActions tokenId="t1" queueId="q1" status="WAITING" />);
    expect(screen.getByText('Call')).toBeInTheDocument();
    expect(screen.getByText('Skip')).toBeInTheDocument();
    expect(screen.queryByText('Start')).not.toBeInTheDocument();
    expect(screen.queryByText('Complete')).not.toBeInTheDocument();
  });

  it('CALLED shows Start and Skip, not Call or Complete', () => {
    render(<TokenActions tokenId="t1" queueId="q1" status="CALLED" />);
    expect(screen.getByText('Start')).toBeInTheDocument();
    expect(screen.getByText('Skip')).toBeInTheDocument();
    expect(screen.queryByText('Call')).not.toBeInTheDocument();
    expect(screen.queryByText('Complete')).not.toBeInTheDocument();
  });

  it('IN_PROGRESS shows Complete and Skip, not Call or Start', () => {
    render(<TokenActions tokenId="t1" queueId="q1" status="IN_PROGRESS" />);
    expect(screen.getByText('Complete')).toBeInTheDocument();
    expect(screen.getByText('Skip')).toBeInTheDocument();
    expect(screen.queryByText('Call')).not.toBeInTheDocument();
    expect(screen.queryByText('Start')).not.toBeInTheDocument();
  });

  it('COMPLETED and SKIPPED (terminal) show no actions', () => {
    const { rerender } = render(<TokenActions tokenId="t1" queueId="q1" status="COMPLETED" />);
    expect(screen.queryByText('Call')).not.toBeInTheDocument();
    expect(screen.queryByText('Skip')).not.toBeInTheDocument();

    rerender(<TokenActions tokenId="t1" queueId="q1" status="SKIPPED" />);
    expect(screen.queryByText('Complete')).not.toBeInTheDocument();
    expect(screen.queryByText('Skip')).not.toBeInTheDocument();
  });

  it('clicking Call reveals a counter picker, and selecting a counter calls callToken with its id', async () => {
    const user = userEvent.setup();
    render(<TokenActions tokenId="t1" queueId="q1" status="WAITING" />);

    await user.click(screen.getByText('Call'));
    const select = screen.getByRole('combobox');
    await user.selectOptions(select, 'c1');

    expect(callMutate).toHaveBeenCalledWith({ tokenId: 't1', counterId: 'c1' });
  });

  it('the counter picker only offers ACTIVE counters, not OFFLINE ones', async () => {
    const user = userEvent.setup();
    render(<TokenActions tokenId="t1" queueId="q1" status="WAITING" />);

    await user.click(screen.getByText('Call'));

    expect(screen.getByRole('option', { name: 'Counter 1' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Counter 2' })).not.toBeInTheDocument();
  });

  it('clicking Skip calls skipToken directly with the token id', async () => {
    const user = userEvent.setup();
    render(<TokenActions tokenId="t1" queueId="q1" status="CALLED" />);

    await user.click(screen.getByText('Skip'));

    expect(skipMutate).toHaveBeenCalledWith('t1');
  });
});
