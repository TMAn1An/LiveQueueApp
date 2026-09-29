import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

function Bomb(): never {
  throw new Error('boom');
}

describe('ErrorBoundary', () => {
  it('shows a safe generic message instead of unmounting to a blank page', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.queryByText(/boom/)).not.toBeInTheDocument();
  });

  it('renders children normally when nothing throws', () => {
    render(
      <ErrorBoundary>
        <div>Fine</div>
      </ErrorBoundary>,
    );

    expect(screen.getByText('Fine')).toBeInTheDocument();
  });
});
