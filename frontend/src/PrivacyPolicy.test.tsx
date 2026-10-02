import { render, screen } from '@testing-library/react';

import { PrivacyPolicy } from './PrivacyPolicy';

describe('PrivacyPolicy', () => {
  it('renders the public Google OAuth privacy policy content', () => {
    render(<PrivacyPolicy />);

    expect(
      screen.getByRole('heading', { name: 'TaskCalendar Privacy Policy' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'TaskCalendar accesses Google Calendar data only for the purpose of synchronizing calendar events for the authenticated user.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Google user data is not sold or shared with third parties.'),
    ).toBeInTheDocument();
    expect(screen.getByText('October 2026')).toBeInTheDocument();
  });
});
