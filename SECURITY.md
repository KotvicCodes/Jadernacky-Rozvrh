# Privacy & security

Jaderňácký Rozvrh is a static web page. There is no server, no account and no database behind it.

## Privacy

- **No telemetry.** No analytics, tracking scripts, cookies or ads. The app does not report anything about you or how you use it.
- **Local first.** Your timetables are stored only in your own browser (`localStorage`). Nothing is uploaded anywhere. Clearing the site's data in your browser deletes them, and other devices never see them.
- **Imports stay on your device.** PDFs and images you import (by button, paste or drag and drop) are read and recognised by your browser. They are never sent anywhere.
- **Exports carry your data.** Downloaded PDF/PNG files contain the timetable data invisibly, so they can be imported back later. Anyone you send the file to can read that data, just like the visible timetable.
- **Network requests:**
  - The page itself is served by [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/about-github-pages#data-collection). Like any web host, GitHub sees the usual request data (such as your IP address) when you open it.
  - Website imports fetch preprocessed timetable JSON from this site; no OCR engine download is needed.
  - The first time you import an official timetable file from your device (an image or PDF read with OCR), the browser downloads the [Tesseract.js](https://github.com/naptha/tesseract.js) text-recognition engine and its English language data (~4 MB) from the [jsDelivr](https://www.jsdelivr.com/terms/privacy-policy-jsdelivr-net) CDN.
  - Only those library files are fetched. Your timetable or image is not sent.
  - Re-importing the app's own PDF/PNG exports needs no download.

## Open source

The whole app is open source under the [MIT licence](LICENSE): everything above can be checked in this repository. The deployed site is built from the `main` branch by [`.github/workflows/pages.yml`](.github/workflows/pages.yml), so what runs at the published address is exactly the code you see here.

## Reporting a security problem

Only the latest version (the `main` branch, which is what is deployed) is supported.

If you find a security problem, for example a way for a crafted file to run code when it is imported:

- If the repository's **Security** tab offers **"Report a vulnerability"**, please use it. The report stays private until it is fixed.
- Otherwise open an [issue](https://github.com/KotvicCodes/Jadernacky-Rozvrh/issues) saying that you found a security problem, **without the details**, and you will be contacted to share them privately.

Ordinary bugs are welcome as normal issues or pull requests.
