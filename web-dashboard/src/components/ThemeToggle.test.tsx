import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '../context/ThemeContext';
import { ThemeToggle } from './ThemeToggle';

const STORAGE_KEY = 'livequeue-theme';

function renderToggle() {
  return render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
});

afterEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
});

describe('theme toggle', () => {
  it('starts light and switches the document into dark mode on click', async () => {
    const user = userEvent.setup();
    renderToggle();

    expect(document.documentElement.classList.contains('dark')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Switch to dark mode' }));

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    // The label always describes what the next click will do.
    expect(screen.getByRole('button', { name: 'Switch to light mode' })).toBeInTheDocument();
  });

  it('switches back to light', async () => {
    const user = userEvent.setup();
    renderToggle();

    await user.click(screen.getByRole('button', { name: 'Switch to dark mode' }));
    await user.click(screen.getByRole('button', { name: 'Switch to light mode' }));

    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('remembers the choice for the next visit', async () => {
    const user = userEvent.setup();
    const { unmount } = renderToggle();

    await user.click(screen.getByRole('button', { name: 'Switch to dark mode' }));
    expect(localStorage.getItem(STORAGE_KEY)).toBe('dark');

    // A fresh mount is what a page reload looks like from the app's side.
    unmount();
    document.documentElement.classList.remove('dark');
    renderToggle();

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(screen.getByRole('button', { name: 'Switch to light mode' })).toBeInTheDocument();
  });

  it('falls back to light when nothing is saved and the OS expresses no preference', () => {
    renderToggle();

    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(screen.getByRole('button', { name: 'Switch to dark mode' })).toBeInTheDocument();
  });
});
