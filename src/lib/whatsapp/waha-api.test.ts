import { describe, expect, it } from 'vitest';
import { chatIdToPhone, phoneToChatId } from './waha-api';

describe('waha-api phone helpers', () => {
  it('phoneToChatId strips non-digits and appends @c.us', () => {
    expect(phoneToChatId('+1 (213) 213-2130')).toBe('12132132130@c.us');
  });

  it('chatIdToPhone extracts digits', () => {
    expect(chatIdToPhone('12132132130@c.us')).toBe('12132132130');
  });
});
