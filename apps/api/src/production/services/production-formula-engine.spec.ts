import { evaluateProductionFormula, roundProductionFormula } from './production-formula-engine';

describe('production formula engine', () => {
  it('evaluates governed arithmetic and functions', () => {
    expect(evaluateProductionFormula('ceil(width_mm * height_mm / sheet_area)', {
      width_mm: 600, height_mm: 400, sheet_area: 100000,
    })).toBe(3);
  });
  it('rejects unknown inputs and division by zero', () => {
    expect(() => evaluateProductionFormula('qty * missing', { qty: 2 })).toThrow("Missing input 'missing'");
    expect(() => evaluateProductionFormula('qty / zero', { qty: 2, zero: 0 })).toThrow('Division by zero');
  });
  it('applies explicit rounding rules', () => {
    expect(roundProductionFormula(1.231, 'UP', 2)).toBe(1.24);
    expect(roundProductionFormula(1.239, 'DOWN', 2)).toBe(1.23);
  });
});
