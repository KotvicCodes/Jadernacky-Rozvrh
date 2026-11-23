/** Bounded requests shared by the timetable and OCR metadata refreshes. */
const USER_AGENT = 'jaderka-rozvrh-sync';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Buffer the complete GET inside the retry loop, including transfer errors. */
export async function get(url, headers = {}) {
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, ...headers }, signal: AbortSignal.timeout(60_000) });
      if (res.ok || res.status === 304) {
        const data = Buffer.from(await res.arrayBuffer());
        return { status: res.status, headers: res.headers, data };
      }
    } catch (err) {
      if (attempt >= 4) throw new Error(`${url}: ${err.message}`);
    }
    if (res && !res.ok && res.status !== 304) {
      await res.body?.cancel();
      if (res.status !== 429 && res.status < 500) throw new Error(`${url}: HTTP ${res.status}`);
      if (attempt >= 4) throw new Error(`${url}: HTTP ${res.status}`);
    }
    const wait = 1000 * 2 ** (attempt - 1);
    console.warn(`  retry ${attempt} for ${url} in ${wait / 1000} s`);
    await sleep(wait);
  }
}

