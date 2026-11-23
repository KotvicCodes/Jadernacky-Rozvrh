import type { Buffer } from 'node:buffer';

export declare function get(url: string, headers?: Record<string, string>): Promise<{
  status: number;
  headers: Headers;
  data: Buffer;
}>;
