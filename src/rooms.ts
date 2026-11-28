/**
 * "Volné učebny": which FJFI rooms have no regular lesson at a given weekly
 * time, judged from every official timetable in the catalogue. One-off
 * bookings (exams, events) are not published there, so "free" means only
 * "no lesson on the official timetables".
 */
import { KNOWN_ROOM_DETAILS, type KnownRoom } from './import/known-names';
import type { Lesson, LessonDraft } from './model';
import { overlaps, subjectKey, type CatalogTimetable } from './replacements';

export type { KnownRoom };

type Slot = Pick<LessonDraft, 'day' | 'start' | 'duration'>;

/**
 * Rooms the finder offers: FJFI rooms in Prague. The Děčín timetables are
 * not in the catalogue, so their rooms would always look free.
 */
export const FINDER_ROOMS: readonly KnownRoom[] = KNOWN_ROOM_DETAILS.filter((room) => !/děčín/i.test(room.building));

/** A lesson that occupies a room, merged when several timetables share it. */
export interface RoomUse {
  start: number;
  duration: number;
  subject: string;
  lecturer: string;
  /** Timetables it comes from, by abbreviation ("JCF1"), in catalogue order. */
  sources: string[];
}

export interface BusyRoom {
  room: KnownRoom;
  /** Overlapping lessons, by start time. */
  uses: RoomUse[];
}

export interface RoomSearch {
  /** Rooms with no overlapping lesson, in the classroom list's order. */
  free: KnownRoom[];
  busy: BusyRoom[];
}

/** Room code used for matching: case, spaces, dots and dashes ignored ("t 209" = "T-209"). */
export function roomKey(code: string): string {
  return code.normalize('NFC').replace(/[\s.\-–]+/g, '').toLowerCase();
}

/** Every reading of a lesson's room field that could name a room: "T-105, T-115" names two. */
function roomKeys(field: string): Set<string> {
  const keys = new Set<string>();
  for (const part of field.split(/[,;/+]/)) {
    keys.add(roomKey(part));
    for (const word of part.split(/\s+/)) keys.add(roomKey(word));
  }
  keys.delete('');
  return keys;
}

const same = (a: Slot, b: Slot) => a.day === b.day && a.start === b.start && a.duration === b.duration;

/**
 * Splits `rooms` into free and busy for `slot`. A room is busy when any
 * catalogue lesson in it overlaps any part of the slot. `replaced` is the
 * lesson being moved away: its own occurrences in the catalogue (same time,
 * course and room) do not block its room.
 */
export function findFreeRooms(
  slot: Slot,
  catalog: readonly CatalogTimetable[],
  replaced?: Pick<Lesson, 'day' | 'start' | 'duration' | 'subject' | 'room'>,
  rooms: readonly KnownRoom[] = FINDER_ROOMS,
): RoomSearch {
  const byKey = new Map(rooms.map((room) => [roomKey(room.code), room]));
  const replacedRooms = replaced ? roomKeys(replaced.room) : new Set<string>();
  const uses = new Map<KnownRoom, Map<string, RoomUse>>();
  for (const timetable of catalog) {
    for (const lesson of timetable.lessons) {
      if (!overlaps(lesson, slot)) continue;
      const isReplaced = !!replaced && same(lesson, replaced) && subjectKey(lesson.subject) === subjectKey(replaced.subject);
      for (const key of roomKeys(lesson.room)) {
        const room = byKey.get(key);
        if (!room || (isReplaced && replacedRooms.has(key))) continue;
        let list = uses.get(room);
        if (!list) uses.set(room, (list = new Map()));
        const id = [lesson.start, lesson.duration, subjectKey(lesson.subject), lesson.lecturer.trim().toLowerCase()].join('|');
        let use = list.get(id);
        if (!use) list.set(id, (use = { start: lesson.start, duration: lesson.duration, subject: lesson.subject, lecturer: lesson.lecturer, sources: [] }));
        if (!use.sources.includes(timetable.short)) use.sources.push(timetable.short);
      }
    }
  }
  return {
    free: rooms.filter((room) => !uses.has(room)),
    busy: rooms.flatMap((room) => {
      const list = uses.get(room);
      return list ? [{ room, uses: [...list.values()].sort((a, b) => a.start - b.start || a.subject.localeCompare(b.subject, 'cs')) }] : [];
    }),
  };
}

/** The user's own lessons at that time, apart from the one being replaced. */
export function ownClashes(own: readonly Lesson[], slot: Slot, replacedId?: string): Lesson[] {
  return own.filter((lesson) => lesson.id !== replacedId && overlaps(lesson, slot));
}

/** "40 míst", "cca 20 míst"; other published forms ("20 míst, 16 PC") as they are. */
export function capacityLabel(capacity: string): string {
  const text = capacity.trim();
  return /^(cca\s*)?\d+(\s*-\s*\d+)?$/i.test(text) ? `${text} míst` : text;
}

/** Rooms grouped by building, buildings in order of their first room. */
export function groupByBuilding(rooms: readonly KnownRoom[]): Array<{ building: string; rooms: KnownRoom[] }> {
  const groups = new Map<string, KnownRoom[]>();
  for (const room of rooms) {
    const group = groups.get(room.building);
    if (group) group.push(room);
    else groups.set(room.building, [room]);
  }
  return [...groups].map(([building, list]) => ({ building, rooms: list }));
}
