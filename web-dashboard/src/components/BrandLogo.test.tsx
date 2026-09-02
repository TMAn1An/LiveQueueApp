import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrandLogo } from './BrandLogo';

const PUBLIC_DIR = path.resolve(__dirname, '../../public');

describe('BrandLogo', () => {
  it('renders the compact lockup by default, with an accessible name', () => {
    render(<BrandLogo />);

    expect(screen.getByAltText('LiveQueue')).toHaveAttribute('src', '/logo-horizontal.png');
  });

  it('renders the full lockup when asked', () => {
    render(<BrandLogo variant="full" />);

    expect(screen.getByAltText('LiveQueue')).toHaveAttribute('src', '/logo-full.png');
  });

  // A logo referenced but not shipped is a broken image in production, and
  // nothing else in the suite would notice.
  it.each(['logo-horizontal.png', 'logo-full.png'])('ships %s in public/', (file) => {
    expect(existsSync(path.join(PUBLIC_DIR, file))).toBe(true);
  });
});
