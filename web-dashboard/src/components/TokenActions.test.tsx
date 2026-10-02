import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TokenActions } from './TokenActions';
import { useMyCounter } from '../hooks/useCounters';
import {
  useCompleteToken,
  useSetRequiredDuration,
  useSkipToken,
  useStartToken,
} from '../hooks/useTokenActions';
import { ApiError } from '../api/client';

// ADR-064: OWNER/ADMIN (manage_staff) supervise every counter; STAFF act
// only at their own. Tests default to a supervisor and switch per test.
let supervises = true;
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    hasPermission: (permission: string) => permission !== 'manage_staff' || supervises,
  }),
}));
vi.mock('../hooks/useCounters');
vi.mock('../hooks/useTokenActions');

const startMutate = vi.fn();
const completeMutate = vi.fn();
const skipMutate = vi.fn();
const setRequiredDurationMutate = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  supervises = true;
  vi.mocked(useMyCounter).mockReturnValue({ data: null } as unknown as ReturnType<typeof useMyCounter>);
  vi.mocked(useStartToken).mockReturnValue({ mutate: startMutate } as unknown as ReturnType<typeof useStartToken>);
  vi.mocked(useCompleteToken).mockReturnValue({
    mutate: completeMutate,
  } as unknown as ReturnType<typeof useCompleteToken>);
  vi.mocked(useSkipToken).mockReturnValue({ mutate: skipMutate } as unknown as ReturnType<typeof useSkipToken>);
  vi.mocked(useSetRequiredDuration).mockReturnValue({
    mutate: setRequiredDurationMutate,
    isPending: false,
  } as unknown as ReturnType<typeof useSetRequiredDuration>);
});

describe('TokenActions — state-gated buttons (mirrors the backend state machine)', () => {
  it('WAITING shows Skip, not Start or Complete — and no per-row Call (ADR-064)', () => {
    render(<TokenActions tokenId="t1" queueId="q1" status="WAITING" />);
    expect(screen.queryByText('Call')).not.toBeInTheDocument();
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
  });

  // V2 UX + Token Lifecycle checkpoint, Part B: Recall removed — SKIPPED is
  // now terminal, same as COMPLETED. There is no action a staff member can
  // take on a skipped token any more.
  it('SKIPPED (terminal) shows no actions', () => {
    render(<TokenActions tokenId="t1" queueId="q1" status="SKIPPED" />);
    expect(screen.queryByText('Recall')).not.toBeInTheDocument();
    expect(screen.queryByText('Call')).not.toBeInTheDocument();
    expect(screen.queryByText('Start')).not.toBeInTheDocument();
    expect(screen.queryByText('Complete')).not.toBeInTheDocument();
    expect(screen.queryByText('Skip')).not.toBeInTheDocument();
  });

  it('offers no way to pick a counter or a staff member for a person (ADR-064)', () => {
    render(
      <TokenActions
        tokenId="t1"
        queueId="q1"
        status="WAITING"
        position={1}
        actionEligibility={{ eligible: true, reason: null }}
      />,
    );
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByText(/select counter/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/assign/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Call' })).not.toBeInTheDocument();
  });

  it('clicking Skip asks for a reason instead of skipping (ADR-042)', async () => {
    const user = userEvent.setup();
    render(<TokenActions tokenId="t1" queueId="q1" status="CALLED" />);

    await user.click(screen.getByText('Skip'));

    expect(skipMutate).not.toHaveBeenCalled();
    expect(screen.getByText('Skip person')).toBeInTheDocument();
    expect(screen.getByLabelText('Reason')).toBeInTheDocument();
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

describe('TokenActions — queue without the service-start code (ADR-041)', () => {
  it('Start begins service in one click, sends no code, and shows no code input', async () => {
    const user = userEvent.setup();
    render(<TokenActions tokenId="t1" queueId="q1" status="CALLED" requiresVerificationCode={false} />);

    expect(screen.queryByPlaceholderText('Verification code')).not.toBeInTheDocument();
    await user.click(screen.getByText('Start'));

    expect(startMutate).toHaveBeenCalledWith({ tokenId: 't1' }, expect.objectContaining({ onError: expect.any(Function) }));
    expect(screen.queryByPlaceholderText('Verification code')).not.toBeInTheDocument();
    expect(screen.queryByText('Confirm')).not.toBeInTheDocument();
  });

  it('shows the backend refusal if the setting was switched back on meanwhile', async () => {
    const user = userEvent.setup();
    startMutate.mockImplementation((_vars, { onError }: { onError: (e: unknown) => void }) => {
      onError(
        new ApiError(
          422,
          'SERVICE_START_VERIFICATION_REQUIRED',
          "This queue requires the customer's verification code to start service.",
        ),
      );
    });
    render(<TokenActions tokenId="t1" queueId="q1" status="CALLED" requiresVerificationCode={false} />);

    await user.click(screen.getByText('Start'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "This queue requires the customer's verification code to start service.",
    );
  });

  it('a queue that requires the code still asks for it', async () => {
    const user = userEvent.setup();
    render(<TokenActions tokenId="t1" queueId="q1" status="CALLED" requiresVerificationCode />);

    await user.click(screen.getByText('Start'));

    expect(startMutate).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText('Verification code')).toBeInTheDocument();
  });
});

describe('TokenActions — Skip requires a reason (ADR-042)', () => {
  async function openSkip() {
    const user = userEvent.setup();
    render(<TokenActions tokenId="t1" queueId="q1" status="CALLED" />);
    await user.click(screen.getByText('Skip'));
    return user;
  }
  const confirmSkip = () =>
    within(screen.getByRole('dialog', { name: 'Skip person' })).getByRole('button', { name: 'Skip' });

  it('uses neutral "person" wording, with the reason codes unchanged', async () => {
    await openSkip();
    expect(
      screen.getByText(
        'The person will see this reason. Skipping ends their visit; they would need to scan the queue QR code again.',
      ),
    ).toBeInTheDocument();
    const values = screen.getAllByRole('option').map((o) => (o as HTMLOptionElement).value).filter(Boolean);
    expect(values).toEqual(['CUSTOMER_NOT_PRESENT', 'NO_RESPONSE', 'MISSING_REQUIREMENT', 'CUSTOMER_LEFT', 'OTHER']);
    expect(screen.queryByText(/customer/i)).not.toBeInTheDocument();
  });

  it('offers the predefined reasons and keeps Skip disabled until one is chosen', async () => {
    await openSkip();
    for (const label of [
      'Person not present',
      'No response from person',
      'Required document/information missing',
      'Person requested to leave',
      'Other',
    ]) {
      expect(screen.getByRole('option', { name: label })).toBeInTheDocument();
    }
    expect(confirmSkip()).toBeDisabled();
  });

  it('a predefined reason skips with its code and no text', async () => {
    const user = await openSkip();
    await user.selectOptions(screen.getByLabelText('Reason'), 'NO_RESPONSE');
    expect(screen.queryByLabelText('Describe the reason')).not.toBeInTheDocument();
    await user.click(confirmSkip());

    expect(skipMutate).toHaveBeenCalledWith(
      { tokenId: 't1', reasonCode: 'NO_RESPONSE', reasonText: undefined },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });

  it('Other reveals a text field and requires real text before Skip is allowed', async () => {
    const user = await openSkip();
    await user.selectOptions(screen.getByLabelText('Reason'), 'OTHER');

    const text = screen.getByLabelText('Describe the reason');
    expect(screen.getByText('Required when the reason is Other.')).toBeInTheDocument();
    expect(confirmSkip()).toBeDisabled();

    await user.type(text, '   ');
    expect(confirmSkip()).toBeDisabled();

    await user.type(text, 'Wrong queue, sent to Billing  ');
    expect(confirmSkip()).toBeEnabled();
    await user.click(confirmSkip());

    expect(skipMutate).toHaveBeenCalledWith(
      { tokenId: 't1', reasonCode: 'OTHER', reasonText: 'Wrong queue, sent to Billing' },
      expect.anything(),
    );
  });

  it('Cancel closes the dialog and changes nothing', async () => {
    const user = await openSkip();
    await user.selectOptions(screen.getByLabelText('Reason'), 'CUSTOMER_LEFT');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(skipMutate).not.toHaveBeenCalled();
    expect(screen.queryByText('Skip person')).not.toBeInTheDocument();
  });

  it('shows a backend refusal in the dialog and keeps it open', async () => {
    skipMutate.mockImplementation((_vars, { onError }: { onError: (e: unknown) => void }) => {
      onError(new ApiError(422, 'INVALID_TOKEN_TRANSITION', 'Cannot transition token from COMPLETED to SKIPPED.'));
    });
    const user = await openSkip();
    await user.selectOptions(screen.getByLabelText('Reason'), 'CUSTOMER_NOT_PRESENT');
    await user.click(confirmSkip());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Cannot transition token from COMPLETED to SKIPPED.',
    );
    expect(screen.getByText('Skip person')).toBeInTheDocument();
  });

  it('says so plainly when the server could not be reached', async () => {
    skipMutate.mockImplementation((_vars, { onError }: { onError: (e: unknown) => void }) => {
      onError(new TypeError('Failed to fetch'));
    });
    const user = await openSkip();
    await user.selectOptions(screen.getByLabelText('Reason'), 'CUSTOMER_NOT_PRESENT');
    await user.click(confirmSkip());

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server.');
  });

  it('closes once the skip succeeds', async () => {
    skipMutate.mockImplementation((_vars, { onSuccess }: { onSuccess: () => void }) => onSuccess());
    const user = await openSkip();
    await user.selectOptions(screen.getByLabelText('Reason'), 'CUSTOMER_NOT_PRESENT');
    await user.click(confirmSkip());

    expect(screen.queryByText('Skip person')).not.toBeInTheDocument();
  });
});

describe('TokenActions — Complete stays one click; feedback is optional (ADR-042)', () => {
  it('Complete completes immediately, with no dialog and no feedback', async () => {
    const user = userEvent.setup();
    render(<TokenActions tokenId="t1" queueId="q1" status="IN_PROGRESS" />);

    await user.click(screen.getByText('Complete'));

    expect(completeMutate).toHaveBeenCalledWith({ tokenId: 't1' }, expect.anything());
    expect(screen.queryByText('Complete with feedback')).not.toBeInTheDocument();
  });

  it('a failed one-click Complete is shown, not swallowed', async () => {
    completeMutate.mockImplementation((_vars, { onError }: { onError: (e: unknown) => void }) => {
      onError(new ApiError(409, 'TOKEN_STATE_CHANGED', 'Token state changed concurrently. Please retry.'));
    });
    const user = userEvent.setup();
    render(<TokenActions tokenId="t1" queueId="q1" status="IN_PROGRESS" />);

    await user.click(screen.getByText('Complete'));

    expect(await screen.findByRole('alert')).toHaveTextContent('Token state changed concurrently.');
  });

  it('only an IN_PROGRESS row offers Feedback', () => {
    render(<TokenActions tokenId="t1" queueId="q1" status="CALLED" />);
    expect(screen.queryByText('Feedback')).not.toBeInTheDocument();
  });

  it('Feedback opens a note, and completing sends it', async () => {
    const user = userEvent.setup();
    render(<TokenActions tokenId="t1" queueId="q1" status="IN_PROGRESS" />);

    await user.click(screen.getByText('Feedback'));
    expect(completeMutate).not.toHaveBeenCalled();
    await user.type(
      screen.getByLabelText('Feedback for the customer (optional)'),
      '  Please bring the original document next time.  ',
    );
    await user.click(
      within(screen.getByRole('dialog', { name: 'Complete with feedback' })).getByRole('button', {
        name: 'Complete',
      }),
    );

    expect(completeMutate).toHaveBeenCalledWith(
      { tokenId: 't1', feedback: 'Please bring the original document next time.' },
      expect.anything(),
    );
  });

  it('completing from the feedback dialog with nothing typed is an ordinary completion', async () => {
    const user = userEvent.setup();
    render(<TokenActions tokenId="t1" queueId="q1" status="IN_PROGRESS" />);

    await user.click(screen.getByText('Feedback'));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Complete with feedback' })).getByRole('button', {
        name: 'Complete',
      }),
    );

    expect(completeMutate).toHaveBeenCalledWith({ tokenId: 't1', feedback: undefined }, expect.anything());
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
  it('a WAITING token at position 1 is not Locked', () => {
    render(<TokenActions tokenId="t1" queueId="q1" status="WAITING" position={1} />);
    expect(screen.getByText('Skip')).toBeInTheDocument();
    expect(screen.queryByText('Locked')).not.toBeInTheDocument();
  });

  it('a WAITING token behind position 1 shows a disabled Locked indicator, not Call', () => {
    render(<TokenActions tokenId="t1" queueId="q1" status="WAITING" position={2} />);
    expect(screen.getByText('Locked')).toBeInTheDocument();
    expect(screen.getByText('Locked')).toBeDisabled();
    expect(screen.queryByText('Call')).not.toBeInTheDocument();
    // Skip locks with Call: a customer who cannot be called yet must not be
    // removable from the queue ahead of their turn either.
    expect(screen.queryByText('Skip')).not.toBeInTheDocument();
  });
});

describe('TokenActions — Skip unlocks exactly with Call', () => {
  it('offers Skip on an eligible waiting row', () => {
    render(
      <TokenActions
        tokenId="t1"
        queueId="q1"
        status="WAITING"
        position={1}
        actionEligibility={{ eligible: true, reason: null }}
      />,
    );

    expect(screen.getByText('Skip')).toBeInTheDocument();
  });

  it('offers neither when no counter is free, and says so', () => {
    render(
      <TokenActions
        tokenId="t1"
        queueId="q1"
        status="WAITING"
        position={1}
        actionEligibility={{ eligible: false, reason: 'NO_AVAILABLE_COUNTER' }}
      />,
    );

    expect(screen.queryByText('Call')).not.toBeInTheDocument();
    expect(screen.queryByText('Skip')).not.toBeInTheDocument();
    expect(screen.getByText('Locked')).toHaveAttribute(
      'title',
      'Waiting for an available counter.',
    );
  });

  it('ADR-048: a row awaiting its assigned session reads "Scheduled", with neither Call nor Skip', () => {
    render(
      <TokenActions
        tokenId="t1"
        queueId="q1"
        status="WAITING"
        position={null}
        actionEligibility={{ eligible: false, reason: 'SESSION_NOT_STARTED' }}
      />,
    );

    expect(screen.queryByText('Call')).not.toBeInTheDocument();
    expect(screen.queryByText('Skip')).not.toBeInTheDocument();
    expect(screen.queryByText('Locked')).not.toBeInTheDocument();
    expect(screen.getByText('Scheduled')).toHaveAttribute(
      'title',
      "This customer's assigned session has not started yet.",
    );
  });

  it('explains a locked row caused by earlier customers differently', () => {
    render(
      <TokenActions
        tokenId="t1"
        queueId="q1"
        status="WAITING"
        position={3}
        actionEligibility={{ eligible: false, reason: 'EARLIER_WAITING' }}
      />,
    );

    expect(screen.getByText('Locked')).toHaveAttribute(
      'title',
      'Earlier customers must be handled first.',
    );
  });

  it('still allows skipping a customer already at a counter', () => {
    render(<TokenActions tokenId="t1" queueId="q1" status="CALLED" />);
    expect(screen.getByText('Skip')).toBeInTheDocument();
  });
});

describe('TokenActions — STAFF act only at their own counter (ADR-064)', () => {
  const ownCounter = { id: 'c1', name: 'Counter 1', status: 'ACTIVE', queueId: 'q1', queueName: 'Q' };

  it('shows no actions for a person being served at another counter', () => {
    supervises = false;
    vi.mocked(useMyCounter).mockReturnValue({ data: ownCounter } as unknown as ReturnType<typeof useMyCounter>);
    render(<TokenActions tokenId="t1" queueId="q1" status="IN_PROGRESS" counterId="c2" />);
    expect(screen.getByText('At another counter')).toBeInTheDocument();
    expect(screen.queryByText('Complete')).not.toBeInTheDocument();
    expect(screen.queryByText('Skip')).not.toBeInTheDocument();
    expect(screen.queryByText('Adjust Time')).not.toBeInTheDocument();
  });

  it('shows the actions for the person at their own counter', () => {
    supervises = false;
    vi.mocked(useMyCounter).mockReturnValue({ data: ownCounter } as unknown as ReturnType<typeof useMyCounter>);
    render(<TokenActions tokenId="t1" queueId="q1" status="IN_PROGRESS" counterId="c1" />);
    expect(screen.getByText('Complete')).toBeInTheDocument();
    expect(screen.getByText('Skip')).toBeInTheDocument();
  });

  it('an unassigned staff member gets no actions at all', () => {
    supervises = false;
    render(
      <TokenActions
        tokenId="t1"
        queueId="q1"
        status="WAITING"
        position={1}
        actionEligibility={{ eligible: true, reason: null }}
      />,
    );
    expect(screen.queryByText('Skip')).not.toBeInTheDocument();
  });

  it('owner and admin may resolve a person at any counter', () => {
    render(<TokenActions tokenId="t1" queueId="q1" status="CALLED" counterId="c9" />);
    expect(screen.queryByText('At another counter')).not.toBeInTheDocument();
    expect(screen.getByText('Skip')).toBeInTheDocument();
  });
});
