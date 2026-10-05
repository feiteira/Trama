import { describe, expect, it } from 'vitest';
import type { ProjectInfo } from '../../services/project';
import { filterProjects, isProjectSort, sortProjects } from './projectList';

const p = (id: string, name: string, extra: Partial<ProjectInfo> = {}): ProjectInfo => ({
  id,
  name,
  description: '',
  color: '#3a6ea5',
  created_at: '2026-01-01T00:00:00.000Z',
  opened_at: null,
  ...extra,
});

describe('filterProjects', () => {
  const list = [
    p('1', 'Hortas comunitárias', { description: 'Bem-estar e solidão' }),
    p('2', 'Nurses on night shifts'),
    p('3', 'Ética do cuidado 🌱'),
  ];

  it('returns everything for an empty query, as a copy', () => {
    const out = filterProjects(list, '  ');
    expect(out).toEqual(list);
    expect(out).not.toBe(list);
  });

  it('ignores accents and case, in name and description', () => {
    expect(filterProjects(list, 'COMUNITARIAS').map((x) => x.id)).toEqual(['1']);
    expect(filterProjects(list, 'solidao').map((x) => x.id)).toEqual(['1']);
    expect(filterProjects(list, 'etica').map((x) => x.id)).toEqual(['3']);
    expect(filterProjects(list, '🌱').map((x) => x.id)).toEqual(['3']);
  });

  it('needs every word', () => {
    expect(filterProjects(list, 'night nurses').map((x) => x.id)).toEqual(['2']);
    expect(filterProjects(list, 'night gardens')).toEqual([]);
  });
});

describe('sortProjects', () => {
  const list = [
    p('a', 'Zebra', { created_at: '2026-03-01T00:00:00Z', opened_at: '2026-05-01T00:00:00Z' }),
    p('b', 'Álamo', { created_at: '2026-04-01T00:00:00Z' }),
    p('c', 'alpha', { created_at: '2026-02-01T00:00:00Z', opened_at: '2026-06-01T00:00:00Z' }),
    p('d', 'Project 10', { created_at: '2026-01-01T00:00:00Z' }),
    p('e', 'Project 9', { created_at: '2026-01-01T00:00:00Z' }),
  ];

  it('sorts by name with the reader’s collation (accents, numbers)', () => {
    expect(sortProjects(list, 'name', 'pt-PT').map((x) => x.name)).toEqual(['Álamo', 'alpha', 'Project 9', 'Project 10', 'Zebra']);
  });

  it('puts the last opened first, then never-opened ones newest first', () => {
    expect(sortProjects(list, 'recent').map((x) => x.id)).toEqual(['c', 'a', 'b', 'e', 'd']);
  });

  it('sorts by creation, newest first, ties by name', () => {
    expect(sortProjects(list, 'created').map((x) => x.id)).toEqual(['b', 'a', 'c', 'e', 'd']);
  });

  it('does not change its input and copes with empty and large lists', () => {
    const copy = [...list];
    sortProjects(list, 'name');
    expect(list).toEqual(copy);
    expect(sortProjects([], 'recent')).toEqual([]);
    const many = Array.from({ length: 5000 }, (_, i) => p(String(i), `P ${i}`, { opened_at: i % 3 ? new Date(2026, 0, 1 + (i % 300)).toISOString() : null }));
    const sorted = sortProjects(many, 'recent');
    expect(sorted).toHaveLength(5000);
    expect(sorted[sorted.length - 1]!.opened_at).toBeNull();
  });

  it('knows its sort names', () => {
    expect(isProjectSort('name')).toBe(true);
    expect(isProjectSort('size')).toBe(false);
    expect(isProjectSort(null)).toBe(false);
  });
});
