import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from './StatusBadge';

describe('StatusBadge', () => {
  it('renders the status text with underscores replaced by spaces', () => {
    render(<StatusBadge status="IN_PROGRESS" />);
    expect(screen.getByText('IN PROGRESS')).toBeInTheDocument();
  });

  it('falls back to a neutral style for an unrecognized status rather than crashing', () => {
    render(<StatusBadge status="SOME_FUTURE_STATUS" />);
    expect(screen.getByText('SOME FUTURE STATUS')).toBeInTheDocument();
  });
});
