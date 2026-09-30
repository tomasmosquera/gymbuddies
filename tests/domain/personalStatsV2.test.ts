import { percentileAmong } from '@/lib/domain/personalStatsV2';

describe('percentileAmong', () => {
  it('is 100 when beating everyone else', () => {
    expect(percentileAmong(10, [1, 2, 3])).toBe(100);
  });

  it('is 0 when beating nobody', () => {
    expect(percentileAmong(1, [5, 10])).toBe(0);
  });

  it('is null with no comparable others', () => {
    expect(percentileAmong(10, [])).toBeNull();
    expect(percentileAmong(10, [null])).toBeNull();
  });

  it('is null when my own value is null', () => {
    expect(percentileAmong(null, [1, 2])).toBeNull();
  });
});
