import type { BuiltYear } from './fjfi-site.mjs';

export declare function updateProgramSource(source: string, years: BuiltYear[]): string;
export declare function parseTeacherNames(html: string): string[];
export interface RoomInfo { code: string; kos: string; description: string; building: string; capacity: string }
export declare function parseRooms(html: string): RoomInfo[];
export declare function parseRoomCodes(html: string): string[];
export declare function parseCourseCatalogue(html: string): { academicYear: string; codes: string[] };
