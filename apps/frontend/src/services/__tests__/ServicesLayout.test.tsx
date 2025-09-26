import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import ServicesLayout from '../ServicesLayout';

function renderWithRouter(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
          <Route path="/services" element={<ServicesLayout />}>
            <Route index element={<div>Redirect</div>} />
            <Route path="overview" element={<div>Overview content</div>} />
            <Route path="timestore" element={<div>Timestore content</div>} />
            <Route path="filestore" element={<div>Filestore content</div>} />
            <Route path="metastore" element={<div>Metastore content</div>} />
          </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('ServicesLayout', () => {
  it('renders secondary navigation with active highlighting', () => {
    renderWithRouter('/services/overview');
    const nav = screen.getByRole('navigation', { name: /service sections/i });
    expect(nav).toBeInTheDocument();

    const tabs = screen.getAllByRole('link');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Overview', 'Timestore', 'Filestore', 'Metastore']);

    const overviewLink = screen.getByRole('link', { name: 'Overview' });
    expect(overviewLink).toHaveAttribute('aria-current', 'page');
  });

  it('focuses the heading when switching between tabs', async () => {
    renderWithRouter('/services/overview');
    const heading = screen.getByRole('heading', { name: 'Service Control Hub' });
    await waitFor(() => {
      expect(heading).toHaveFocus();
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('link', { name: 'Filestore' }));

    await waitFor(() => {
      expect(heading).toHaveFocus();
    });
    expect(screen.getByText('Filestore content')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Filestore' })).toHaveAttribute('aria-current', 'page');
  });
});
