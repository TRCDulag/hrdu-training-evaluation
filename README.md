# HRDU System (Training Evaluation and Leave cards)

The HRDU System of the Human Resource Development Unit, DOH TRC Dulag. It has two modules so far, Training Evaluation (Level 1) and Leave cards, with one Sheet and one set of sign-ins. It is meant to become one module of the TRC Dulag Information System.

## Training Evaluation (Level 1)

The Training Evaluation Tool (Level 1) of the Human Resource Development Unit (HRDU), DOH TRC Dulag, as an app. Participants answer the form on their phone at the end of a training. HRDU types in the paper forms of those who answered on paper, and prints the summary of each training and the yearly report. The answers stay in a Google Sheet.

What it does:

1. **Trainings.** HRDU adds each training: title, dates, venue, who conducted it, the resource persons and how many participants are expected. Each one gets a code (TE-2026-001 and up, by year). Venue items the training did not have, like accommodation for an in-house training, can be left out so they are not asked.
2. **The participant's form.** Each training has its own link and QR code (Share link and QR code, or print the A5 QR poster). It opens the form on any phone, with no account and no name asked. The statements and the E / VS / S / P scale are worded as on the paper form. Every statement must be rated before the form can be sent. A participant who missed a resource person's session ticks "I did not attend this session" for that person. HRDU closes the online form when the evaluation period ends.
3. **Paper forms.** *Type in a paper form* copies a filled paper form into the Sheet as it is, blanks included. *Print blank form* prints the paper form with the title, date, venue and resource persons already filled in.
4. **Summary per training.** Number of respondents (against the expected), gender and province, the count of E, VS, S and P for every statement, the average (E = 4, VS = 3, S = 2, P = 1) and its rating, the average of each part, each resource person's ratings, part III (over all), and all the suggestions. It prints on A4 with the official header, Prepared by and Noted by.
5. **Yearly report.** The average of each part and of part III for every training in the year, for the L&D accomplishment report. Prints on A4 landscape and downloads for Excel.
6. **Records.** Nothing is deleted. A duplicate or wrong answer is voided by the Administrator with a reason, kept in the Sheet, and no longer counted. Every change goes to the Audit Trail with the person's name. A copy of the Sheet goes to Google Drive on the 1st of every month.

Ratings: 3.50 to 4.00 Excellent, 2.50 to 3.49 Very Satisfactory, 1.50 to 2.49 Satisfactory, 1.00 to 1.49 Poor.

Only HRDU staff have accounts, each with a role. **Administrator**: everything, with accounts, voiding and backups. **Staff**: add trainings, share links, open and close the online form and type in paper forms. **Viewer**: look and print only.

## Leave cards

Each employee's leave card, kept the way the CSC Omnibus Rules on Leave (CSC MC No. 41, s. 1998, as amended) say, and leave applications on Civil Service Form No. 6 (Revised 2020).

1. **Employees.** HRDU adds each employee: employee number, name, position, office, status of appointment, date of original appointment, salary, and the date the leave card starts with the VL and SL balances carried over from the old card.
2. **Earned credits.** Nobody types these in. Every full month earns 1.25 days of VL and 1.25 of SL, credited at the end of the month. A month with days without pay, or not fully in service, earns 1/30 less for each day (CSC table: 1 day without pay = 1.208).
3. **What HRDU records.** Leave taken, tardiness and undertime for the month (minutes, converted with the CSC table and charged to VL), absences without pay, monetization (at least 15 days of VL, 10 to 30 days a year, 5 left; or 50% or more for a valid reason), and, for the Administrator only, adjustments. Sick leave beyond the SL balance goes to VL, then without pay. Special privilege leave is capped at 3 days a year. A wrong line is voided by the Administrator with a reason, never deleted.
4. **Forced leave.** At year end, *Forced leave at year end* lists who had 10 or more days of VL and took fewer than 5. From January 1 the Administrator deducts what was not taken, dated December 31, and can leave out those whose leave the head cancelled for the service (with the reason).
5. **Leave applications (CS Form No. 6).** The employee applies from their phone or PC, or HRDU types in a paper application. HRDU picks who certifies (7.A), recommends (7.B) and approves (7.C/7.D) from drop-down lists, prints the form on long bond paper (8.5 x 13 in) for signing, then records the decision. An approved leave goes on the leave card by itself. 7.A shows the credits as of the end of the last credited month.
6. **Signatories.** The names in the drop-down lists. The Administrator adds them on the Accounts page with their position and what each one signs. The names stay in the Sheet only.
7. **Employee sign-in.** On an employee's card, *Sign-in account* makes their account (username = employee number) with a temporary password, or resets it. *Make sign-in accounts for everyone* does it for all active employees and prints password slips. An employee sees only their own leave card and applications. A separated employee's account is turned off.
8. **Printouts.** The leave card per year (Period, Particulars, VL and SL Earned, Abs. Und. W/P, Bal., Abs. Und. W/O P, and Date and Action Taken), and CS Form No. 6. *Download balances* gives everyone's balances for Excel.

Formula for monetization and terminal leave: monthly salary x days x 0.0481927 (CSC MC No. 2, s. 2016). The terminal leave tile uses the highest monthly salary and all VL and SL left.

Who can do what: **Employee** sees and prints their own leave card and applications, and applies for leave. **Viewer** looks at every leave card and prints. **Staff** adds employees, records on leave cards, types in and acts on applications, and makes employee accounts. **Administrator** also adjusts balances, voids lines, deducts forced leave and keeps the signatories.

## Files

| File | What it is |
|---|---|
| `index.html` | The page. Paste it into Apps Script as the HTML file `Index`. |
| `apps-script/Code.gs` | The Google Sheet backend. It also serves the page at the app link. |
| `Register/HRDU Training Evaluation Register.xlsx` | An empty Sheet with the tabs Trainings, Responses, Resource Person Ratings, Employees, Leave Ledger, Leave Applications, Signatories, Users and Audit Trail. |
| `src/index.src.html` | The page source without the logos (`npm run build` makes `index.html`). |
| `CHANGELOG.md` | What changed in each version (also under *What's new* in the app). |
| `dev/` | Tests, the local test server and the template builder. |

## Setup (one time, about 10 minutes)

1. **Make the Sheet.** In Google Drive, upload `HRDU Training Evaluation Register.xlsx`, open it and choose *File > Save as Google Sheets*. Use the new Google Sheet, not the xlsx.
2. **Add the script.** In the Sheet, go to *Extensions > Apps Script*.
   - In `Code.gs`, delete what is there and paste all of `apps-script/Code.gs`.
   - Click **+ > HTML** and name it `Index` (no `.html`). Delete what is there and paste all of `index.html`. Click Save.
   - In *Project Settings (gear)*, set the time zone to *(GMT+08:00) Manila* if it is not already.
3. **Run setup.** Pick `setup` in the function list at the top and click **Run**, then allow the permissions. It protects the tabs, makes the Drive folder *HRDU Training Evaluation Backups*, turns on the monthly backup and sets the setup passcode `HRDU_PASSCODE` to **1234**.
4. **Deploy.** *Deploy > New deployment > Web app*. *Execute as: Me*, *Who has access: Anyone*. Click Deploy and copy the URL that ends in `/exec`. That is the app link.
5. **First account.** Open the app link. Since there are no accounts yet, it asks for the setup passcode and makes the Administrator account. Then, under *Accounts*, add each HRDU staff member with a role. Each one gets a temporary password, shown once, and chooses their own at the first sign-in.

**After changing the script or the page:** *Deploy > Manage deployments > pencil > Version: New version > Deploy*. The link stays the same.

**Updating to 1.1.0 (Leave cards):** paste the new `Code.gs` and `index.html`, then run `setup` once more. It adds the tabs Employees, Leave Ledger, Leave Applications and Signatories and the Employee No. column in Users, and keeps all the training data. Then deploy a new version. On the Accounts page, add the signatories first.

**GitHub Pages.** The same page is also at https://trcdulag.github.io/hrdu-training-evaluation/ and talks to the /exec link (`DEFAULT_URL` in the page). The participants' links and QR codes point there (`#t=TE-2026-001`), because Google's own link can show "Sorry, unable to open the file" on a browser signed in to more than one Google account. Pages updates by itself when `index.html` changes on `main`. One time: the repo must be public (it holds no real data), then *Settings > Pages*, Source *Deploy from a branch*, Branch *main*, folder */ (root)*, Save.

## Day to day

- **Before the training:** add the training, then print the QR poster or copy the link for the group chat. Print blank forms for those without a phone.
- **At the end of the training:** show the QR code. Watch the answers come in on the training's page.
- **After:** type in the paper forms, close the online form, and print the summary for signing.
- A participant can also type the training code on the app's sign-in page.

## Tests

`npm test` runs the backend on a mock of Google services (the leave rules with the clock fixed at Oct 30, 2026). `npm run test:e2e` runs the page in a browser (Playwright) as HRDU and as a participant, and saves screenshots and sample printouts in `dev/screenshots`. `npm run dev` starts a local copy at http://localhost:8787 (setup passcode 1234).
