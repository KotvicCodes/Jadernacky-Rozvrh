// Types for fjfi-site.mjs (plain JS so the Node script runs without a TypeScript loader).

export declare const SITE: string;
export declare const MANIFEST_VERSION: number;

export interface NavPage {
  slug: string;
  title: string;
}

export interface PageEntry {
  id: string;
  title: string;
  pdf: string | null;
  png: string | null;
}

export interface BuiltKruh {
  kruh: number | null;
  id: string;
  file: string;
  url: string;
}

export interface BuiltProgram {
  code: string;
  name: string;
  page: string;
  kruhs: BuiltKruh[];
}

export interface BuiltYear {
  id: string;
  label: string;
  title: string;
  url: string;
  prefix: string | null;
  programs: BuiltProgram[];
}

export declare function decodeText(s: string): string;
export declare function parseNav(html: string): NavPage[];
export declare function shortYearLabel(title: string): string;
export declare function parsePage(html: string): PageEntry[];
export declare function splitId(id: string): { prefix: string; code: string; digits: string } | null;
export declare function programName(title: string): string;
export declare function buildYears(
  pages: { slug: string; title: string; entries: PageEntry[] }[],
  pick: (entry: PageEntry) => { file: string; url: string } | null,
): BuiltYear[];
export declare function bachelorCodes(years: BuiltYear[]): string[];
export declare function configProgramCodes(source: string): string[];
export declare function programDrift(appCodes: string[], siteCodes: string[]): { added: string[]; removed: string[] };
