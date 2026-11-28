/** Validated build-time metadata. Kept separate from I/O for fixture tests. */
import { decodeText } from './fjfi-site.mjs';

/** Refresh the manual editor's bachelor choices from the downloaded manifest. */
export function updateProgramSource(source, years) {
  const programs = new Map();
  for (const year of years) {
    if (!/^bc\d+$/i.test(year.prefix ?? '')) continue;
    for (const program of year.programs) {
      if (program.page !== year.id) continue;
      if (!/^[A-Za-z_]+$/.test(program.code) || !program.name.trim()) {
        throw new Error('Invalid bachelor program in the FJFI manifest');
      }
      // A program can appear in several years. Use its first published name.
      if (!programs.has(program.code)) programs.set(program.code, program.name);
    }
  }
  if (!programs.size) throw new Error('No bachelor programs found; keeping the existing choices');
  const block = /export const PROGRAMS: readonly StudyProgram\[\] = \[[\s\S]*?\n\];/;
  if (!block.test(source)) throw new Error('PROGRAMS declaration not found in src/config.ts');
  const entries = [...programs].sort((a, b) => a[1].localeCompare(b[1], 'cs'));
  const replacement = `export const PROGRAMS: readonly StudyProgram[] = [\n${entries
    .map(([code, name]) => `  { code: ${JSON.stringify(code)}, name: ${JSON.stringify(name)} },`)
    .join('\n')}\n];`;
  // A function replacement keeps $ sequences in upstream names literal.
  return source.replace(block, () => replacement);
}

function mainContent(html) {
  const match = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html);
  if (!match) throw new Error('No main content on the FJFI page (redesign?)');
  return match[1];
}

export function parseTeacherNames(html) {
  const names = [];
  for (const [, raw] of mainContent(html).matchAll(/<summary\b[^>]*>([\s\S]*?)<\/summary>/gi)) {
    const name = decodeText(raw).replace(/\s*\(.*\)\s*$/, '').trim();
    if (name && !name.includes('=') && !name.includes('▾')) names.push(name);
  }
  if (!names.length) throw new Error('No teachers on the FJFI department page (redesign?)');
  return names;
}

/**
 * Rooms from the classroom list (/seznam-uceben): the code printed on the
 * timetables ("Kód v rozvrhu", without notes such as "(KIPL PC)"), plus its
 * KOS code, description, building and capacity as published. Rows without
 * a timetable code are skipped; rooms of other faculties have no KOS code.
 */
export function parseRooms(html) {
  const rooms = [];
  for (const [, row] of mainContent(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(([, text]) => decodeText(text));
    const code = cells[1]?.replace(/\s*\(.*\)\s*$/, '').trim();
    if (code) rooms.push({ code, kos: cells[0] ?? '', description: cells[2] ?? '', building: cells[3] ?? '', capacity: cells[4] ?? '' });
  }
  if (!rooms.length) throw new Error('No room codes on the FJFI classroom page (redesign?)');
  return rooms;
}

export function parseRoomCodes(html) {
  return parseRooms(html).map((room) => room.code);
}

/** Regular courses actually offered in the catalogue's academic year. */
export function parseCourseCatalogue(html) {
  const period = /(\d{4})\/(\d{4})\s*<select\b[^>]*\bid=["']period["']/i.exec(html);
  if (!period || Number(period[2]) !== Number(period[1]) + 1) {
    throw new Error('No academic year in the course catalogue (redesign?)');
  }
  const table = /<table\b[^>]*\bclass=["'][^"']*\bseznam\.predmetu\b[^"']*["'][^>]*>([\s\S]*?)<\/table>/i.exec(html)?.[1];
  if (!table) throw new Error('No course table in the catalogue (redesign?)');
  const headers = [...table.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map(([, text]) => decodeText(text));
  const codeColumn = headers.indexOf('Kód');
  const nameColumn = headers.indexOf('Název předmětu');
  const termColumn = headers.indexOf('Vypsán v semestru');
  if ([codeColumn, nameColumn, termColumn].includes(-1)) {
    throw new Error('Missing course catalogue columns (redesign?)');
  }
  const terms = new Set([`B${period[1].slice(-2)}1`, `B${period[1].slice(-2)}2`]);
  const codes = new Set();
  for (const [, row] of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(([, text]) => decodeText(text));
    if (!cells.length) continue;
    if (cells.length !== headers.length) throw new Error('Unexpected course catalogue row (redesign?)');
    const code = cells[codeColumn];
    // Ignore doctoral and other identifiers outside the regular
    // two-digit department-prefix format.
    if (!/^\d{2}[A-Z][A-Z0-9_]*$/.test(code)) continue;
    if (![...cells[termColumn].matchAll(/\bB\d{3}\b/g)].some(([term]) => terms.has(term))) continue;
    if (!cells[nameColumn]) throw new Error(`No name for course ${code} (redesign?)`);
    codes.add(code);
  }
  if (!codes.size) throw new Error('No currently offered courses in the catalogue (redesign?)');
  return { academicYear: `${period[1]}/${period[2]}`, codes: [...codes].sort() };
}
