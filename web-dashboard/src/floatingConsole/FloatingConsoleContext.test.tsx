import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FloatingConsoleProvider } from './FloatingConsoleContext';
import { useFloatingConsole } from './useFloatingConsole';
import { isDocumentPipSupported } from './documentPip';

/**
 * ADR-072: the console's host — Document Picture-in-Picture where the
 * browser has it, an in-page dock where it does not. The console itself is
 * stubbed here (it has its own tests); this is about the window lifecycle.
 */
vi.mock('./FloatingCounterConsole', () => ({
  FloatingCounterConsole: ({ surface, onClose }: { surface: string; onClose: () => void }) => (
    <div data-testid="console" data-surface={surface}>
      <button type="button" onClick={onClose}>
        Close console
      </button>
    </div>
  ),
}));

/** A separate document with its own window, like a real PiP window. */
function separateDocument(): Document {
  const frame = document.createElement('iframe');
  frame.setAttribute('data-test-frame', '');
  document.body.appendChild(frame);
  return frame.contentDocument!;
}

class FakePipWindow extends EventTarget {
  document = separateDocument();
  closed = false;
  focus = vi.fn();
  close = vi.fn(() => {
    if (this.closed) return;
    this.closed = true;
    this.dispatchEvent(new Event('pagehide'));
  });
}

let windows: FakePipWindow[] = [];
const requestWindow = vi.fn(async () => {
  const win = new FakePipWindow();
  windows.push(win);
  return win as unknown as Window;
});

function installPip() {
  Object.defineProperty(window, 'documentPictureInPicture', {
    configurable: true,
    value: {
      requestWindow,
      get window() {
        const open = windows.find((w) => !w.closed);
        return (open as unknown as Window) ?? null;
      },
    },
  });
}

function removePip() {
  delete (window as unknown as { documentPictureInPicture?: unknown }).documentPictureInPicture;
}

function Opener() {
  const fc = useFloatingConsole()!;
  return (
    <>
      <button type="button" onClick={fc.open}>
        Open floating console
      </button>
      <span data-testid="surface">{fc.surface ?? 'closed'}</span>
    </>
  );
}

function setup() {
  return render(
    <FloatingConsoleProvider>
      <Opener />
    </FloatingConsoleProvider>,
  );
}

beforeEach(() => {
  windows = [];
  requestWindow.mockClear();
  document.documentElement.classList.remove('dark');
});

afterEach(() => {
  removePip();
  document.head.querySelectorAll('[data-test-style]').forEach((n) => n.remove());
  document.querySelectorAll('[data-test-frame]').forEach((n) => n.remove());
});

describe('feature detection', () => {
  it('detects Document Picture-in-Picture by the API, not the user agent', () => {
    removePip();
    expect(isDocumentPipSupported()).toBe(false);
    installPip();
    expect(isDocumentPipSupported()).toBe(true);
  });
});

describe('Document Picture-in-Picture host', () => {
  it('opens a small PiP window from the click and renders the console inside it', async () => {
    installPip();
    const style = document.createElement('style');
    style.setAttribute('data-test-style', '');
    style.textContent = '.x{color:red}';
    document.head.appendChild(style);
    document.documentElement.classList.add('dark');

    setup();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Open floating console' }));

    expect(requestWindow).toHaveBeenCalledTimes(1);
    expect(requestWindow).toHaveBeenCalledWith({ width: 340, height: 300 });
    const pipDoc = windows[0].document;
    expect(within(pipDoc.body).getByTestId('console')).toHaveAttribute('data-surface', 'pip');
    // Not in the dashboard's own document.
    expect(screen.queryByTestId('console')).not.toBeInTheDocument();
    // Styles and theme follow the dashboard.
    expect(pipDoc.head.textContent).toContain('.x{color:red}');
    expect(pipDoc.documentElement.classList.contains('dark')).toBe(true);
    act(() => document.documentElement.classList.remove('dark'));
    await act(async () => undefined);
    expect(pipDoc.documentElement.classList.contains('dark')).toBe(false);
  });

  it('opening again focuses the open window instead of making another', async () => {
    installPip();
    setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Open floating console' }));
    await user.click(screen.getByRole('button', { name: 'Open floating console' }));
    expect(requestWindow).toHaveBeenCalledTimes(1);
    expect(windows[0].focus).toHaveBeenCalled();
  });

  it('closing from the console closes the window; it can be reopened', async () => {
    installPip();
    setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Open floating console' }));
    await user.click(within(windows[0].document.body).getByRole('button', { name: 'Close console' }));
    expect(windows[0].close).toHaveBeenCalled();
    expect(screen.getByTestId('surface')).toHaveTextContent('closed');
    expect(windows[0].document.body.textContent).toBe('');

    await user.click(screen.getByRole('button', { name: 'Open floating console' }));
    expect(requestWindow).toHaveBeenCalledTimes(2);
    expect(within(windows[1].document.body).getByTestId('console')).toBeInTheDocument();
  });

  it('the person closing the PiP window themselves cleans up', async () => {
    installPip();
    setup();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Open floating console' }));
    const removeSpy = vi.spyOn(windows[0], 'removeEventListener');
    act(() => windows[0].close());
    expect(screen.getByTestId('surface')).toHaveTextContent('closed');
    expect(removeSpy).toHaveBeenCalledWith('pagehide', expect.any(Function));
    expect(windows[0].document.body.textContent).toBe('');
  });

  it('signing out (the layout unmounting) closes the window', async () => {
    installPip();
    const { unmount } = setup();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Open floating console' }));
    unmount();
    expect(windows[0].close).toHaveBeenCalled();
    expect(windows[0].closed).toBe(true);
  });

  it('if the browser refuses the window, the console opens on the page instead', async () => {
    installPip();
    requestWindow.mockRejectedValueOnce(new Error('NotAllowedError'));
    setup();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Open floating console' }));
    expect(await screen.findByTestId('floating-console-dock')).toBeInTheDocument();
    expect(screen.getByText(/could not be opened/)).toBeInTheDocument();
  });
});

describe('fallback without Document Picture-in-Picture', () => {
  it('docks the console on the page and says it is not always-on-top', async () => {
    removePip();
    setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Open floating console' }));
    const dock = screen.getByTestId('floating-console-dock');
    expect(within(dock).getByTestId('console')).toHaveAttribute('data-surface', 'dock');
    expect(dock).toHaveTextContent('can’t keep the console on top of other windows');

    // Only one, however often it is opened.
    await user.click(screen.getByRole('button', { name: 'Open floating console' }));
    expect(screen.getAllByTestId('console')).toHaveLength(1);

    await user.click(within(dock).getByRole('button', { name: 'Close console' }));
    expect(screen.queryByTestId('floating-console-dock')).not.toBeInTheDocument();
  });
});
