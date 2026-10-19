import { FixedClock, SystemClock } from './clock';

describe('Clock Port', () => {
  it('SystemClock returns current real date', () => {
    const clock = new SystemClock();
    const before = Date.now();
    const now = clock.now().getTime();
    const after = Date.now();

    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(after);
  });

  it('FixedClock returns configured fixed date and allows changing it', () => {
    const initial = new Date('2026-10-19T12:00:00.000Z');
    const clock = new FixedClock(initial);

    expect(clock.now()).toEqual(initial);

    const updated = new Date('2026-10-20T08:00:00.000Z');
    clock.setCurrentDate(updated);
    expect(clock.now()).toEqual(updated);
  });
});
