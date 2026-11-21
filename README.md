# Jaderňácký Rozvrh

A lightweight web app for FJFI ČVUT ("Jaderka") students to build and edit their
own timetable, styled after the official schedules at
[rozvrh.fjfi.cvut.cz](https://rozvrh.fjfi.cvut.cz/rozvrh/studenti/bs1), and
download it as a PDF.

## Features

- Timetable grid laid out like the official one: Monday–Friday rows, 8:00–20:00 columns.
- Click any free hour slot to add a lesson; click a lesson to edit or delete it.
- Each lesson has a subject, classroom, lecturer, duration and colour.
- Lessons always start on a whole hour (10:00, 11:00, …) and end by 20:00.
- Colours follow the official scheme: one colour per department (katedra), labelled with its abbreviation (KM, KF, KHVJ, KIPL, KLFF, KMAT, KJCH, KDAIZ, KJR, KSI).
- Each schedule belongs to a study program (obor), picked from the published bachelor programs, and a kruh (–, 1, 2 or 3; the same choice for every program, since kruh counts change between years). The timetable shows them like the official one, without the year: `JCF1`, or just `FI_IPL` when the kruh is –.
- Click the ID in the timetable's top-left corner to type any ID by hand.
- Overlapping (parallel) lessons are stacked, as on the official timetable.
- Drag and drop lessons to another day or hour (snaps to whole hours); Alt + arrow keys do the same from the keyboard.
- Download as **PDF** (A4 landscape) or **PNG**, drawn like the official timetable.
- Exports carry the schedule data invisibly (PNG `tEXt` chunk, PDF Info entry), so they can be imported back later.
- **Import** straight from the FJFI website (Importovat → Z webu FJFI…): pick the year (ročník), study program and, when the program has more than one, the kruh. The list is not hardcoded: it is read from rozvrh.fjfi.cvut.cz on every deploy (see [Each semester](#each-semester)).
- **Import** a timetable from a file (Importovat → Ze zařízení…), by pasting (Ctrl+V) or by dropping it on the page:
  - our own PDF/PNG exports are restored exactly from the data embedded in them;
  - official PDFs/PNGs from rozvrh.fjfi.cvut.cz (or a screenshot of the whole table) are recognised:
    block positions, lengths, parallel lanes and colours come from the image, and subject, lecturer and room
    are read with OCR ([Tesseract.js](https://tesseract.projectnaptha.com/)). PDFs give the best results because
    they are rendered at high resolution; titles read from the small PNGs are worth double-checking.
  - lecturers and rooms read by OCR are matched against the official lists of teachers and classrooms
    (`src/import/known-names.ts`): a name 1–2 letters off a single known teacher becomes that teacher, with
    proper diacritics. Refresh the lists each semester with `npm run update-names` (see [Each semester](#each-semester)).
  - pdf.js and the OCR engine (~4 MB, from a CDN) load only when an import needs them.
- Several schedules (e.g. one per semester) are kept side by side as tabs: click a tab to switch, double-click it (or press F2) to rename it, `+` adds a new one. Everything is saved in the browser (`localStorage`).

Built with plain TypeScript and [Vite](https://vite.dev); no UI framework.

## Privacy & security

No telemetry, no accounts, no server: timetables live only in your browser, and imported files are processed on
your device. The app is open source (MIT), and the deployed site is built straight from this repository. Details,
including the one third-party download (the OCR engine, from a CDN), and how to report a security problem are in
[SECURITY.md](SECURITY.md).

## Development

```sh
npm install
npm run dev        # local dev server
npm run typecheck  # TypeScript checks
npm test           # unit tests (Vitest)
npm run build      # production build into dist/
npm run fetch-fjfi      # copy the official timetables into public/fjfi/ (needed for "Z webu FJFI" in dev)
npm run check-programs  # does PROGRAMS in src/config.ts still match the website?
```

Pushes to `main` deploy to GitHub Pages via `.github/workflows/pages.yml`; the workflow can also be started by
hand (Actions → Deploy to GitHub Pages → Run workflow). Before building it runs `scripts/fetch-fjfi.mjs`, which
reads the years, programs and kruhy from the navigation and tables of contents on rozvrh.fjfi.cvut.cz and copies
every timetable PDF next to the app (`public/fjfi/` with `manifest.json`). The FJFI site sends no CORS headers, so
the browser cannot fetch the files from there directly. Nothing about the list is hardcoded: new programs or kruhy
show up with the next deploy. There is no schedule; the copy is as fresh as the last deploy, so refresh it at the
start of each semester as described below.

## Each semester

The faculty publishes the new timetables before each semester, usually around the **3rd Monday of February**
(summer semester) and the **4th Monday of September** (winter semester). Once they are up on
[rozvrh.fjfi.cvut.cz](https://rozvrh.fjfi.cvut.cz/rozvrh/studenti/bs1):

1. **Refresh the timetables on the site.** On GitHub open *Actions → Deploy to GitHub Pages → Run workflow*
   (branch `main`) and wait for it to finish (about 2–3 minutes). Any push to `main` does the same.
   - The **build** job's *Run npm run fetch-fjfi* step ends with a line like
     `5 years, 107 programs, 117 timetables (72.8 MB; …) → public/fjfi/`. If it fails with
     `… (redesign?)`, the faculty changed the website's layout and `scripts/fjfi-site.mjs` needs adjusting
     (the parsing is covered by `tests/fjfi-sync.test.ts`; save a fresh page into `tests/fixtures/` to reproduce).
     The deploy is skipped in that case, so the site keeps the previous copy.
2. **Check the Obor list.** The **check-programs** job in the same run compares the program codes in
   `PROGRAMS` (`src/config.ts`) with the bachelor programs on the website. If it fails, its log lists what
   changed, e.g. `+ XYZ (name) — on the website, missing in the app` or `- XYZ — in the app, no longer on the
   website`. Add or remove those entries in `PROGRAMS` (keep them sorted by name) and commit; `npm run
   check-programs` runs the same check locally.
3. **Refresh lecturers and rooms** used to correct OCR: run `npm run update-names`, check the diff of
   `src/import/known-names.ts`, then run `npm test` and commit.
4. **Spot-check the app:** *Importovat → Z webu FJFI…* should say "Seznam převzat z webu FJFI <today's date>",
   and importing your own timetable should work.

## Licence

MIT
