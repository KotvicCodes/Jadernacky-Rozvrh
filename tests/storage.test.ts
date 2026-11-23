import { describe, expect, it } from 'vitest';
import { createSchedule, normalizeLesson } from '../src/model';
import { loadState, parseState, saveState } from '../src/storage';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(key: string) { return this.data.get(key) ?? null; }
  key(i: number) { return [...this.data.keys()][i] ?? null; }
  removeItem(key: string) { this.data.delete(key); }
  setItem(key: string, value: string) { this.data.set(key, value); }
}

describe('storage', () => {
  it('round-trips schedules', () => {
    const storage = new MemoryStorage();
    const schedule = createSchedule('Bc2JI_JR1');
    schedule.lessons.push(normalizeLesson({ subject: 'ZPRO', start: 10, duration: 2, day: 1 }));
    expect(saveState({ schedules: [schedule], activeId: schedule.id }, storage)).toBe(true);
    const loaded = loadState(storage);
    expect(loaded.activeId).toBe(schedule.id);
    expect(loaded.schedules[0]?.lessons[0]?.subject).toBe('ZPRO');
  });

  it('recovers from corrupt data', () => {
    expect(parseState('{not json').schedules).toHaveLength(1);
    expect(parseState(JSON.stringify({ schedules: [] })).schedules).toHaveLength(1);
    const s = parseState(JSON.stringify({ schedules: [{ id: 'a' }], activeId: 'missing' }));
    expect(s.activeId).toBe('a');
  });

  it('cleans duplicate lecturer initials from previously saved timetables on load', () => {
    const storage = new MemoryStorage();
    storage.setItem('jaderka-rozvrh:v1', JSON.stringify({
      activeId: 'saved',
      schedules: [{ id: 'saved', name: 'ZS 2026', specId: 'JCF1', lessons: [
        { id: 'old-lesson', subject: 'TEF1', day: 1, start: 14, duration: 2, room: 'T-101', lecturer: 'P. Novotný P', color: 'pink' },
      ] }],
    }));
    const loaded = loadState(storage);
    expect(loaded.activeId).toBe('saved');
    expect(loaded.schedules[0]!.lessons[0]).toMatchObject({
      id: 'old-lesson', subject: 'TEF1', room: 'T-101', lecturer: 'P. Novotný',
    });
  });

  it('reports failure when storage throws', () => {
    const broken = new MemoryStorage();
    broken.setItem = () => {
      throw new Error('quota');
    };
    expect(saveState(parseState(null), broken)).toBe(false);
  });
});
