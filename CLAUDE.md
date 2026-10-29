# CLAUDE.md

DOH TRC Dulag HRDU Training Evaluation (Level 1) app. See README.md for how it works and how it is set up.

- `apps-script/Code.gs`: the Google Sheet backend. It also serves the page at the /exec link; `?t=TE-2026-001` opens that training's form.
- GitHub Pages serves `index.html` at https://trcdulag.github.io/hrdu-training-evaluation/ (participant links `#t=CODE`, `PUBLIC_URL` in the page). Keep real names and answers out of this repo; they live only in the Sheet.
- `src/index.src.html`: the page source. Run `npm run build` to write `index.html` (adds the logos and the QR library). `index.html` is what gets pasted into Apps Script as the HTML file `Index`.
- `Register/`: the empty Sheet template (made by `dev/make-register.py`).
- Tests: `npm test` (backend on a mock of Google services) and `npm run test:e2e` (browser, Playwright).
- Keep the statements and scale worded as on HRDU's paper "Training Evaluation Tool (Level 1)" (ITEMS and RP_CRITERIA in Code.gs).
- The participant's form is public: `evalInfo` and `submitEval` must never return other participants' answers or staff accounts. Answers are anonymous.
- Every other action needs a signed-in HRDU account (`session_`); its minimum role is in `NEED` in Code.gs (Viewer, Staff, Administrator). The server sets `req.by` from the session.
- Each new version: bump `VERSION` (Code.gs), `APP_VERSION` (src/index.src.html) and package.json, and add the change to `CHANGES` in src/index.src.html and to CHANGELOG.md.
