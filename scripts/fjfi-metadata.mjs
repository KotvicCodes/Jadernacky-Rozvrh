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

export function parseRoomCodes(html) {
  const rooms = [];
  for (const [, row] of mainContent(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(([, text]) => decodeText(text));
    const room = cells[1]?.replace(/\s*\(.*\)\s*$/, '').trim();
    if (room) rooms.push(room);
  }
  if (!rooms.length) throw new Error('No room codes on the FJFI classroom page (redesign?)');
  return rooms;
}
