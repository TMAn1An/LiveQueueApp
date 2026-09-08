import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthLayout } from './AuthLayout';

function renderLayout(brand?: 'above' | 'inside') {
  return render(
    <MemoryRouter initialEntries={['/auth-child']}>
      <Routes>
        <Route element={brand ? <AuthLayout brand={brand} /> : <AuthLayout />}>
          <Route path="/auth-child" element={<p>Auth Child Content</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('AuthLayout branding', () => {
  it('shows the full lockup above the card by default, as sign-in and registration expect', () => {
    renderLayout();

    const logo = screen.getByAltText('LiveQueue');
    expect(logo).toHaveAttribute('src', '/logo-full.png');
    // The default placement doubles as the page heading: those pages have
    // no <h1> of their own.
    expect(logo.closest('h1')).not.toBeNull();
    expect(logo.parentElement).not.toContainElement(screen.getByText('Auth Child Content'));
  });

  it('moves the same single lockup inside the card when asked, without becoming a heading', () => {
    renderLayout('inside');

    const logo = screen.getByAltText('LiveQueue');
    expect(screen.getAllByAltText('LiveQueue')).toHaveLength(1);
    expect(logo.closest('h1')).toBeNull();

    const card = screen.getByText('Auth Child Content').parentElement;
    expect(card).toContainElement(logo);
  });
});
