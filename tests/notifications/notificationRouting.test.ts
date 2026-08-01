import { getNotificationRoute } from '@/lib/notifications/notificationRouting';

describe('getNotificationRoute', () => {
  it('routes each category to its default destination when there is no data.route override', () => {
    expect(getNotificationRoute({ category: 'money', data: {} })).toBe('/profile/wallet');
    expect(getNotificationRoute({ category: 'votes', data: null })).toBe('/rules');
    expect(getNotificationRoute({ category: 'group_activity', data: {} })).toBe('/dashboard');
    expect(getNotificationRoute({ category: 'admin_actions', data: {} })).toBe('/dashboard');
    expect(getNotificationRoute({ category: 'reminders', data: {} })).toBe('/checkin');
  });

  it('returns null for an unrecognized/missing category', () => {
    expect(getNotificationRoute({ category: null, data: {} })).toBeNull();
  });

  it('achievements route to badges, carrying the achiever userId when present', () => {
    expect(getNotificationRoute({ category: 'achievements', data: { user_id: 'user-123' } })).toEqual({
      pathname: '/profile/badges',
      params: { userId: 'user-123' },
    });
    // No user_id (shouldn't normally happen, but must not crash) -> own badges.
    expect(getNotificationRoute({ category: 'achievements', data: {} })).toBe('/profile/badges');
  });

  it('data.route overrides take priority over the category default', () => {
    expect(getNotificationRoute({ category: 'admin_actions', data: { route: 'removed' } })).toBe('/group-select');
    expect(getNotificationRoute({ category: 'group_activity', data: { route: 'leave' } })).toBe('/rules');
    expect(getNotificationRoute({ category: 'group_activity', data: { route: 'new_member' } })).toBe(
      '/profile/admin-members'
    );
  });

  it('admin_review disambiguates by category (reused across money and votes)', () => {
    expect(getNotificationRoute({ category: 'money', data: { route: 'admin_review' } })).toBe(
      '/profile/admin-transactions'
    );
    expect(getNotificationRoute({ category: 'votes', data: { route: 'admin_review' } })).toBe(
      '/profile/excuse-admin'
    );
  });
});
