import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { ErrorBanner } from './ErrorBanner';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ErrorBanner', () => {
  it('renders nothing when there is no message', () => {
    render(<ErrorBanner message={null} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the message immediately', () => {
    render(<ErrorBanner message="Something went wrong." />);
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong.');
  });

  it('auto-dismisses after 15 seconds', () => {
    render(<ErrorBanner message="This staff member is already assigned to another counter." />);
    expect(screen.getByRole('alert')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(15_000);
    });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not dismiss before 15 seconds have elapsed', () => {
    render(<ErrorBanner message="Failed to create counter." />);

    act(() => {
      vi.advanceTimersByTime(14_999);
    });

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('restarts the timer when a new error message replaces an old one', () => {
    const { rerender } = render(<ErrorBanner message="First error." />);

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();

    rerender(<ErrorBanner message="Second error." />);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    // 10s into the *second* message's own timer — still well under 15s, so it must still be visible.
    expect(screen.getByRole('alert')).toHaveTextContent('Second error.');
  });
});
