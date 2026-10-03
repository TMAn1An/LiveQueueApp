import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { JourneyBuilder } from './JourneyBuilder';
import { JourneyProgress, type JourneyView } from './JourneyProgress';
import { canAppendStep, journeyProblems, moveStep } from './journeyRules';

const SERVICES = [
  { id: 'reg', name: 'Registration', maxOccurrencesPerJourney: 1 },
  { id: 'lab', name: 'Lab', maxOccurrencesPerJourney: 2 },
  { id: 'pay', name: 'Payment' }, // default limit: 2
];

describe('journeyRules (mirrors the backend)', () => {
  it('accepts an ordered journey whose repeats are not consecutive and within limits', () => {
    expect(journeyProblems(['reg', 'lab', 'pay', 'lab'], SERVICES)).toEqual([]);
  });

  it('refuses an empty journey unless explicitly allowed (the recommended order may be empty)', () => {
    expect(journeyProblems([], SERVICES).map((p) => p.code)).toEqual(['JOURNEY_EMPTY']);
    expect(journeyProblems([], SERVICES, { allowEmpty: true })).toEqual([]);
  });

  it('refuses the same service twice in a row, naming the step', () => {
    expect(journeyProblems(['lab', 'lab'], SERVICES)).toEqual([
      { code: 'JOURNEY_CONSECUTIVE_REPEAT', message: "Lab can't be two steps in a row.", stepNumber: 2 },
    ]);
  });

  it('enforces each service’s own limit, defaulting to 2', () => {
    expect(journeyProblems(['reg', 'lab', 'reg'], SERVICES).map((p) => p.message)).toEqual([
      'Registration can be chosen at most 1 time.',
    ]);
    expect(journeyProblems(['pay', 'lab', 'pay', 'reg', 'pay'], SERVICES).map((p) => p.message)).toEqual([
      'Payment can be chosen at most 2 times.',
    ]);
  });

  it('refuses more than 20 steps', () => {
    const many = Array.from({ length: 21 }, (_, i) => (i % 2 ? 'lab' : 'pay'));
    expect(journeyProblems(many, [{ id: 'lab', name: 'Lab', maxOccurrencesPerJourney: 30 }, { id: 'pay', name: 'Pay', maxOccurrencesPerJourney: 30 }]).map((p) => p.code)).toContain('JOURNEY_TOO_LONG');
  });

  it('canAppendStep and moveStep', () => {
    expect(canAppendStep(['lab'], 'lab', SERVICES)).toBe(false);
    expect(canAppendStep(['reg', 'lab'], 'reg', SERVICES)).toBe(false);
    expect(canAppendStep(['lab', 'pay'], 'lab', SERVICES)).toBe(true);
    expect(moveStep(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveStep(['a', 'b'], 0, 5)).toEqual(['a', 'b']);
  });
});

function Harness({ initial, onChange }: { initial: string[]; onChange?: (s: string[]) => void }) {
  const [steps, setSteps] = useState(initial);
  return (
    <JourneyBuilder
      services={SERVICES}
      steps={steps}
      onChange={(next) => {
        setSteps(next);
        onChange?.(next);
      }}
    />
  );
}

function order() {
  return within(screen.getByRole('list', { name: 'Steps in order' }))
    .getAllByRole('listitem')
    .map((li) => li.querySelector('.truncate')?.textContent?.replace(/^Step \d+: /, ''));
}

describe('JourneyBuilder', () => {
  it('numbers steps automatically and reorders with the keyboard, keeping focus on the moved step', async () => {
    render(<Harness initial={['reg', 'lab', 'pay']} />);
    const handle = screen.getByRole('button', { name: /Reorder step 3, Payment/ });
    handle.focus();
    await userEvent.keyboard('{ArrowUp}');
    expect(order()).toEqual(['Registration', 'Payment', 'Lab']);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(screen.getByRole('button', { name: /Reorder step 2, Payment/ })).toHaveFocus();
    expect(screen.getByText('Payment moved to step 2 of 3.')).toBeInTheDocument();
  });

  it('reorders with the Move up / Move down buttons', async () => {
    render(<Harness initial={['reg', 'lab']} />);
    await userEvent.click(screen.getByRole('button', { name: 'Move Registration down' }));
    expect(order()).toEqual(['Lab', 'Registration']);
    expect(screen.getByRole('button', { name: 'Move Lab up' })).toBeDisabled();
  });

  it.each(['mouse', 'touch'])('reorders by dragging the handle (%s pointer)', (pointerType) => {
    render(<Harness initial={['reg', 'lab', 'pay']} />);
    // Lay the three rows out 40px apart.
    screen.getAllByRole('listitem').forEach((li, i) => {
      vi.spyOn(li, 'getBoundingClientRect').mockReturnValue({ top: i * 40, height: 40, bottom: i * 40 + 40 } as DOMRect);
    });
    const handle = screen.getByRole('button', { name: /Reorder step 1, Registration/ });
    fireEvent.pointerDown(handle, { pointerId: 1, pointerType, clientY: 10 });
    fireEvent.pointerMove(handle, { pointerId: 1, pointerType, clientY: 110 });
    fireEvent.pointerUp(handle, { pointerId: 1, pointerType, clientY: 110 });
    expect(order()).toEqual(['Lab', 'Payment', 'Registration']);
    expect(screen.getByText('Registration is now step 3 of 3.')).toBeInTheDocument();
  });

  it('only offers additions that keep the journey valid', async () => {
    render(<Harness initial={['reg']} />);
    // Registration: limit 1 and it is the last step.
    expect(screen.getByRole('button', { name: /Add Registration/ })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /Add Lab/ }));
    expect(screen.getByRole('button', { name: /Add Lab/ })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /Add Payment/ }));
    expect(screen.getByRole('button', { name: /Add Lab/ })).toBeEnabled();
  });

  it('flags a step that breaks a rule after a move', async () => {
    render(<Harness initial={['lab', 'pay', 'lab']} />);
    await userEvent.click(screen.getByRole('button', { name: 'Move Payment up' }));
    expect(order()).toEqual(['Payment', 'Lab', 'Lab']);
    expect(screen.getByRole('alert')).toHaveTextContent("Lab can't be two steps in a row.");
    expect(screen.getAllByRole('listitem')[2]).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('JourneyProgress (after the token exists)', () => {
  const journey: JourneyView = {
    totalSteps: 3,
    currentStepNumber: 2,
    current: { stepNumber: 2, serviceId: 'lab', serviceName: 'Lab', status: 'CALLED', counter: { id: 'c2', name: 'Lab Desk' } },
    next: { stepNumber: 3, serviceId: 'pay', serviceName: 'Payment', status: 'PENDING', counter: null },
    referredTo: null,
    steps: [
      { stepNumber: 1, serviceId: 'reg', serviceName: 'Registration', status: 'COMPLETED', counter: { id: 'c1', name: 'Front' } },
      { stepNumber: 2, serviceId: 'lab', serviceName: 'Lab', status: 'CALLED', counter: { id: 'c2', name: 'Lab Desk' } },
      { stepNumber: 3, serviceId: 'pay', serviceName: 'Payment', status: 'PENDING', counter: null },
    ],
  };

  it('shows the current and next step, marks the current one, and offers no controls', () => {
    render(<JourneyProgress journey={journey} />);
    expect(screen.getByText('Step 2 of 3')).toBeInTheDocument();
    expect(screen.getByText('Payment', { selector: 'span.font-medium' })).toBeInTheDocument();
    const items = screen.getAllByRole('listitem');
    expect(items[1]).toHaveAttribute('aria-current', 'step');
    expect(items[1]).toHaveTextContent('Called · Lab Desk');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
