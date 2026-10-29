# HRDU Training Evaluation (Level 1)

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

## Files

| File | What it is |
|---|---|
| `index.html` | The page. Paste it into Apps Script as the HTML file `Index`. |
| `apps-script/Code.gs` | The Google Sheet backend. It also serves the page at the app link. |
| `Register/HRDU Training Evaluation Register.xlsx` | An empty Sheet with the tabs Trainings, Responses, Resource Person Ratings, Users and Audit Trail. |
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

## Day to day

- **Before the training:** add the training, then print the QR poster or copy the link for the group chat. Print blank forms for those without a phone.
- **At the end of the training:** show the QR code. Watch the answers come in on the training's page.
- **After:** type in the paper forms, close the online form, and print the summary for signing.
- A participant can also type the training code on the app's sign-in page.

## Tests

`npm test` runs the backend on a mock of Google services. `npm run test:e2e` runs the page in a browser (Playwright) as HRDU and as a participant, and saves screenshots and sample printouts in `dev/screenshots`. `npm run dev` starts a local copy at http://localhost:8787 (setup passcode 1234).
