import { beforeEach, describe, expect, it, vi } from 'vitest';

const staff = vi.hoisted(() => ({
  contactBelongsToAccountStaff: vi.fn(async () => false),
}));
const roundRobin = vi.hoisted(() => ({
  pickRoundRobinAgent: vi.fn(async () => 'agent-1'),
}));
const funnel = vi.hoisted(() => ({
  ensureInboundLeadInFunnel: vi.fn(async () => 'created'),
}));
const notify = vi.hoisted(() => ({
  notifyStaffViaWhatsApp: vi.fn(async () => 'notified assigned_agent'),
}));

vi.mock('@/lib/assignments/staff-contact', () => staff);
vi.mock('@/lib/assignments/round-robin', () => roundRobin);
vi.mock('@/lib/pipelines/inbound-deal', () => funnel);
vi.mock('@/lib/automations/staff-notify', () => ({
  DEFAULT_STAFF_ALERT_TEXT: 'Nuevo lead',
  notifyStaffViaWhatsApp: notify.notifyStaffViaWhatsApp,
}));

import { distributeInboundContact } from './distribute-inbound-contact';

function dbFor(opts: {
  assignedTo?: string | null;
  roundRobin?: boolean;
}) {
  const updates: string[] = [];
  const db = {
    updates,
    from(table: string) {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      chain.select = self;
      chain.eq = self;
      chain.update = () => {
        updates.push(table);
        return chain;
      };
      chain.maybeSingle = async () => {
        if (table === 'contacts') {
          return { data: { assigned_to: opts.assignedTo ?? null }, error: null };
        }
        if (table === 'accounts') {
          return {
            data: { round_robin_enabled: opts.roundRobin ?? true },
            error: null,
          };
        }
        return { data: null, error: null };
      };
      return chain;
    },
  };
  return db;
}

const base = {
  accountId: 'acc',
  contactId: 'contact-1',
  actorUserId: 'owner-1',
};

describe('distributeInboundContact', () => {
  beforeEach(() => {
    staff.contactBelongsToAccountStaff.mockReset();
    staff.contactBelongsToAccountStaff.mockResolvedValue(false);
    roundRobin.pickRoundRobinAgent.mockReset();
    roundRobin.pickRoundRobinAgent.mockResolvedValue('agent-1');
    funnel.ensureInboundLeadInFunnel.mockClear();
    notify.notifyStaffViaWhatsApp.mockClear();
  });

  it('assigns a new sheet lead and WhatsApps that agent', async () => {
    const db = dbFor({});
    const result = await distributeInboundContact(db as never, {
      ...base,
      created: true,
    });

    expect(result).toBe('notified assigned_agent');
    expect(db.updates).toContain('contacts');
    expect(roundRobin.pickRoundRobinAgent).toHaveBeenCalledOnce();
    expect(funnel.ensureInboundLeadInFunnel).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ assignedAgentId: 'agent-1' }),
    );
    expect(notify.notifyStaffViaWhatsApp).toHaveBeenCalledWith(
      expect.objectContaining({
        assignedAgentId: 'agent-1',
        notifyAssigned: true,
        notifyOwner: false,
        messageText: 'Formulario de Facebook',
      }),
    );
  });

  it('does not WhatsApp again when the contact already has an agent', async () => {
    const result = await distributeInboundContact(
      dbFor({ assignedTo: 'agent-2' }) as never,
      { ...base, created: false },
    );
    expect(result).toBe('skipped: already assigned');
    expect(notify.notifyStaffViaWhatsApp).not.toHaveBeenCalled();
  });

  it('stays quiet when round-robin is off', async () => {
    const result = await distributeInboundContact(
      dbFor({ roundRobin: false }) as never,
      { ...base, created: true },
    );
    expect(result).toBe('skipped: round robin off');
    expect(roundRobin.pickRoundRobinAgent).not.toHaveBeenCalled();
    expect(notify.notifyStaffViaWhatsApp).not.toHaveBeenCalled();
  });

  it('does not treat a teammate number as a lead', async () => {
    staff.contactBelongsToAccountStaff.mockResolvedValue(true);
    const result = await distributeInboundContact(dbFor({}) as never, {
      ...base,
      created: true,
    });
    expect(result).toBe('skipped: staff phone');
    expect(notify.notifyStaffViaWhatsApp).not.toHaveBeenCalled();
  });
});
