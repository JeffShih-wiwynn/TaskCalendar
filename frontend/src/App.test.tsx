import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { App } from './App';

vi.mock('./api/tasks', () => ({
  listTasks: () => Promise.resolve([]),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  completeTask: vi.fn(),
  uncompleteTask: vi.fn(),
  mapTaskToEvent: vi.fn(),
}));

describe('App', () => {
  it('renders task views and hides the creation form by default', async () => {
    render(<App />);

    expect(await screen.findByRole('button', { name: 'Today' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create task' })).not.toBeInTheDocument();
  });
});
