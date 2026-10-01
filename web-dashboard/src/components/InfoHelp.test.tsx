import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InfoHelp } from './InfoHelp';
import { PageHeader } from './PageHeader';
import { SectionHeading } from './SectionHeading';
import { ErrorBanner } from './ErrorBanner';

const HELP = 'Configure when this queue accepts customers and how many people can join each session.';

function renderHelp() {
  render(
    <div>
      <h2>Schedule &amp; Capacity</h2>
      <InfoHelp label="Schedule & Capacity">{HELP}</InfoHelp>
      <button type="button">Elsewhere</button>
    </div>,
  );
  return {
    trigger: screen.getByRole('button', { name: 'More information about Schedule & Capacity' }),
    help: screen.getByRole('tooltip', { hidden: true }),
  };
}

describe('InfoHelp', () => {
  it('renders a labelled info trigger, with the explanation hidden until asked for', () => {
    const { trigger, help } = renderHelp();

    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveAttribute('type', 'button');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(help).toHaveTextContent(HELP);
    expect(help).not.toBeVisible();
  });

  it('describes the trigger with the explanation, so a screen reader reads it on focus even while hidden', () => {
    const { trigger, help } = renderHelp();

    expect(trigger).toHaveAttribute('aria-describedby', help.id);
    expect(trigger).toHaveAccessibleDescription(HELP);
    expect(help).not.toBeVisible();
  });

  it('opens on hover and closes when the pointer leaves', async () => {
    const user = userEvent.setup();
    const { trigger, help } = renderHelp();

    await user.hover(trigger);
    expect(help).toBeVisible();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    await user.unhover(trigger);
    expect(help).not.toBeVisible();
  });

  it('stays open while the pointer is over the explanation itself', async () => {
    const user = userEvent.setup();
    const { trigger, help } = renderHelp();

    await user.hover(trigger);
    await user.hover(help);

    expect(help).toBeVisible();
  });

  it('opens on keyboard focus and closes when focus moves on', async () => {
    const user = userEvent.setup();
    const { trigger, help } = renderHelp();

    await user.tab();
    expect(trigger).toHaveFocus();
    expect(help).toBeVisible();

    await user.tab();
    expect(trigger).not.toHaveFocus();
    expect(help).not.toBeVisible();
  });

  it('closes on Escape and leaves focus on the trigger', async () => {
    const user = userEvent.setup();
    const { trigger, help } = renderHelp();
    await user.tab();
    expect(help).toBeVisible();

    await user.keyboard('{Escape}');

    expect(help).not.toBeVisible();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('Escape also closes one that was opened by hover alone', async () => {
    const user = userEvent.setup();
    const { trigger, help } = renderHelp();
    await user.hover(trigger);
    expect(help).toBeVisible();

    await user.keyboard('{Escape}');

    expect(help).not.toBeVisible();
  });

  describe('tap / click (no hover involved)', () => {
    // A touch tap produces no mouseenter: only focus and click reach the button.
    function tap(element: HTMLElement) {
      fireEvent.pointerDown(element, { pointerType: 'touch' });
      element.focus();
      fireEvent.click(element);
    }

    it('opens on a tap and stays open', () => {
      const { trigger, help } = renderHelp();

      tap(trigger);

      expect(help).toBeVisible();
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
    });

    it('closes on a second tap', () => {
      const { trigger, help } = renderHelp();

      tap(trigger);
      tap(trigger);

      expect(help).not.toBeVisible();
    });

    it('closes on a tap anywhere outside it', () => {
      const { trigger, help } = renderHelp();
      tap(trigger);
      expect(help).toBeVisible();

      fireEvent.pointerDown(document.body, { pointerType: 'touch' });

      expect(help).not.toBeVisible();
    });

    it('does not close on a tap inside the explanation', () => {
      const { trigger, help } = renderHelp();
      tap(trigger);

      fireEvent.pointerDown(help, { pointerType: 'touch' });

      expect(help).toBeVisible();
    });

    it('a click keeps it open after the pointer leaves, until it is dismissed', async () => {
      const user = userEvent.setup();
      const { trigger, help } = renderHelp();

      await user.click(trigger);
      await user.unhover(trigger);
      expect(help).toBeVisible();

      await user.keyboard('{Escape}');
      expect(help).not.toBeVisible();
    });
  });

  it('activates from the keyboard like any button (Enter keeps it open)', async () => {
    const user = userEvent.setup();
    const { trigger, help } = renderHelp();
    await user.tab();
    expect(trigger).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(help).toBeVisible();

    await user.keyboard('{Enter}');
    expect(help).not.toBeVisible();
  });

  it('is laid out against the viewport, so opening it cannot shift the page', async () => {
    const user = userEvent.setup();
    const { trigger, help } = renderHelp();

    await user.hover(trigger);

    expect(help.className).toContain('fixed');
    expect(help.style.top).not.toBe('');
    expect(help.style.left).not.toBe('');
    // Never wider than the viewport allows, with a margin on both sides.
    expect(parseFloat(help.style.width)).toBeLessThanOrEqual(300);
  });

  it('does not rely on a native title attribute', () => {
    const { trigger } = renderHelp();

    expect(trigger).not.toHaveAttribute('title');
  });
});

describe('SectionHeading', () => {
  it('shows the title, and keeps the explanation behind the info trigger instead of under it', () => {
    render(<SectionHeading title="Repeat Visits" help="Limit how often the same customer may rejoin." />);

    expect(screen.getByRole('heading', { level: 2, name: 'Repeat Visits' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'More information about Repeat Visits' })).toBeInTheDocument();
    expect(screen.getByText('Limit how often the same customer may rejoin.')).not.toBeVisible();
  });

  it('keeps the heading itself plain text — only the icon is interactive', () => {
    render(<SectionHeading title="Repeat Visits" help="Help." />);

    const heading = screen.getByRole('heading', { name: 'Repeat Visits' });
    expect(heading.closest('button')).toBeNull();
    expect(heading.querySelector('button')).toBeNull();
  });

  it('renders no trigger when there is nothing to explain', () => {
    render(<SectionHeading title="Services" />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders its actions and the requested heading level', () => {
    render(<SectionHeading level={3} title="Change Password" actions={<button type="button">Edit</button>} />);

    expect(screen.getByRole('heading', { level: 3, name: 'Change Password' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeVisible();
  });
});

describe('PageHeader', () => {
  it('moves the page description behind an info trigger named after the page', () => {
    render(<PageHeader title="Reports" description="Analyze throughput and wait times." />);

    expect(screen.getByRole('heading', { level: 1, name: 'Reports' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'More information about Reports' })).toBeInTheDocument();
    expect(screen.getByText('Analyze throughput and wait times.')).not.toBeVisible();
  });

  it('uses helpLabel when the title would read oddly', () => {
    render(<PageHeader title="Good evening, Jane" description="What needs attention today." helpLabel="this overview" />);

    expect(screen.getByRole('button', { name: 'More information about this overview' })).toBeInTheDocument();
  });

  it('renders no trigger without a description, and still renders actions', () => {
    render(<PageHeader title="Staff" actions={<button type="button">Invite</button>} />);

    expect(screen.queryByRole('button', { name: /More information/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Invite' })).toBeVisible();
  });
});

describe('what must stay on the page', () => {
  it('an error next to a heading with help stays visible — help never swallows it', () => {
    render(
      <section>
        <SectionHeading title="Schedule & Availability" help="Limit when customers can join." />
        <ErrorBanner message="Overlaps the 09:00–17:00 session." />
        <p role="status">Saved.</p>
      </section>,
    );

    expect(screen.getByText('Limit when customers can join.')).not.toBeVisible();
    expect(screen.getByText('Overlaps the 09:00–17:00 session.')).toBeVisible();
    expect(screen.getByText('Saved.')).toBeVisible();
  });
});
