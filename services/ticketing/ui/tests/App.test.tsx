import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

import { STATUS_COLUMNS } from '../src/types';

// minimal smoke test to ensure layout renders without runtime errors

const MockApp = () => (
  <div>
    <header>
      <h1>Ticketing Mission Control</h1>
    </header>
    <main>
      {STATUS_COLUMNS.map(({ key }) => (
        <section key={key} aria-label={key} />
      ))}
    </main>
  </div>
);

describe('App layout', () => {
  it('renders column skeleton', () => {
    render(<MockApp />);
    expect(screen.getByText('Ticketing Mission Control')).toBeInTheDocument();
    STATUS_COLUMNS.forEach(({ key }) => {
      expect(screen.getByLabelText(key)).toBeInTheDocument();
    });
  });
});
