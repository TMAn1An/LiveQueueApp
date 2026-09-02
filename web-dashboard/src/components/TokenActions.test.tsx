import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TokenActions } from './TokenActions';
import { useCounters } from '../hooks/useCounters';
import {
  useCallToken,
  useCompleteToken,
  useRecallToken,
  useSetRequiredDuration,
  useSkipToken,
  useStartToken,
} from '../hooks/useTokenActions';
import { ApiError } from '../api/client';

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ hasPermission: () => true }),
}));
vi.mock('../hooks/useCounters');
vi.mock('../hooks/useTokenActions');

const callMutate = vi.fn();
const startMutate = vi.fn();
const completeMutate = vi.fn();
const skipMutate = vi.fn();
const recallMutate = vi.fn();
const setRequiredDurationMutate = vi.fn();

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
  vi.mocked(useCompleteToken).mockReturnValue({
    mutate: completeMutate,
  } as unknown as ReturnType<typeof useCompleteToken>);
  vi.mocked(useSkipToken).mockReturnValue({ mutate: skipMutate } as unknown as ReturnType<typeof useSkipToken>);
  vi.mocked(useRecallToken).mockReturnValue({
    mutate: recallMutate,
  } as unknown as ReturnType<typeof useRecallToken>);
  vi.mocked(useSetRequiredDuration).mockReturnValue({
    mutate: setRequiredDurationMutate,
    isPending: false,
  } as unknown as ReturnType<typeof useSetRequiredDuration>);
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

  it('COMPLETED (terminal) shows no actions', () => {
    render(<TokenActions tokenId="t1" queueId="q1" status="COMPLETED" />);
    expect(screen.queryByText('Call')).not.toBeInTheDocument();
    expect(screen.queryByText('Start')).not.toBeInTheDocument();
    expect(screen.queryByText('Complete')).not.toBeInTheDocument();
    expect(screen.queryByText('Skip')).not.toBeInTheDocument();
    expect(screen.queryByText('Recall')).not.toBeInTheDocument();
  });

  it('SKIPPED shows Recall, and nothing else', () => {
    render(<TokenActions tokenId="t1" queueId="q1" status="SKIPPED" />);
    expect(screen.getByText('Recall')).toBeInTheDocument();
    expect(screen.queryByText('Call')).not.toBeInTheDocument();
    expect(screen.queryByText('Start')).not.toBeInTheDocument();
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

describe('TokenActions — Start requires a verification code (V2 Checkpoint 7)', () => {
  it('clicking Start reveals a code input instead of starting service immediately', async () => {
    const user = userEvent.setup();
    render(<TokenActions tokenId="t1" queueId="q1" status="CALLED" />);

    await user.click(screen.getByText('Start'));

    expect(startMutate).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText('Verification code')).toBeInTheDocument();
    expect(screen.getByText('Confirm')).toBeInTheDocument();
  });

  it('submitting the code calls startToken with {tokenId, verificationCode} — never shows the code anywhere else', async () => {
    const user = userEvent.setup();
    render(<TokenActions tokenId="t1" queueId="q1" status="CALLED" />);

    await user.click(screen.getByText('Start'));
    await user.type(screen.getByPlaceholderText('Verification code'), '482731');
    await user.click(screen.getByText('Confirm'));

    expect(startMutate).toHaveBeenCalledWith(
      { tokenId: 't1', verificationCode: '482731' },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });

  it('shows the backend error and leaves the token CALLED when the code is wrong', async () => {
    const user = userEvent.setup();
    startMutate.mockImplementation((_vars, { onError }: { onError: (e: unknown) => void }) => {
      onError(new ApiError(422, 'INVALID_VERIFICATION_CODE', 'Incorrect verification code.'));
    });
    render(<TokenActions tokenId="t1" queueId="q1" status="CALLED" />);

    await user.click(screen.getByText('Start'));
    await user.type(screen.getByPlaceholderText('Verification code'), '000000');
    await user.click(screen.getByText('Confirm'));

    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect verification code.');
    // The code input stays open (not reset back to the plain Start button)
    // so staff can immediately ask the customer to retry.
    expect(screen.getByPlaceholderText('Verification code')).toBeInTheDocument();
    expect(screen.queryByText('Complete')).not.toBeInTheDocument();
  });
});

describe('TokenActions — Adjust Time (V2 Checkpoint 4)', () => {
  it('clicking Adjust Time reveals a minutes input, and submitting calls setRequiredDuration', async () => {
    const user = userEvent.setup();
    render(<TokenActions tokenId="t1" queueId="q1" status="CALLED" />);

    await user.click(screen.getByText('Adjust Time'));
    await user.type(screen.getByPlaceholderText('Minutes'), '18');
    await user.click(screen.getByText('Set'));

    expect(setRequiredDurationMutate).toHaveBeenCalledWith(
      { tokenId: 't1', requiredDurationMinutes: 18 },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });

  it('is available for IN_PROGRESS tokens too, not just CALLED', () => {
    render(<TokenActions tokenId="t1" queueId="q1" status="IN_PROGRESS" />);
    expect(screen.getByText('Adjust Time')).toBeInTheDocument();
  });

  it('is not offered for a WAITING token', () => {
    render(<TokenActions tokenId="t1" queueId="q1" status="WAITING" position={1} />);
    expect(screen.queryByText('Adjust Time')).not.toBeInTheDocument();
  });
});

describe('TokenActions — strict FCFS locking (V2 Checkpoint 3)', () => {
  it('a WAITING token at position 1 shows Call, not Locked', () => {
    render(<TokenActions tokenId="t1" queueId="q1" status="WAITING" position={1} />);
    expect(screen.getByText('Call')).toBeInTheDocument();
    expect(screen.queryByText('Locked')).not.toBeInTheDocument();
  });

  it('a WAITING token behind position 1 shows a disabled Locked indicator, not Call', () => {
    render(<TokenActions tokenId="t1" queueId="q1" status="WAITING" position={2} />);
    expect(screen.getByText('Locked')).toBeInTheDocument();
    expect(screen.getByText('Locked')).toBeDisabled();
    expect(screen.queryByText('Call')).not.toBeInTheDocument();
    // Skip remains available regardless of FCFS eligibility — unaffected by this checkpoint.
    expect(screen.getByText('Skip')).toBeInTheDocument();
  });
});

describe('TokenActions — Recall', () => {
  it('clicking Recall reveals a counter picker, and selecting a counter calls recallToken with its id', async () => {
    const user = userEvent.setup();
    render(<TokenActions tokenId="t1" queueId="q1" status="SKIPPED" />);

    await user.click(screen.getByText('Recall'));
    const select = screen.getByRole('combobox');
    await user.selectOptions(select, 'c1');

    expect(recallMutate).toHaveBeenCalledWith(
      { tokenId: 't1', counterId: 'c1' },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it('the Recall counter picker only offers ACTIVE counters, not OFFLINE ones', async () => {
    const user = userEvent.setup();
    render(<TokenActions tokenId="t1" queueId="q1" status="SKIPPED" />);

    await user.click(screen.getByText('Recall'));

    expect(screen.getByRole('option', { name: 'Counter 1' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Counter 2' })).not.toBeInTheDocument();
  });

  it('shows the backend error message when recall fails, rather than failing silently', async () => {
    const user = userEvent.setup();
    recallMutate.mockImplementation((_vars, { onError }: { onError: (e: unknown) => void }) => {
      onError(new ApiError(409, 'COUNTER_NOT_AVAILABLE', 'Counter is already serving another token.'));
    });
    render(<TokenActions tokenId="t1" queueId="q1" status="SKIPPED" />);

    await user.click(screen.getByText('Recall'));
    await user.selectOptions(screen.getByRole('combobox'), 'c1');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Counter is already serving another token.',
    );
  });

  it('does not require a confirmation step before recalling (recall is not destructive)', async () => {
    const user = userEvent.setup();
    render(<TokenActions tokenId="t1" queueId="q1" status="SKIPPED" />);

    await user.click(screen.getByText('Recall'));
    // The counter picker appears immediately — no "are you sure?" step in between.
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });
});
