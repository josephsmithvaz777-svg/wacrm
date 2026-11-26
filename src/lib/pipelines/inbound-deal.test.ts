import { describe, expect, it } from 'vitest';

import {
  dealTitleForContact,
  pickNewLeadStageId,
  profileIdForAssignee,
  resolveInboundDealAction,
} from './inbound-deal';

describe('pickNewLeadStageId', () => {
  it('picks the lowest position (New Lead)', () => {
    expect(
      pickNewLeadStageId([
        { id: 'qual', position: 1 },
        { id: 'new', position: 0 },
        { id: 'won', position: 4 },
      ]),
    ).toBe('new');
  });

  it('returns null when the pipeline has no stages', () => {
    expect(pickNewLeadStageId([])).toBeNull();
  });
});

describe('dealTitleForContact', () => {
  it('prefers the contact name', () => {
    expect(dealTitleForContact({ name: 'Ana', phone: '51999' })).toBe('Ana');
  });

  it('falls back to phone then Lead', () => {
    expect(dealTitleForContact({ name: '  ', phone: '51999' })).toBe('51999');
    expect(dealTitleForContact({})).toBe('Lead');
  });
});

describe('profileIdForAssignee', () => {
  const rows = [{ id: 'profile-1', user_id: 'user-1' }];

  it('keeps a profiles.id', () => {
    expect(profileIdForAssignee(rows, 'profile-1')).toBe('profile-1');
  });

  it('maps an auth user id to the profile id', () => {
    expect(profileIdForAssignee(rows, 'user-1')).toBe('profile-1');
  });

  it('returns null when the id is not a profile', () => {
    expect(profileIdForAssignee(rows, 'missing')).toBeNull();
    expect(profileIdForAssignee(rows, null)).toBeNull();
  });
});

describe('resolveInboundDealAction', () => {
  it('creates when the contact has no open deal', () => {
    expect(
      resolveInboundDealAction({ openDeal: null, newLeadStageId: 'new' }),
    ).toBe('create');
  });

  it('leaves a deal already in New Lead', () => {
    expect(
      resolveInboundDealAction({
        openDeal: { id: 'd1', stage_id: 'new' },
        newLeadStageId: 'new',
      }),
    ).toBe('unchanged');
  });

  it('moves a deal that left New Lead back there', () => {
    expect(
      resolveInboundDealAction({
        openDeal: { id: 'd1', stage_id: 'qual' },
        newLeadStageId: 'new',
      }),
    ).toBe('move');
  });
});
