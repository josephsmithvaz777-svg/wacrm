import { describe, expect, it } from 'vitest';

import { contactPhoneMatchesStaff } from './staff-contact';

describe('contactPhoneMatchesStaff', () => {
  const staff = ['+51 940 912 791', '51988824220'];

  it('matches an advisor number in another format', () => {
    expect(contactPhoneMatchesStaff('51940912791', staff)).toBe(true);
    expect(contactPhoneMatchesStaff('+51988824220', staff)).toBe(true);
  });

  it('does not treat a customer number as staff', () => {
    expect(contactPhoneMatchesStaff('51911111111', staff)).toBe(false);
  });

  it('matches a local mobile against the same number with country code', () => {
    expect(contactPhoneMatchesStaff('51940912791', ['940912791'])).toBe(true);
    expect(contactPhoneMatchesStaff('940912791', ['+51 940 912 791'])).toBe(true);
  });

  it('ignores empty contact or empty staff rows', () => {
    expect(contactPhoneMatchesStaff('', staff)).toBe(false);
    expect(contactPhoneMatchesStaff(null, staff)).toBe(false);
    expect(contactPhoneMatchesStaff('51940912791', [null, '  '])).toBe(false);
  });
});
