import Papa from 'papaparse';
import { describe, expect, it } from 'vitest';
import { csvBytes, csvField, toCsv } from './csv';

describe('csv', () => {
  it('quotes only when needed and ends every row with CRLF', () => {
    expect(toCsv([['a', 'b'], ['c', 'd']])).toBe('a,b\r\nc,d\r\n');
    expect(toCsv([['x,y', 'say "hi"', 'two\nlines', 'cr\rhere', '']])).toBe('"x,y","say ""hi""","two\nlines","cr\rhere",\r\n');
    expect(toCsv([])).toBe('');
    expect(toCsv([[]])).toBe('\r\n');
  });

  it('writes numbers, booleans and empty values', () => {
    expect(toCsv([[1, -2.5, 0, true, false, null, undefined, NaN, Infinity]])).toBe('1,-2.5,0,true,false,,,,\r\n');
  });

  it('guards text that a spreadsheet would run as a formula', () => {
    expect(csvField('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(csvField('+351 912')).toBe("'+351 912");
    expect(csvField('-ok')).toBe("'-ok");
    expect(csvField('@sum')).toBe("'@sum");
    expect(csvField('\tTab')).toBe("'\tTab");
    expect(csvField(-5)).toBe('-5');
    expect(csvField('=1+1', { guardFormulas: false })).toBe('=1+1');
    expect(csvField('a = b')).toBe('a = b');
  });

  it('writes the comma as decimal mark with the semicolon delimiter of Portuguese and Spanish spreadsheets', () => {
    expect(toCsv([['Código', 'Kappa', '%'], ['Pertença', 0.857, 85.71], ['n', 12, -0.5]], { delimiter: ';' })).toBe('Código;Kappa;%\r\nPertença;0,857;85,71\r\nn;12;-0,5\r\n');
    expect(toCsv([[0.857]], { delimiter: ',' })).toBe('0.857\r\n');
    expect(toCsv([[0.857]], { delimiter: ';', decimal: '.' })).toBe('0.857\r\n');
    expect(toCsv([[0.5, 'a.b']], { delimiter: '\t', decimal: ',' })).toBe('0,5\ta.b\r\n');
    // text that looks like a number is left as it is
    expect(toCsv([['1.5']], { delimiter: ';' })).toBe('1.5\r\n');
  });

  it('supports semicolon and tab delimiters', () => {
    expect(toCsv([['a;b', 'c,d']], { delimiter: ';' })).toBe('"a;b";c,d\r\n');
    expect(toCsv([['a\tb', 'c']], { delimiter: '\t' })).toBe('"a\tb"\tc\r\n');
  });

  it('adds a UTF-8 BOM for Excel unless asked not to', () => {
    const b = csvBytes([['ação', '😀']]);
    expect([...b.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(b.slice(3))).toBe('ação,😀\r\n');
    expect(csvBytes([['x']], { bom: false })[0]).toBe(0x78);
  });

  it('round-trips through a CSV parser, Unicode and large input included', () => {
    const rows = Array.from({ length: 5000 }, (_, i) => [`Segmento ${i}: "citação", com vírgulas;\nlinha 😀`, i, i % 2 === 0]);
    const csv = toCsv(rows, { guardFormulas: false });
    const parsed = Papa.parse<string[]>(csv, { newline: '\r\n', skipEmptyLines: true });
    expect(parsed.errors).toEqual([]);
    expect(parsed.data).toHaveLength(5000);
    expect(parsed.data[4321]).toEqual([`Segmento 4321: "citação", com vírgulas;\nlinha 😀`, '4321', 'false']);
  });
});
