import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { OnboardingTutorial } from './OnboardingTutorial';
import * as organizationApi from '../api/organization.api';

vi.mock('../api/organization.api');

function renderTutorial() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <OnboardingTutorial />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('OnboardingTutorial', () => {
  it('opens on the welcome step, identifying it as step 1 of 11', () => {
    renderTutorial();

    expect(screen.getByText('Welcome to LiveQueue')).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 11')).toBeInTheDocument();
    // Back makes no sense on the first step.
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
  });

  it('Next advances the step, and Back returns to the previous one', async () => {
    const user = userEvent.setup();
    renderTutorial();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Create your first queue')).toBeInTheDocument();
    expect(screen.getByText('Step 2 of 11')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Welcome to LiveQueue')).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 11')).toBeInTheDocument();
  });

  it('reaches the final step after clicking Next ten times, offering Finish instead of Next', async () => {
    const user = userEvent.setup();
    renderTutorial();

    for (let i = 0; i < 10; i++) {
      await user.click(screen.getByRole('button', { name: 'Next' }));
    }

    expect(screen.getByText('Step 11 of 11')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Finish' })).toBeInTheDocument();
  });

  it('Skip tutorial completes onboarding and closes the guide immediately', async () => {
    const complete = vi.mocked(organizationApi.completeOnboarding);
    complete.mockResolvedValue({ data: { onboardingCompletedAt: '2026-01-01T00:00:00.000Z' } } as never);
    const user = userEvent.setup();
    renderTutorial();

    await user.click(screen.getByRole('button', { name: 'Skip tutorial' }));

    expect(screen.queryByRole('region', { name: 'LiveQueue setup guide' })).not.toBeInTheDocument();
    expect(complete).toHaveBeenCalled();
  });

  it('Finish on the last step completes onboarding the same way as Skip', async () => {
    const complete = vi.mocked(organizationApi.completeOnboarding);
    complete.mockResolvedValue({ data: { onboardingCompletedAt: '2026-01-01T00:00:00.000Z' } } as never);
    const user = userEvent.setup();
    renderTutorial();

    for (let i = 0; i < 10; i++) {
      await user.click(screen.getByRole('button', { name: 'Next' }));
    }
    await user.click(screen.getByRole('button', { name: 'Finish' }));

    expect(screen.queryByRole('region', { name: 'LiveQueue setup guide' })).not.toBeInTheDocument();
    expect(complete).toHaveBeenCalled();
  });

  it('the ✕ dismiss button also completes onboarding, matching Skip', async () => {
    const complete = vi.mocked(organizationApi.completeOnboarding);
    complete.mockResolvedValue({ data: { onboardingCompletedAt: '2026-01-01T00:00:00.000Z' } } as never);
    const user = userEvent.setup();
    renderTutorial();

    await user.click(screen.getByLabelText('Dismiss setup guide'));

    expect(complete).toHaveBeenCalled();
  });

  it('a step with a contextual link navigates without closing the guide', async () => {
    const user = userEvent.setup();
    renderTutorial();

    await user.click(screen.getByRole('button', { name: 'Next' })); // step 2: Create your first queue
    expect(screen.getByRole('button', { name: 'Go to Queues' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Go to Queues' }));

    // Still open — navigating is contextual help, not an exit.
    expect(screen.getByRole('region', { name: 'LiveQueue setup guide' })).toBeInTheDocument();
  });
});
