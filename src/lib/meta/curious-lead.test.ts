import { describe, expect, it } from 'vitest';

import { isCuriousLeadAnswer, rowHasCuriousAnswer } from './curious-lead';

describe('isCuriousLeadAnswer', () => {
  it('catches the tour form answer that is only looking', () => {
    expect(isCuriousLeadAnswer('Solo quiero conocer el proyecto')).toBe(true);
    expect(isCuriousLeadAnswer('SOLO QUIERO CONOCER')).toBe(true);
    expect(isCuriousLeadAnswer('Solo información')).toBe(true);
  });

  it('leaves buyers and people with a down payment alone', () => {
    expect(isCuriousLeadAnswer('Tengo la inicial de 8000')).toBe(false);
    expect(isCuriousLeadAnswer('Quiero separar ese mismo día')).toBe(false);
    expect(isCuriousLeadAnswer('')).toBe(false);
  });
});

describe('rowHasCuriousAnswer', () => {
  it('looks through the form answers, not only the core columns', () => {
    expect(
      rowHasCuriousAnswer({
        extras: { cuentas_con_la_inicial: 'Solo quiero conocer el proyecto' },
      }),
    ).toBe(true);
  });
});
