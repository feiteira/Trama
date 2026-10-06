import { describe, expect, it } from 'vitest';
import { forgetAllProjectPrefs, forgetProjectPrefs } from './localPrefs';

function fakeStorage(init: Record<string, string>) {
  const m = new Map(Object.entries(init));
  return {
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => void m.delete(k),
    keys: () => [...m.keys()].sort(),
  };
}

const A = '0b6a2c1e-3f4d-4a5b-8c6d-7e8f9a0b1c2d';
const B = '1c7b3d2f-4a5e-4b6c-9d7e-8f9a0b1c2d3e';

describe('localPrefs', () => {
  it('forgets one project, keeping the others and device-wide settings', () => {
    const s = fakeStorage({
      [`trama.segments.filter.${A}`]: '{}',
      [`trama.codetree.${A}.codes`]: '[]',
      [`trama.segments.filter.${B}`]: '{}',
      'trama.projects.sort': 'name',
      [`other.${A}`]: 'x',
    });
    forgetProjectPrefs(A, s);
    expect(s.keys()).toEqual([`other.${A}`, 'trama.projects.sort', `trama.segments.filter.${B}`]);
  });

  it('forgets every project when the library is removed', () => {
    const s = fakeStorage({ [`trama.segments.filter.${A}`]: '{}', [`trama.documents.view.${B}`]: '{}', 'trama.rail.collapsed': '1' });
    forgetAllProjectPrefs(s);
    expect(s.keys()).toEqual(['trama.rail.collapsed']);
  });
});
