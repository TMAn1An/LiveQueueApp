import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueueBreadcrumb } from './QueueBreadcrumb';

function renderBreadcrumb(props: Parameters<typeof QueueBreadcrumb>[0]) {
  return render(
    <MemoryRouter>
      <QueueBreadcrumb {...props} />
    </MemoryRouter>,
  );
}

describe('QueueBreadcrumb', () => {
  it('without a section, the breadcrumb ends at the queue name', () => {
    renderBreadcrumb({
      queueId: 'q1',
      queueName: 'Pharmacy',
      backTo: '/queues',
      backLabel: 'Back to Queues',
    });

    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent(
      'Dashboard/Queues/Pharmacy',
    );
    // The terminal segment is the current page — not a link.
    expect(screen.queryByRole('link', { name: 'Pharmacy' })).not.toBeInTheDocument();
  });

  it('with a section, the queue name becomes a link back to its own settings, and the section is current', () => {
    renderBreadcrumb({
      queueId: 'q1',
      queueName: 'Pharmacy',
      section: 'Live Queue',
      backTo: '/queues',
      backLabel: 'Back to Queues',
    });

    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent(
      'Dashboard/Queues/Pharmacy/Live Queue',
    );
    expect(screen.getByRole('link', { name: 'Pharmacy' })).toHaveAttribute('href', '/queues/q1');
  });

  it('renders the explicit Back link pointed at whatever backTo the caller supplies', () => {
    renderBreadcrumb({
      queueId: 'q1',
      queueName: 'Pharmacy',
      section: 'Counters',
      backTo: '/queues/q1',
      backLabel: 'Back to Pharmacy',
    });

    const back = screen.getByRole('link', { name: '← Back to Pharmacy' });
    expect(back).toHaveAttribute('href', '/queues/q1');
  });
});
