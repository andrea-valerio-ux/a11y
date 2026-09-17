# Accessibility Checklist Scanner

A local accessibility scanner organized around [The A11Y Project checklist](https://www.a11yproject.com/checklist/).
It opens a website in the Chrome already installed on this computer, checks every page at every screen width you
choose, and fills in the checklist: each of the 64 items is marked **failing**, **passing**, **needs a person** or
**not applicable**.

Every finding carries:

- a **screenshot** cropped to the spot on the page, with the element outlined in red and the surroundings dimmed;
- an **explanation** of what was measured (the colors and ratio, the element, the count);
- the **checklist item** and the **WCAG criterion** it fails, with what the rule is about and how to fix it;
- **links** to the W3C "Understanding" page for the criterion and to the item on the checklist, plus a share link;
- the **address** of every page, and the width, it was seen at.

Nothing is uploaded anywhere. Runs are kept in `~/a11y-checklist-runs/<site>/<date>/`.

## Requirements

Node 18 or later, and Google Chrome (or Microsoft Edge, Chromium or Brave). Set `CHROME_PATH` to choose a browser.

## Use

```bash
npm install
npm start            # opens the app at http://127.0.0.1:4173/?token=…
```

In the app: type a web address, choose how many pages and which widths, confirm you are authorized to scan the
site, and press **Start scan**. First time, press **Try the practice page**: a page served from this computer with
deliberate problems. A finished run shows the checklist; **Build files** writes the HTML, PDF, Excel, Word, CSV and JSON report
into the run folder, and **Compare with an earlier run** shows what was fixed, what is new and what got worse.

From the terminal:

```bash
node bin/a11y.js scan https://example.com --pages 5 --widths 1440,768,390
node bin/a11y.js report ~/a11y-checklist-runs/example.com/2026-09-16
node bin/a11y.js doctor
```

## Installing on another computer

Build the zips once, on a computer that has this folder and its `node_modules` installed:

```bash
npm run package
```

This writes three zips into `dist/`, one per kind of computer: Mac with Apple silicon, Mac with an Intel
processor, and Windows. Each zip contains the whole scanner, its dependencies, the practice page and its own
Node.js (the official build, verified against the checksums published by nodejs.org), so the person receiving it
installs nothing. Send them the zip for their computer.

On the other computer: unzip the folder anywhere and open `index.html`. It is the start page: a **Start the
scanner** button with a status line that says whether the scanner is running. For the button to be able to start
the scanner, double-click `launcher/Install launcher (Mac).command` or `launcher\Install launcher (Windows).bat`
once; it registers a small helper for `a11y-checklist://` links in the user's own account, no administrator
password needed. Without the helper, double-clicking **Start Accessibility Checklist Scanner** (`.command` on a
Mac, `.bat` on Windows) does the same thing in a terminal window. From the button the scanner runs in the background
and the same card offers **Stop the scanner**; from the Start file, closing its window stops it.
`READ ME FIRST.txt` inside the folder repeats these steps, including what to do if macOS or Windows asks before
running a downloaded file. Chrome or Edge must be installed; everything else is in the zip.

## Running it online

Two ways, both documented step by step:

- **Free, from a shared-hosting site** (`DEPLOY.md`): a page with the scan form on the site (`web/`), a small PHP
  file that asks GitHub to run the scan, and a workflow (`.github/workflows/scan.yml`) that scans on GitHub's free
  machines and uploads the reports back to the site by FTP.
- **On a server of your own** (`deploy/VPS.md`): the app as it is, listening on 127.0.0.1 behind Nginx, on a VPS or
  on the free machines from Oracle or Google. Install scripts for Ubuntu and AlmaLinux are in `deploy/`. Note that the app has no sign-in of its own: anyone who can open the address can scan, so the
Nginx config carries an optional password block.

## Design tokens

Every scan also records what the site is built from: the CSS custom properties declared in its stylesheets with
their raw and resolved values, the colors and typefaces actually painted (with the variables that produce them),
and the icon system in use (inline SVG, sprite, icon font or a library such as Font Awesome or Material Icons).
The app shows this in the **Design tokens** card; it is also written to `tokens.json` in the run folder and to the
**Tokens** sheet of the Excel report.

## What is checked

The 16 sections of the checklist and their items are in `src/checklist.js`, with the criterion, the explanation and
the fix for each. Measurement modules in `src/measure/` read the rendered page (they press Tab for real, sample
pixels behind text over images, zoom to 200%, reflow to 320px, switch on reduced motion and forced colors).
`src/rules/index.js` turns measurements into findings and decides each item's status.

Items a scanner cannot decide (reading level, images of text, error summaries after submission, proximity,
seizure triggers in video, orientation on a real device) are marked **needs a person**, with the relevant elements
listed so the check is quick.

## Run folder

```
run.json           what was scanned, when, checklist status per page and width
findings.json      every finding, worst first, with its screenshot path
checklist.json     the checklist with status, counts and pages per item
tokens.json        colors, typefaces, icon system and CSS variables seen across the run
measurements.json  raw measurements per page and width
shots/<page>-<width>/000-full-page.png and one image per finding
report/            report.html, .pdf, .xlsx, .docx, .csv, .json once built
```

## Test

```bash
npm test
```

Scans the practice page at two widths and checks that findings map to checklist items, that positioned findings
have screenshots, that the expected rules fire, and that the reports build.
