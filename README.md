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
- **Import** straight from the FJFI website (Importovat → Z webu FJFI): pick the year (ročník), study program, specialization where offered and, when the program has more than one, the kruh. Timetables are recognized once during deployment; importing downloads a small JSON file without running OCR in the browser. The list is not hardcoded: it is read from rozvrh.fjfi.cvut.cz on every deploy (see [Automatic updates and deployment](#automatic-updates-and-deployment)).
- **Import** a timetable from a file (Importovat → Ze zařízení), by pasting (Ctrl+V) or by dropping it on the page:
  - our own PDF/PNG exports are restored exactly from the data embedded in them;
  - official PDFs/PNGs from rozvrh.fjfi.cvut.cz (or a screenshot of the whole table) are recognised:
    block positions, lengths, parallel lanes and colours come from the image, and subject, lecturer and room
    are read with OCR ([Tesseract.js](https://tesseract.projectnaptha.com/)). PDFs give the best results because
    they are rendered at high resolution; titles read from the small PNGs are worth double-checking.
  - lecturers and rooms read by OCR are matched against the official lists of teachers and classrooms
    (`src/import/known-names.ts`): a name 1–2 letters off a single known teacher becomes that teacher, with
    proper diacritics. The deployment workflow refreshes the lists automatically; `npm run update-names`
    does the same locally. Duplicated lecturer initials in faculty labels (`P. Novotný P` → `P. Novotný`)
    are cleaned during import and when saved timetables are loaded; distinct initials are preserved.
  - course codes are checked against currently offered regular courses in the official
    [ČVUT catalogue](https://bilakniha.cvut.cz/cs/f4-predmety.html) (`src/import/known-courses.ts`). The
    department prefix is mapped to the timetable abbreviation, such as `01MAN` → `MAN`. For an unknown
    reading of at least four characters, a unique match within one letter edit in the lesson's colour-coded
    department can bring different OCR passes into agreement. Up to two visual letter/digit confusions
    are also supported for codes of at least three characters (`S081` → `SOS1`, `CHicv` → `CH1cv`). A
    valid winning reading is kept; one digit is never replaced with another, and separators and suffixes
    such as `cv` and `.rez` are preserved. Short, unknown or ambiguous codes stay as read. This does not
    guess aliases for generic labels such as `JAZ.2`.
  - pdf.js and the OCR engine (~4 MB, from a CDN) load only when an import needs them.
    If single-line recognition returns no title, OCR retries that crop as a single word. Empty lecturer
    and room fields are not retried. Mixed-case exercise suffix misreads such as `FANA1cY` are normalized.
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
npm run sync-fjfi       # cache source PDFs and refresh bachelor choices
npm run preprocess-fjfi # recognize cached PDFs; publish JSON in public/fjfi/ for web imports
npm run check-programs  # does PROGRAMS in src/config.ts still match the website?
npm run update-courses # refresh the course-code dictionary from the official catalogue
```

## Automatic updates and deployment

GitHub Pages deploys on pushes to `main`, **15 February and 15 September at 04:23 UTC**, and on demand via
*Actions → Deploy to GitHub Pages → Run workflow*. The two scheduled refreshes pick up semester timetables
without a commit or a manual checklist. GitHub may delay scheduled runs. If the faculty publishes later than
the 15th, a manual run refreshes the copy immediately.

Every deployment run automatically:

1. Discovers the **bachelor’s and master’s year pages** from the FJFI navigation and mirrors their timetable
   PDFs into `.cache/fjfi/source/`, with a source manifest. Děčín, teacher training and language pages are
   skipped. Conditional requests reuse unchanged PDFs. Source documents stay in the build cache and are
   not published with the website.
2. Refreshes the manual editor’s bachelor **Obor** choices from the same manifest, including new, renamed
   and removed programs. The web import dialog lists both bachelor’s and master’s timetables.
3. Refreshes lecturer names, room codes and the course dictionary used to correct OCR. The course list
   follows the catalogue's academic year and includes regular courses offered in either semester;
   historical and doctoral entries are excluded. Course matching uses the bundled copy without contacting
   the catalogue from the browser.
4. Recognizes every timetable using the same OCR and correction logic as file imports. Recognition results
   are reused when the source PDF, recognition code, dictionaries and dependencies are unchanged. The
   complete validated set is published as content-hashed JSON files and a manifest in `public/fjfi/`.
   The November 2026 set contains 108 timetables and 1,969 lessons in about 208 KB of lesson JSON, instead
   of 70.7 MB of source PDFs. Selecting a timetable downloads only its JSON and creates a fresh editable tab.
   A first run does the full OCR pass; unchanged deployments reuse all results. The renderer
   (`@napi-rs/canvas`) is a development/build dependency and is not shipped to browsers.
5. Runs the tests and production build, then publishes the result. The Pages asset path follows the
   repository name automatically.

Program and OCR metadata are generated in the runner before building; they do not create bot commits or
maintenance PRs. The checked-in lists remain usable for local development without network access.
`npm run sync-fjfi` refreshes source timetables and bachelor choices locally, then
`npm run preprocess-fjfi` generates the JSON needed for web imports; `npm run update-names` refreshes OCR
lecturer/room metadata and `npm run update-courses` refreshes course codes. `npm run check-programs` is an
optional diagnostic for comparing local choices with the website. Invalid or empty catalogue data stops
the refresh before replacing the course dictionary.

On the first day of each month, a separate schedule in the same workflow **only renews the workflow via the
GitHub API** to prevent the 60-day public-repository inactivity shutdown. It skips the timetable fetch,
build and deployment. No personal token, external scheduler or dummy commits are needed. The existing
`github-pages` environment allows deployments from `main` without a reviewer’s approval.

Network requests have timeouts and retries. If FJFI is unavailable, a timetable is broken, parsing finds no
usable data, or a test/build fails, the deployment stops and **the existing live site stays available**. The
next semester refresh, push to `main` or manual run tries again. A faculty website redesign can require a
parser fix; recognition can also need correction for unusual source layouts. The failed Actions run contains the error. Workflows do not cancel a deployment that is already running.

## Licence

MIT
