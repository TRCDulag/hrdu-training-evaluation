# CLAUDE.md

DOH TRC Dulag HRDU System: Training Evaluation (Level 1) and Leave cards (CSC rules, CS Form No. 6) modules. See README.md for how it works and how it is set up.

- `apps-script/Code.gs`: the Google Sheet backend. It also serves the page at the /exec link; `?t=TE-2026-001` opens that training's form.
- GitHub Pages serves `index.html` at https://trcdulag.github.io/hrdu-training-evaluation/ (participant links `#t=CODE`, `PUBLIC_URL` in the page). Keep real names and answers out of this repo; they live only in the Sheet.
- `src/index.src.html`: the page source. Run `npm run build` to write `index.html` (adds the logos and the QR library). `index.html` is what gets pasted into Apps Script as the HTML file `Index`.
- `Register/`: the empty Sheet template (made by `dev/make-register.py`).
- Tests: `npm test` (backend on a mock of Google services) and `npm run test:e2e` (browser, Playwright).
- Keep the statements and scale worded as on HRDU's paper "Training Evaluation Tool (Level 1)" (ITEMS and RP_CRITERIA in Code.gs).
- The participant's form is public: `evalInfo` and `submitEval` must never return other participants' answers or staff accounts. Answers are anonymous.
- Every other action needs a signed-in account (`session_`); its minimum role is in `NEED` in Code.gs (Employee, Viewer, Staff, Administrator). The server sets `req.by` from the session.
- An Employee account sees only its own leave card: `myLeave`, `fileLeave` and `cancelLeave` take the employee number from the account, never from the page. Keep CS Form No. 6 wording as on the form (LEAVE_TYPES and DETAILS in Code.gs), and signatory names out of this repo (Signatories tab only).
- Leave rules follow the CSC Omnibus Rules on Leave (MC No. 41, s. 1998, as amended) and MC No. 2, s. 2016; `dev/test-leave.js` checks the CSC tables.
- Each new version: bump `VERSION` (Code.gs), `APP_VERSION` (src/index.src.html) and package.json, and add the change to `CHANGES` in src/index.src.html and to CHANGELOG.md.
