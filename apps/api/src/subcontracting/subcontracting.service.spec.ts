import { requiresSecondaryLength } from './subcontracting.service';

describe('requiresSecondaryLength', () => {
  it('does not request metres for a piece-to-piece outside process', () => {
    expect(requiresSecondaryLength('input-item', 'NUMBER', [
      { output_item_id: 'output-item', output_uom: 'NUMBER' },
    ])).toBe(false);
  });

  it('requests metres when weight-based rod stock becomes counted products', () => {
    expect(requiresSecondaryLength('raw-rod', 'KG', [
      { output_item_id: 'finished-part', output_uom: 'NUMBER' },
    ])).toBe(true);
  });

  it('does not request a second quantity for a same-material process', () => {
    expect(requiresSecondaryLength('part', 'KG', [
      { output_item_id: 'part', output_uom: 'NUMBER' },
    ])).toBe(false);
  });

  it('does not request metres for weight-to-weight processing', () => {
    expect(requiresSecondaryLength('input-powder', 'KG', [
      { output_item_id: 'output-powder', output_uom: 'KG' },
    ])).toBe(false);
  });
});
