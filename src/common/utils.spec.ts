import { csvCell, slugify } from './utils.js';

describe('csvCell', () => {
  it('quotes commas and quotes', () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
  });
  it('neutralises spreadsheet formulas', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
  });
  it('handles empty values', () => {
    expect(csvCell(null)).toBe('');
  });
});

describe('slugify', () => {
  it('makes url-safe slugs', () => {
    expect(slugify('#NOFILTER Active Enzyme Lotion')).toBe('nofilter-active-enzyme-lotion');
  });
});
