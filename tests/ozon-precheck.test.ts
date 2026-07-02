import { describe, expect, it } from 'vitest';
import { formatMissingFields } from '../apps/desktop/renderer/src/components/Results/ozonListing/precheck';

describe('ozon missing fields formatter', () => {
  it('deduplicates after normalizing display labels', () => {
    expect(formatMissingFields([
      'main_image_url',
      'primary_image',
      '主图',
      'weight_g',
      'weight',
      '重量',
    ])).toBe('主图、重量');
  });
});
