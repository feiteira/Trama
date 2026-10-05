import { describe, expect, it } from 'vitest';
import {
  cleanName,
  excerpt,
  extFor,
  formatDateTime,
  GuidMap,
  isGuid,
  mimeOf,
  normColor,
  normGuid,
  parseDateTime,
  splitCodeDescription,
  toDecimal,
} from './common';
import { attr, child, children, descendants, localName, parseXml, stripInvalidXmlChars, textOf, xmlAttr, xmlText, XmlParseError, XmlWriter } from './xml';

describe('XmlWriter', () => {
  it('escapes text and attributes and self-closes empty elements', () => {
    const x = new XmlWriter();
    x.declaration();
    x.open('Root', { name: 'A & B <"q"> \'s', skip: undefined, none: null, n: 3, b: false });
    x.leaf('Empty');
    x.leaf('Text', {}, 'x < y & z > w');
    x.close();
    const s = x.toString();
    expect(s).toContain('<Root name="A &amp; B &lt;&quot;q&quot;&gt; &apos;s" n="3" b="false">');
    expect(s).toContain('<Empty/>');
    expect(s).toContain('<Text>x &lt; y &amp; z &gt; w</Text>');
    expect(s.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<Root')).toBe(true);
  });

  it('round-trips through the parser, including line breaks in attributes and CR in text', () => {
    const x = new XmlWriter('');
    x.open('R', { a: 'line1\nline2\ttab' });
    x.leaf('T', {}, 'one\r\ntwo\rthree 😀');
    x.close();
    const root = parseXml(x.toString());
    expect(attr(root, 'a')).toBe('line1\nline2\ttab');
    expect(textOf(child(root, 'T'))).toBe('one\r\ntwo\rthree 😀');
  });

  it('drops characters XML 1.0 cannot carry', () => {
    expect(stripInvalidXmlChars('a\u0000b\u0008c\u000Bd￾e\uD800f\t\n\r😀')).toBe('abcdef\t\n\r😀');
    expect(xmlText('\u0001<')).toBe('&lt;');
    expect(xmlAttr('\u001F"')).toBe('&quot;');
  });

  it('refuses unbalanced use', () => {
    const x = new XmlWriter();
    x.open('A');
    expect(() => x.toString()).toThrow();
    expect(() => new XmlWriter().close()).toThrow();
    expect(() => new XmlWriter().text('x')).toThrow();
  });
});

describe('parseXml', () => {
  it('ignores namespaces and prefixes, strips a BOM', () => {
    const root = parseXml('﻿<?xml version="1.0"?><q:Project xmlns:q="urn:QDA-XML:project:0:10"><q:Users><q:User guid="x"/></q:Users></q:Project>');
    expect(localName(root)).toBe('Project');
    const users = child(root, 'Users')!;
    expect(children(users, 'User')).toHaveLength(1);
    expect(descendants(root, 'User')).toHaveLength(1);
    expect(attr(children(users)[0]!, 'missing')).toBeNull();
  });

  it('normalises line endings the XML 1.0 way only', () => {
    const root = parseXml('<a>x\r\ny\rz w</a>');
    expect(textOf(root)).toBe('x\ny\nz w');
  });

  it('throws XmlParseError on malformed input', () => {
    expect(() => parseXml('<a><b></a>')).toThrow(XmlParseError);
    expect(() => parseXml('')).toThrow(XmlParseError);
    expect(() => parseXml('not xml')).toThrow(XmlParseError);
  });

  it('does not expand external entities', () => {
    const root = parseXml('<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><a>&x;</a>');
    expect(textOf(root)).not.toContain('root:');
  });
});

describe('common helpers', () => {
  it('normalises GUIDs', () => {
    expect(normGuid('{ABCDEF01-2345-6789-ABCD-EF0123456789}')).toBe('abcdef01-2345-6789-abcd-ef0123456789');
    expect(normGuid('  ')).toBeNull();
    expect(normGuid(null)).toBeNull();
    expect(isGuid('abcdef01-2345-6789-abcd-ef0123456789')).toBe(true);
  });

  it('GuidMap keeps uuid ids and replaces others, never repeating', () => {
    const m = new GuidMap();
    const id = '0b1c2d3e-4f50-4a6b-8c7d-8e9fa0b1c2d3';
    expect(m.get(id)).toBe(id);
    expect(m.get(id.toUpperCase())).not.toBe(id); // a second record with the same GUID gets its own
    expect(isGuid(m.get('project.name'))).toBe(true);
    expect(m.get('project.name')).toBe(m.get('project.name'));
    expect(new Set(Array.from({ length: 100 }, () => m.fresh())).size).toBe(100);
  });

  it('parses and formats xsd:dateTime', () => {
    expect(parseDateTime('2018-03-27T17:46:39Z')).toBe('2018-03-27T17:46:39.000Z');
    expect(parseDateTime('2018-10-04T22:56:11')).toBe('2018-10-04T22:56:11.000Z');
    expect(parseDateTime('2020-01-01T10:00:00.123456+02:00')).toBe('2020-01-01T08:00:00.123Z');
    expect(parseDateTime('2020-01-01')).toBe('2020-01-01T00:00:00.000Z');
    expect(parseDateTime('yesterday')).toBeNull();
    expect(parseDateTime('2020-13-45T00:00:00Z')).toBeNull();
    expect(formatDateTime('2020-01-01T08:00:00.123Z')).toBe('2020-01-01T08:00:00Z');
    expect(formatDateTime('nope')).toBeUndefined();
  });

  it('cleans names and excerpts by code point', () => {
    expect(cleanName('  a \n b  ', 10, 'x')).toBe('a b');
    expect(cleanName('', 10, 'fallback')).toBe('fallback');
    expect(cleanName('abcdefghijk', 5, 'x')).toBe('abcd…');
    expect(excerpt('😀😀😀😀', 3)).toBe('😀😀…');
    expect(excerpt(' short\ntext ', 50)).toBe('short text');
  });

  it('normalises colours', () => {
    expect(normColor('#F5A623')).toBe('#f5a623');
    expect(normColor('#abc')).toBe('#aabbcc');
    expect(normColor('red')).toBeNull();
    expect(normColor('#12345678')).toBeNull();
  });

  it('knows media types', () => {
    expect(mimeOf('a.M4A')).toBe('audio/mp4');
    expect(mimeOf('a.xyz')).toBe('application/octet-stream');
    expect(extFor('recording', 'video/mp4')).toBe('mp4');
    expect(extFor('x.mp3', 'audio/mpeg')).toBe('mp3');
    expect(extFor('x', 'application/x-unknown')).toBe('bin');
  });

  it('writes xsd:decimal without exponents', () => {
    expect(toDecimal(1.5)).toBe('1.5');
    expect(toDecimal(-0.0000001)).toBe('-0.0000001');
    expect(toDecimal(1e21)).toBe('1000000000000000000000');
    expect(toDecimal(1.25e-10)).toBe('0.000000000125');
    expect(toDecimal(-3)).toBe('-3');
    expect(() => toDecimal(NaN)).toThrow();
  });

  it('splits labelled code description sections', () => {
    expect(splitCodeDescription('Def.\n\nInclusion criteria:\nWhen happy.\n\nExample:\n"Yay"')).toEqual({
      description: 'Def.',
      inclusion: 'When happy.',
      exclusion: '',
      example: '"Yay"',
    });
    expect(splitCodeDescription('No sections here.')).toEqual({ description: 'No sections here.', inclusion: '', exclusion: '', example: '' });
  });
});
