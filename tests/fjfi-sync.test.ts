import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  bachelorCodes,
  buildYears,
  configProgramCodes,
  isDegreeYear,
  parseNav,
  parsePage,
  programDrift,
  programName,
  shortYearLabel,
  type PageEntry,
} from '../scripts/fjfi-site.mjs';
import { parseRoomCodes, parseTeacherNames, updateProgramSource } from '../scripts/fjfi-metadata.mjs';
import { PROGRAMS } from '../src/config';
import { groupPrograms, kruhChoices, parseManifest, pickFjfiTimetable, splitProgramName, timetableLabel, timetableShortLabel, type FjfiProgram } from '../src/import/web';

const bs1Html = readFileSync(join(process.cwd(), 'tests/fixtures/fjfi-bs1.html'), 'utf8');

const pickPdf = (e: PageEntry) => (e.pdf ? { file: e.pdf.split('/').pop()!, url: e.pdf } : null);

/** A page like /rozvrh/studenti/decin, which spans several years. */
const decinHtml = `<main>
  <a href="#Bc1AIPV_Dc1">Aplikace informatiky v přírodních vědách - Děčín, 1. ročník</a>
  <a href="#Bc2AIPV_Dc1">Aplikace informatiky v přírodních vědách - Děčín, 2. ročník</a>
  <div id="Bc1AIPV_Dc1"><a href="/uploads/rozvrh/pdf/parts/Bc1AIPV_Dc1.pdf">PDF</a></div>
  <div id="Bc2AIPV_Dc1"><a href="/uploads/rozvrh/pdf/parts/Bc2AIPV_Dc1.pdf">PDF</a></div>
</main>`;

/** Small fake site: bs1 from the fixture, the Děčín page (1st year only) listed first, an empty page. */
function fakeSite() {
  const decin = parsePage(decinHtml).filter((e) => e.id.startsWith('Bc1'));
  return [
    { slug: 'decin', title: 'Rozvrh pro studium v Děčíně', entries: decin },
    { slug: 'bs1', title: 'Rozvrh 1. ročníku bakalářského studia', entries: parsePage(bs1Html) },
    { slug: 'jazyky', title: 'Rozvrh jazyků', entries: [] },
  ];
}

describe('website parsing', () => {
  it('discovers the student pages from the navigation', () => {
    const nav = parseNav(bs1Html);
    expect(nav.map((p) => p.slug)).toEqual(['bs1', 'bs2', 'bs3', 'nms1', 'nms2', 'decin', 'ucitelstvi', 'jazyky']);
    expect(nav[0]!.title).toBe('Rozvrh 1. ročníku bakalářského studia');
  });

  it('shortens year titles', () => {
    expect(shortYearLabel('Rozvrh 1. ročníku bakalářského studia')).toBe('1. ročník Bc.');
    expect(shortYearLabel('Rozvrh 2. ročníku navazujícího magisterského studia')).toBe('2. ročník NMS');
    expect(shortYearLabel('Rozvrh pro studium v Děčíně')).toBe('Pro studium v Děčíně');
  });

  it('syncs bachelor and master years without depending on auxiliary pages', () => {
    const pages = parseNav(bs1Html).filter((page) => isDegreeYear(page.title));
    expect(pages.map((page) => page.slug)).toEqual(['bs1', 'bs2', 'bs3', 'nms1', 'nms2']);
    expect(isDegreeYear('Rozvrh 1. ročníku doktorského studia')).toBe(false);
  });

  it('reads the timetable entries with their files, ignoring other links', () => {
    const entries = parsePage(bs1Html);
    expect(entries.map((e) => e.id)).toEqual(['Bc1AMSM1', 'Bc1FI_IPL1', 'Bc1JCF1', 'Bc1JCF2', 'Bc1JCF3']);
    expect(entries[2]).toEqual({
      id: 'Bc1JCF1',
      title: 'Jaderná a částicová fyzika 1. kruh',
      pdf: 'https://rozvrh.fjfi.cvut.cz/uploads/rozvrh/pdf/parts/Bc1JCF1.pdf',
      png: 'https://rozvrh.fjfi.cvut.cz/uploads/rozvrh/parts/Bc1JCF1.png',
    });
    expect(parsePage('<main><p>Nic tu není</p></main>')).toEqual([]);
  });

  it('strips kruh and year from program names', () => {
    expect(programName('Jaderná a částicová fyzika 2. kruh')).toBe('Jaderná a částicová fyzika');
    expect(programName('Učitelství fyziky pro střední školy, 1. ročník NMS')).toBe('Učitelství fyziky pro střední školy');
  });

  it('groups entries into years, programs and kruhs', () => {
    const years = buildYears(fakeSite(), pickPdf);
    expect(years.map((y) => y.id)).toEqual(['bs1']); // Děčín filed under its year; empty pages dropped
    const bs1 = years[0]!;
    expect(bs1.label).toBe('1. ročník Bc.');
    const byCode = Object.fromEntries(bs1.programs.map((p) => [p.code, p]));
    expect(byCode.JCF!.name).toBe('Jaderná a částicová fyzika');
    expect(byCode.JCF!.kruhs.map((k) => [k.kruh, k.id, k.file])).toEqual([
      [1, 'Bc1JCF1', 'Bc1JCF1.pdf'],
      [2, 'Bc1JCF2', 'Bc1JCF2.pdf'],
      [3, 'Bc1JCF3', 'Bc1JCF3.pdf'],
    ]);
    expect(byCode.FI_IPL!.kruhs).toEqual([expect.objectContaining({ kruh: null, id: 'Bc1FI_IPL1' })]);
    expect(byCode.AIPV_Dc).toMatchObject({ name: 'Aplikace informatiky v přírodních vědách - Děčín', page: 'decin' });
    // An entry of a mixed page without a matching year keeps the page as a group of its own.
    const pages = fakeSite();
    pages[0]!.entries = parsePage(decinHtml);
    const all = buildYears(pages, pickPdf);
    expect(all.map((y) => [y.id, y.label])).toEqual([
      ['decin', 'Pro studium v Děčíně'],
      ['bs1', '1. ročník Bc.'],
    ]);
    expect(all[0]!.programs).toEqual([
      expect.objectContaining({ code: 'Bc2AIPV_Dc1', name: 'Aplikace informatiky v přírodních vědách - Děčín, 2. ročník' }),
    ]);
  });

  it('rejects duplicate IDs', () => {
    const page = { slug: 'bs1', title: 'Rozvrh 1. ročníku bakalářského studia', entries: parsePage(bs1Html) };
    expect(() => buildYears([page, { ...page, slug: 'copy', title: 'Kopie' }], pickPdf)).toThrow(/Duplicate/);
  });
});

describe('program drift check', () => {
  it('reads PROGRAMS codes from src/config.ts exactly as the app does', () => {
    const source = readFileSync(join(process.cwd(), 'src/config.ts'), 'utf8');
    expect(configProgramCodes(source)).toEqual(PROGRAMS.map((p) => p.code).sort());
  });

  it('lists only bachelor programs of the bachelor pages', () => {
    expect(bachelorCodes(buildYears(fakeSite(), pickPdf))).toEqual(['AMSM', 'FI_IPL', 'JCF']);
  });

  it('reports added and removed programs', () => {
    expect(programDrift(['JCF', 'OLD'], ['JCF', 'NEW'])).toEqual({ added: ['NEW'], removed: ['OLD'] });
    expect(programDrift(['A', 'B'], ['B', 'A'])).toEqual({ added: [], removed: [] });
  });
});

describe('automatic metadata refresh', () => {
  const source = readFileSync(join(process.cwd(), 'src/config.ts'), 'utf8');

  it('adds, removes and renames bachelor choices while preserving the rest of config', () => {
    const years = buildYears(fakeSite(), pickPdf);
    years[0]!.programs.find((p) => p.code === 'JCF')!.name = 'Nový "název" $&\noboru';
    const updated = updateProgramSource(source, years);
    expect(configProgramCodes(updated)).toEqual(['AMSM', 'FI_IPL', 'JCF']);
    expect(updated).toContain(JSON.stringify('Nový "název" $&\noboru'));
    expect(updated.slice(updated.indexOf('export interface ParsedSpec'))).toBe(source.slice(source.indexOf('export interface ParsedSpec')));
    expect(updated.slice(0, updated.indexOf('export const PROGRAMS'))).toBe(source.slice(0, source.indexOf('export const PROGRAMS')));
    expect(updateProgramSource(updated, years)).toBe(updated);
  });

  it('refuses to erase program choices if parsing fails or only master years remain', () => {
    expect(() => updateProgramSource(source, [])).toThrow(/No bachelor programs/);
    const years = buildYears(fakeSite(), pickPdf);
    years[0]!.prefix = 'Ing1';
    expect(() => updateProgramSource(source, years)).toThrow(/No bachelor programs/);
    expect(() => updateProgramSource('unexpected config format', buildYears(fakeSite(), pickPdf))).toThrow(/declaration not found/);
  });

  it('reads OCR names and room codes without navigation labels, headers or location notes', () => {
    expect(parseTeacherNames(`<summary>Navigation</summary><main>
      <summary>===== Externisté =====</summary><summary>Novák&nbsp;Jiří (Děčín)</summary>
      <summary><span>Černý</span></summary></main>`)).toEqual(['Novák Jiří', 'Černý']);
    expect(parseRoomCodes(`<main><table><tr><th>KOS</th><th>Kód v rozvrhu</th></tr>
      <tr class="room"><td>BR:103</td><td><b>B-103</b> (aula)</td></tr>
      <tr><td>BR:121</td><td>&nbsp;</td></tr></table></main>`)).toEqual(['B-103']);
  });

  it('rejects empty or redesigned OCR pages instead of generating empty dictionaries', () => {
    for (const parse of [parseTeacherNames, parseRoomCodes]) {
      expect(() => parse('<html>Temporarily unavailable</html>')).toThrow(/main content/);
      expect(() => parse('<main><p>New layout</p></main>')).toThrow(/redesign/);
    }
  });
});

function sampleManifest() {
  return {
    version: 1,
    generatedAt: '2026-11-21T04:17:00.000Z',
    source: 'https://rozvrh.fjfi.cvut.cz/rozvrh/studenti/',
    years: buildYears(fakeSite(), pickPdf),
  };
}

describe('manifest', () => {
  it('accepts what the fetch script builds', () => {
    const m = parseManifest(JSON.parse(JSON.stringify(sampleManifest())));
    expect(m.generatedAt.toISOString()).toBe('2026-11-21T04:17:00.000Z');
    expect(m.years[0]!.programs.find((p) => p.code === 'JCF')!.kruhs).toHaveLength(3);
  });

  it('rejects broken manifests', () => {
    expect(() => parseManifest(null)).toThrow();
    expect(() => parseManifest({ ...sampleManifest(), version: 2 })).toThrow(/verze/);
    expect(() => parseManifest({ ...sampleManifest(), years: [] })).toThrow(/ročník/);
    const bad = sampleManifest();
    bad.years[0]!.programs[0]!.kruhs[0]!.file = '../../evil.html';
    expect(() => parseManifest(bad)).toThrow(/soubor/);
  });
});

describe('dialog options', () => {
  const m = parseManifest(sampleManifest());
  const year = m.years[0]!;
  const program = (code: string): FjfiProgram => year.programs.find((p) => p.code === code)!;

  it('groups specializations by the official program name without merging unrelated programs', () => {
    const ipl = program('FI_IPL');
    const pf = { ...ipl, code: 'FI_PF', name: 'Fyzikální inženýrství, spec. Počítačová fyzika' };
    const groups = groupPrograms([ipl, pf, program('JCF')]);
    expect(groups.map((group) => group.name)).toEqual(['Fyzikální inženýrství', 'Jaderná a částicová fyzika']);
    expect(groups[0]!.programs).toEqual([ipl, pf]);
    expect(splitProgramName(pf.name)).toEqual({ program: 'Fyzikální inženýrství', specialization: 'Počítačová fyzika' });
    expect(splitProgramName('Jaderná a částicová fyzika')).toEqual({ program: 'Jaderná a částicová fyzika', specialization: null });
    expect(splitProgramName('Obor, specializace Název')).toEqual({ program: 'Obor', specialization: 'Název' });
  });

  it('hides the kruh choice for single-kruh programs', () => {
    expect(kruhChoices(program('FI_IPL')).visible).toBe(false);
    expect(kruhChoices(program('JCF'))).toEqual({
      visible: true,
      options: [
        { value: '0', label: '1. kruh' },
        { value: '1', label: '2. kruh' },
        { value: '2', label: '3. kruh' },
      ],
    });
  });

  it('builds labels', () => {
    expect(timetableLabel(year, program('JCF'), program('JCF').kruhs[1]!)).toBe('1. ročník Bc. – Jaderná a částicová fyzika, 2. kruh');
    expect(timetableShortLabel(year, program('JCF'), program('JCF').kruhs[1]!)).toBe('1. ročník Bc. – JCF2');
    expect(timetableShortLabel(year, program('FI_IPL'), program('FI_IPL').kruhs[0]!)).toBe('1. ročník Bc. – FI_IPL');
    expect(timetableLabel(year, program('FI_IPL'), program('FI_IPL').kruhs[0]!)).toBe(
      '1. ročník Bc. – Fyzikální inženýrství, spec. Inženýrství pevných látek',
    );
  });
});

describe('pickFjfiTimetable', () => {
  beforeAll(() => {
    // jsdom has no modal dialogs.
    const proto = HTMLDialogElement.prototype as HTMLDialogElement & Record<string, unknown>;
    proto.showModal ??= function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    proto.close ??= function (this: HTMLDialogElement) {
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    };
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
    localStorage.clear();
  });

  const flush = () => new Promise((r) => setTimeout(r, 0));
  const select = (name: string) => document.querySelector<HTMLSelectElement>(`select[name="${name}"]`)!;
  const change = (name: string, label: string) => {
    const el = select(name);
    el.value = [...el.options].find((o) => o.textContent === label)!.value;
    el.dispatchEvent(new Event('change'));
  };

  function stubFetch(manifest: unknown) {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL | string) => {
        calls.push(String(url));
        if (String(url).endsWith('manifest.json')) {
          return manifest === undefined ? new Response('Not found', { status: 404 }) : Response.json(manifest);
        }
        return new Response('%PDF-1.4 fake', { status: 200 });
      }),
    );
    return calls;
  }

  it('picks a program and kruh and returns the official file', async () => {
    const calls = stubFetch(sampleManifest());
    const picked = pickFjfiTimetable();
    await flush();
    expect(document.querySelector('.web-import-synced')!.textContent).toMatch(/2026/);

    change('program', 'Fyzikální inženýrství');
    expect(select('specialization').selectedOptions[0]!.textContent).toBe('Inženýrství pevných látek');
    expect(select('specialization').closest('label')!.hidden).toBe(false);
    expect(select('kruh').closest('label')!.hidden).toBe(true);
    change('program', 'Jaderná a částicová fyzika');
    expect(select('specialization').closest('label')!.hidden).toBe(true);
    expect(select('kruh').closest('label')!.hidden).toBe(false);
    change('kruh', '2. kruh');

    document.querySelector('form')!.requestSubmit();
    const result = await picked;
    expect(result).toMatchObject({ fileName: 'Bc1JCF2.pdf', label: '1. ročník Bc. – Jaderná a částicová fyzika, 2. kruh', shortLabel: '1. ročník Bc. – JCF2' });
    expect(await result!.file.text()).toBe('%PDF-1.4 fake');
    expect(calls.map((u) => new URL(u).pathname)).toEqual([
      `${import.meta.env.BASE_URL}fjfi/manifest.json`,
      `${import.meta.env.BASE_URL}fjfi/Bc1JCF2.pdf`,
    ]);
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('imports the chosen specialization and kruh and restores both when reopened', async () => {
    const manifest = sampleManifest();
    const year = manifest.years[0]!;
    year.programs.push({
      code: 'FI_FPTF',
      name: 'Fyzikální inženýrství, spec. Fyzika plazmatu a termojaderné fúze',
      page: 'bs1',
      kruhs: [1, 2].map((kruh) => ({ kruh, id: `Bc1FI_FPTF${kruh}`, file: `Bc1FI_FPTF${kruh}.pdf`, url: '' })),
    });
    const calls = stubFetch(manifest);
    const picked = pickFjfiTimetable();
    await flush();
    expect([...select('program').options].map((o) => o.textContent).filter((name) => name === 'Fyzikální inženýrství')).toHaveLength(1);
    change('program', 'Fyzikální inženýrství');
    expect([...select('specialization').options].map((o) => o.textContent)).toEqual([
      'Inženýrství pevných látek', 'Fyzika plazmatu a termojaderné fúze',
    ]);
    change('specialization', 'Fyzika plazmatu a termojaderné fúze');
    change('kruh', '2. kruh');
    document.querySelector('form')!.requestSubmit();
    expect(await picked).toMatchObject({ fileName: 'Bc1FI_FPTF2.pdf', shortLabel: '1. ročník Bc. – FI_FPTF2' });
    expect(calls.at(-1)).toMatch(/\/fjfi\/Bc1FI_FPTF2\.pdf$/);

    const reopened = pickFjfiTimetable();
    await flush();
    expect(select('program').selectedOptions[0]!.textContent).toBe('Fyzikální inženýrství');
    expect(select('specialization').value).toBe('FI_FPTF');
    expect(select('kruh').selectedOptions[0]!.textContent).toBe('2. kruh');
    change('specialization', 'Inženýrství pevných látek');
    expect(select('kruh').closest('label')!.hidden).toBe(true);
    change('program', 'Jaderná a částicová fyzika');
    expect(select('specialization').closest('label')!.hidden).toBe(true);
    document.querySelector('form')!.requestSubmit();
    expect(await reopened).toMatchObject({ fileName: 'Bc1JCF1.pdf' });
  });

  it('explains a missing manifest and resolves null on close', async () => {
    stubFetch(undefined);
    const picked = pickFjfiTimetable();
    await flush();
    expect(document.querySelector('.status')!.textContent).toMatch(/npm run fetch-fjfi/);
    [...document.querySelectorAll('button')].find((b) => b.textContent === 'Zavřít')!.click();
    expect(await picked).toBeNull();
  });

  it('keeps the selected program and kruh when changing degree years with different option orders', async () => {
    const manifest = sampleManifest();
    const bachelor = manifest.years[0]!;
    manifest.years.push({
      ...bachelor,
      id: 'nms1',
      label: '1. ročník NMS',
      prefix: 'Ing1',
      programs: [...bachelor.programs].reverse().map((program) => ({
        ...program,
        // The second kruh has a different index here than in the bachelor year.
        kruhs: program.kruhs.filter((k) => program.code !== 'JCF' || k.kruh !== 1).map((k) => ({
          ...k,
          id: k.id.replace('Bc1', 'Ing1'),
          file: k.file.replace('Bc1', 'Ing1'),
        })),
      })),
    });
    stubFetch(manifest);
    const picked = pickFjfiTimetable();
    await flush();
    change('program', 'Jaderná a částicová fyzika');
    change('kruh', '2. kruh');
    for (const year of ['1. ročník NMS', '1. ročník Bc.', '1. ročník NMS']) {
      change('year', year);
      expect(select('program').selectedOptions[0]!.textContent).toBe('Jaderná a částicová fyzika');
      expect(select('kruh').selectedOptions[0]!.textContent).toBe('2. kruh');
    }
    document.querySelector('form')!.requestSubmit();
    expect(await picked).toMatchObject({ fileName: 'Ing1JCF2.pdf', shortLabel: '1. ročník NMS – JCF2' });
  });
});
