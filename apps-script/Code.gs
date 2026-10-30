/**
 * HRDU System - backend for the "Index" page. Two modules of the Human Resource Development Unit
 * of DOH TRC Dulag so far:
 *   - Training Evaluation (Level 1): the trainings and the participants' answers, for the summary
 *     report of each training and the yearly report.
 *   - Leave cards: each employee's leave card under the CSC Omnibus Rules on Leave, and leave
 *     applications on CS Form No. 6 (Revised 2020). Employees sign in to see their own card and apply.
 *
 * SETUP (one time, in the "HRDU Training Evaluation Register" Google Sheet):
 *   1. Extensions > Apps Script. Delete what is in Code.gs and paste this whole file.
 *   2. Click + (Add a file) > HTML, name it  Index  (no ".html"), delete what is
 *      there and paste the whole of index.html. Save.
 *   3. Pick "setup" in the function list at the top and click Run. Allow the
 *      permissions. It makes any missing tab, protects the tabs, sets the Manila
 *      time zone, turns on the monthly backup and sets the setup passcode
 *      (HRDU_PASSCODE) to 1234.
 *   4. Deploy > New deployment > type: Web app.
 *        Execute as: Me      Who has access: Anyone
 *      Click Deploy and copy the Web app URL (ends in /exec). That is the app link.
 *   5. Open the app. The first time, it asks for the setup passcode and makes the
 *      Administrator account. The Administrator then adds the HRDU staff under Accounts.
 *
 * UPDATING an existing deployment (keeps the same URL):
 *   Deploy > Manage deployments > pencil icon > Version: New version > Deploy.
 *
 * PARTICIPANTS need no account. Each training has its own link (the /exec link with
 * ?t=TE-2026-001 at the end) and QR code. The answers are anonymous: no name is asked.
 *
 * RECORD CONTROL:
 *   - Every tab is protected so only the Sheet owner can edit it by hand; the page writes
 *     through this script, and only for a signed-in HRDU user whose role allows it.
 *   - Nothing is deleted. A wrong or duplicate response is Voided (with a reason) and kept.
 *   - Every change goes to the Audit Trail tab with the server time and the person's name.
 *   - On the 1st of every month at about 6 AM a copy of this Sheet goes to the Drive folder
 *     "HRDU Training Evaluation Backups". The Administrator can also back up from the app.
 */

const TZ = 'Asia/Manila';
const VERSION = '1.1.0';
const FORM = { title: 'Training Evaluation Tool (Level 1)' };

const TRAININGS = 'Trainings', RESP = 'Responses', RP = 'Resource Person Ratings', USERS = 'Users', AUDIT = 'Audit Trail';
const BACKUP_FOLDER = 'HRDU Training Evaluation Backups';

// The rating scale on the form, with the points used for the averages.
const SCALE = { 'E': 4, 'VS': 3, 'S': 2, 'P': 1 };

// The statements of the form, worded as on the paper form.
const ITEMS = [
  { id: 'p1', sec: 'I', no: '1', text: 'The SO/Invitation letter was provided on time' },
  { id: 'p2', sec: 'I', no: '2', text: 'Give enough information on Administrative matters pertaining to the training (Accommodation/advisor, Etc)' },
  { id: 'c1', sec: 'II.A', no: '1', text: 'The objectives of the sessions/training were clearly defined and met' },
  { id: 'c2', sec: 'II.A', no: '2', text: 'The topics covered were relevant and useful' },
  { id: 'c3', sec: 'II.A', no: '3', text: 'The training methodologies used were appropriate' },
  { id: 'c4', sec: 'II.A', no: '4', text: 'There was sufficient opportunity for interactive participation' },
  { id: 'c5', sec: 'II.A', no: '5', text: 'The schedule for the training provided sufficient time to cover all of the proposed activities' },
  { id: 'c6', sec: 'II.A', no: '6', text: 'The resource materials were available, adequate and appropriate' },
  { id: 'v1', sec: 'II.B', no: '1', text: 'Function Room' },
  { id: 'v2', sec: 'II.B', no: '2', text: 'Food' },
  { id: 'v3', sec: 'II.B', no: '3', text: 'Accommodation' },
  { id: 'v4', sec: 'II.B', no: '4', text: 'The staff provided quality service (check to the needs of the clients)' },
  { id: 'v5', sec: 'II.B', no: '5', text: 'Equipment/Facilities' }
];
const SECTIONS = { 'I': 'Preparation for the Activity', 'II.A': 'Content and Delivery',
  'II.B': 'Training Venue (refer to the standard requirement for training venue)', 'II.C': 'Resource Person/Facilitators' };
const RP_CRITERIA = [
  { id: 'r1', text: 'Well prepared & knowledgeable on the topic/session' },
  { id: 'r2', text: 'Was able to draw & sustain interest of the participants' },
  { id: 'r3', text: 'Able address questions/issues correctly & appropriately' },
  { id: 'r4', text: 'Adequately utilized variety of training methods' },
  { id: 'r5', text: 'Appropriately dressed' }
];
const GENDERS = ['Male', 'Female', 'Prefer not to say'];
const PROVINCES = ['Leyte', 'Southern Leyte', 'Biliran', 'Samar', 'Eastern Samar', 'Northern Samar'];

const TRAINING_HEADERS = ['Training Code', 'Title of Activity', 'Date From', 'Date To', 'Venue', 'Conducted By',
  'Resource Persons', 'Venue Items Not Rated', 'Expected Participants', 'Status', 'Remarks',
  'Created At', 'Created By', 'Updated At', 'Updated By'];
const RESP_HEADERS = ['Response No.', 'Training Code', 'Submitted At', 'Source', 'Encoded By', 'Province', 'Gender']
  .concat(ITEMS.map(it => it.sec + '.' + it.no + ' ' + it.text))
  .concat(['III Over all', 'Suggestions / Recommendations', 'Record Status', 'Void Reason', 'Device']);
const RP_HEADERS = ['Response No.', 'Training Code', 'Resource Person'].concat(RP_CRITERIA.map(c => c.text)).concat(['Record Status']);
const USER_HEADERS = ['Username', 'Full Name', 'Position', 'Role', 'Status', 'Password', 'Must Change Password',
  'Last Sign-in', 'Created At', 'Created By', 'Updated At', 'Employee No.'];
const AUDIT_HEADERS = ['Timestamp', 'Reference', 'Action', 'By', 'Details', 'Device'];

// Employee accounts see only their own leave card. Viewer, Staff and Administrator are HRDU staff.
const ROLES = { 'Employee': 1, 'Viewer': 2, 'Staff': 3, 'Administrator': 4 };
const ADMIN = 'Administrator';
const STAFF_ROLES = ['Administrator', 'Staff', 'Viewer'];
// The lowest role that may do each action. Anything not listed is refused.
const NEED = { me: 'Employee', signOut: 'Employee', changePassword: 'Employee', myLeave: 'Employee', fileLeave: 'Employee', cancelLeave: 'Employee',
  load: 'Viewer', leaveLoad: 'Viewer', leaveCard: 'Viewer', forcedPreview: 'Viewer',
  saveTraining: 'Staff', setStatus: 'Staff', encodeResponse: 'Staff', saveEmployee: 'Staff', saveEntry: 'Staff', empAccount: 'Staff', actOnLeave: 'Staff',
  voidResponse: ADMIN, voidEntry: ADMIN, postForced: ADMIN, saveSigner: ADMIN, listUsers: ADMIN, saveUser: ADMIN, backupNow: ADMIN };
const SESSION_SECONDS = 6 * 3600;
const STATUSES = ['Open', 'Closed'];

const T = idx_(TRAINING_HEADERS), R = idx_(RESP_HEADERS), RPI = idx_(RP_HEADERS), U = idx_(USER_HEADERS);
const R_ITEM0 = R[RESP_HEADERS[7]];   // first rating column in Responses
const RP_C0 = 3;                      // first rating column in Resource Person Ratings

// ---------- web entry points ----------

// The page. A link that ends in ?t=TE-2026-001 opens the evaluation form of that training.
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.ping) return json_({ ok: true, message: 'HRDU Training Evaluation script is running.', version: VERSION });
  let html = HtmlService.createHtmlOutputFromFile('Index').getContent();
  const code = codeOf_(p.t);
  if (code) html = html.replace('/*BOOT*/""', JSON.stringify(code));
  return HtmlService.createHtmlOutput(html)
    .setTitle(code ? 'Training Evaluation' : 'HRDU System')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// Used when index.html is opened from a PC or a web host (not through the /exec link).
function doPost(e) {
  return json_(handle_(JSON.parse((e && e.postData && e.postData.contents) || '{}')));
}

// Used by the page when it is opened through the /exec link.
function api(reqJson) {
  return JSON.stringify(handle_(JSON.parse(reqJson || '{}')));
}

function handle_(req) {
  try {
    if (req.action === 'ping') return { ok: true, version: VERSION };
    // Open to everyone: the participant's evaluation form and the sign-in.
    if (req.action === 'publicInit') return publicInit_();
    if (req.action === 'evalInfo')   return evalInfo_(req.code);
    if (req.action === 'submitEval') return submitEval_(req);
    if (req.action === 'signIn')     return signIn_(req);
    if (req.action === 'firstHead')  return firstHead_(req);
    // Everything else is for a signed-in account whose role allows it.
    const me = session_(req.token);
    if (!NEED[req.action]) return { ok: false, error: 'Unknown action.' };
    if (me.mustChange && req.action !== 'changePassword' && req.action !== 'signOut') throw new Error('Please change your temporary password first.');
    if (ROLES[me.role] < ROLES[NEED[req.action]]) throw new Error('Your role (' + me.role + ') cannot do this. Please ask the Administrator.');
    req.by = me.name;   // the Audit Trail always names the signed-in person
    req.me = me;
    switch (req.action) {
      case 'me':             return { ok: true, me: publicMe_(me) };
      case 'signOut':        return signOut_(req.token);
      case 'changePassword': return changePassword_(req);
      case 'load':           return Object.assign(load_(), { me: publicMe_(me) });
      case 'saveTraining':   return saveTraining_(req);
      case 'setStatus':      return setStatus_(req);
      case 'encodeResponse': return encodeResponse_(req);
      case 'voidResponse':   return voidResponse_(req);
      case 'listUsers':      return listUsers_();
      case 'saveUser':       return saveUser_(req);
      case 'backupNow':      return withLock_(() => backupNow_(me.name));
      case 'myLeave':        return myLeave_(me);
      case 'leaveLoad':      return leaveLoad_();
      case 'leaveCard':      return leaveCard_(req.empNo);
      case 'forcedPreview':  return { ok: true, year: Number(req.year), rows: forcedRows_(Number(req.year)) };
      case 'saveEmployee':   return saveEmployee_(req);
      case 'saveEntry':      return saveEntry_(req);
      case 'voidEntry':      return voidEntry_(req);
      case 'postForced':     return postForced_(req);
      case 'empAccount':     return empAccount_(req);
      case 'fileLeave':      return fileLeave_(req);
      case 'actOnLeave':     return actOnLeave_(req);
      case 'cancelLeave':    return cancelLeave_(req);
      case 'saveSigner':     return saveSigner_(req);
      default:               return { ok: false, error: 'Unknown action.' };
    }
  } catch (err) {
    return err.signIn ? { ok: false, error: String(err.message), signIn: true } : { ok: false, error: String(err.message || err) };
  }
}

// ---------- what the page needs ----------

function form_() {
  return { title: FORM.title, items: ITEMS, sections: SECTIONS, rp: RP_CRITERIA, scale: Object.keys(SCALE), genders: GENDERS, provinces: PROVINCES };
}

function load_() {
  const trainings = readRows_(TRAININGS, TRAINING_HEADERS).map(toTraining_);
  const responses = readRows_(RESP, RESP_HEADERS).map(toResponse_);
  const byNo = {};
  responses.forEach(r => byNo[r.no] = r);
  readRows_(RP, RP_HEADERS).forEach(row => {
    const r = byNo[String(row[RPI['Response No.']])];
    if (r) r.rp.push({ name: String(row[RPI['Resource Person']]), ratings: RP_CRITERIA.map((c, i) => String(row[RP_C0 + i] || '')) });
  });
  const props = PropertiesService.getScriptProperties();
  return { ok: true, version: VERSION, form: form_(), trainings: trainings, responses: responses, today: fmtDate_(new Date()), appUrl: appUrl_(),
    backup: { last: props.getProperty('LAST_BACKUP') || '', url: props.getProperty('LAST_BACKUP_URL') || '' } };
}

// What the sign-in card needs. No names.
function publicInit_() {
  const us = SpreadsheetApp.getActive().getSheetByName(USERS);
  return { ok: true, version: VERSION, needsSetup: !us || lastRow_(us) < 2 };
}

// What a participant's phone shows for a training. Title, dates, venue and the resource persons
// (they are on the paper form too). Nothing about the other participants.
function evalInfo_(code) {
  code = codeOf_(code);
  if (!code) return { ok: false, error: 'That is not a training code. Codes look like TE-2026-001.' };
  const f = findTraining_(code);
  if (!f) return { ok: false, error: 'No training has the code ' + code + '. Please check the code with HRDU.' };
  const t = toTraining_(f.row);
  return { ok: true, form: form_(), training: { code: t.code, title: t.title, dateFrom: t.dateFrom, dateTo: t.dateTo, venue: t.venue,
    conductedBy: t.conductedBy, speakers: t.speakers, skip: t.skip, status: t.status } };
}

// A participant's answers from the evaluation form. Every statement must be rated.
function submitEval_(req) {
  const a = req.answers || {};
  const code = codeOf_(req.code);
  throttle_();
  return withLock_(() => {
    const f = code && findTraining_(code);
    if (!f) throw new Error('This training is not in the list. Please check the link with HRDU.');
    const t = toTraining_(f.row);
    if (t.status !== 'Open') throw new Error('The evaluation for this training is closed. Please ask HRDU for a paper form.');
    const out = saveResponse_(t, a, true, 'Online', '', req.device);
    return { ok: true, no: out.no };
  });
}

// HRDU types in a filled paper form. Blank answers are allowed, since a paper form can have them.
function encodeResponse_(req) {
  return withLock_(() => {
    const code = codeOf_(req.code);
    const f = code && findTraining_(code);
    if (!f) throw new Error('No training has the code ' + req.code + '.');
    const out = saveResponse_(toTraining_(f.row), req.answers || {}, false, 'Paper form', req.by, req.device);
    audit_(out.no, 'PAPER FORM ENCODED', req.by, code, req.device);
    return Object.assign(load_(), { no: out.no });
  });
}

function saveResponse_(t, a, strict, source, by, device) {
  const pick = (v, list) => list.indexOf(String(v || '')) >= 0 ? String(v) : '';
  const rate = v => SCALE[String(v || '')] ? String(v) : '';
  const row = new Array(RESP_HEADERS.length).fill('');
  row[R['Training Code']] = t.code;
  row[R['Submitted At']] = new Date();
  row[R['Source']] = source;
  row[R['Encoded By']] = by || '';
  row[R['Province']] = clean_(a.province).slice(0, 80);
  row[R['Gender']] = pick(a.gender, GENDERS);
  if (strict && !row[R['Gender']]) throw new Error('Please pick your gender.');
  if (strict && !row[R['Province']]) throw new Error('Please type your province.');
  const r = a.ratings || {};
  ITEMS.forEach((it, i) => {
    const skip = t.skip.indexOf(it.id) >= 0;
    const v = skip ? '' : rate(r[it.id]);
    if (strict && !skip && !v) throw new Error('Please rate every statement. Item ' + it.sec + '.' + it.no + ' (' + it.text + ') has no answer yet.');
    row[R_ITEM0 + i] = skip ? 'N/A' : v;
  });
  row[R['III Over all']] = rate(a.overall);
  if (strict && !row[R['III Over all']]) throw new Error('Please rate the training as a whole (part III).');
  row[R['Suggestions / Recommendations']] = clean_(a.suggestions).slice(0, 1500);
  row[R['Record Status']] = 'Valid';
  row[R['Device']] = String(device || '').slice(0, 200);
  // The resource persons: only those listed for the training. A participant may skip one they did not hear.
  const rps = [];
  (a.rp || []).forEach(x => {
    const name = String((x && x.name) || '');
    if (t.speakers.indexOf(name) < 0 || x.skip) return;
    const vals = RP_CRITERIA.map(c => rate((x.ratings || {})[c.id]));
    if (strict && vals.some(v => !v)) throw new Error('Please rate all five items for ' + name + ', or tick that you did not attend the session.');
    if (vals.some(v => v)) rps.push([name].concat(vals));
  });
  const sh = sheet_(RESP);
  const no = nextResponseNo_(sh, t.code);
  row[R['Response No.']] = no;
  const at = lastRow_(sh) + 1;
  sh.getRange(at, 1, 1, RESP_HEADERS.length).setNumberFormat('@');
  sh.getRange(at, R['Submitted At'] + 1).setNumberFormat('mmm d, yyyy h:mm am/pm');
  sh.getRange(at, 1, 1, RESP_HEADERS.length).setValues([row]);
  if (rps.length) {
    const rs = sheet_(RP), rr = lastRow_(rs) + 1;
    const rows = rps.map(x => [no, t.code].concat(x).concat(['Valid']));
    rs.getRange(rr, 1, rows.length, RP_HEADERS.length).setNumberFormat('@');
    rs.getRange(rr, 1, rows.length, RP_HEADERS.length).setValues(rows);
  }
  return { no: no };
}

// TE-2026-001-001, TE-2026-001-002, ... per training.
function nextResponseNo_(sh, code) {
  const n = lastRow_(sh);
  let max = 0;
  if (n >= 2) sh.getRange(2, 1, n - 1, 1).getValues().forEach(v => {
    const s = String(v[0]);
    if (s.indexOf(code + '-') === 0) max = Math.max(max, Number(s.slice(code.length + 1)) || 0);
  });
  return code + '-' + String(max + 1).padStart(3, '0');
}

// A new training, or a change to one. New ones get the next code for the year of the training.
function saveTraining_(req) {
  const t = req.training || {};
  if (!clean_(t.title)) throw new Error('Title of Activity is required.');
  const from = toDate_(t.dateFrom);
  if (!from) throw new Error('Date (from) is required.');
  const to = toDate_(t.dateTo) || from;
  if (to < from) throw new Error('The end date is before the start date.');
  const speakers = (Array.isArray(t.speakers) ? t.speakers : String(t.speakers || '').split('\n'))
    .map(s => clean_(s).replace(/\|/g, '/').slice(0, 120)).filter(Boolean);
  if (new Set(speakers).size !== speakers.length) throw new Error('A resource person is listed twice.');
  if (speakers.length > 20) throw new Error('At most 20 resource persons per training.');
  const skip = (t.skip || []).filter(id => ITEMS.some(it => it.id === id && it.sec === 'II.B'));
  return withLock_(() => {
    const sh = sheet_(TRAININGS);
    const stamp = new Date();
    let f = t.code ? findTraining_(codeOf_(t.code)) : null, row, at, isNew = !t.code;
    if (isNew) {
      row = new Array(TRAINING_HEADERS.length).fill('');
      row[T['Training Code']] = nextTrainingCode_(sh, from);
      row[T['Status']] = 'Open';
      row[T['Created At']] = stamp; row[T['Created By']] = req.by;
      at = lastRow_(sh) + 1;
    } else {
      if (!f) throw new Error('No training has the code ' + t.code + '.');
      row = f.row; at = f.r;
      // Resource persons already rated stay on the list, so their ratings keep a name on the form.
      const rated = readRows_(RP, RP_HEADERS).filter(x => x[RPI['Training Code']] === row[T['Training Code']]).map(x => String(x[RPI['Resource Person']]));
      const gone = splitList_(row[T['Resource Persons']]).filter(n => speakers.indexOf(n) < 0 && rated.indexOf(n) >= 0);
      if (gone.length) throw new Error(gone.join(', ') + ' already has ratings, so the name cannot be removed or changed.');
    }
    row[T['Title of Activity']] = clean_(t.title).slice(0, 300);
    row[T['Date From']] = from; row[T['Date To']] = to;
    row[T['Venue']] = clean_(t.venue).slice(0, 200);
    row[T['Conducted By']] = clean_(t.conductedBy).slice(0, 200);
    row[T['Resource Persons']] = speakers.join(' | ');
    row[T['Venue Items Not Rated']] = skip.join(',');
    row[T['Expected Participants']] = Math.max(0, Math.round(Number(t.expected) || 0)) || '';
    row[T['Remarks']] = clean_(t.remarks).slice(0, 500);
    row[T['Updated At']] = stamp; row[T['Updated By']] = req.by;
    sh.getRange(at, 1, 1, TRAINING_HEADERS.length).setNumberFormat('@');
    ['Date From', 'Date To'].forEach(k => sh.getRange(at, T[k] + 1).setNumberFormat('mmm d, yyyy'));
    ['Created At', 'Updated At'].forEach(k => sh.getRange(at, T[k] + 1).setNumberFormat('mmm d, yyyy h:mm am/pm'));
    sh.getRange(at, T['Expected Participants'] + 1).setNumberFormat('0');
    sh.getRange(at, 1, 1, TRAINING_HEADERS.length).setValues([row]);
    audit_(row[T['Training Code']], isNew ? 'TRAINING ADDED' : 'TRAINING UPDATED', req.by, row[T['Title of Activity']], req.device);
    return Object.assign(load_(), { code: row[T['Training Code']] });
  });
}

// Open or close the online form of a training.
function setStatus_(req) {
  if (STATUSES.indexOf(req.status) < 0) throw new Error('Pick Open or Closed.');
  return withLock_(() => {
    const f = findTraining_(codeOf_(req.code));
    if (!f) throw new Error('No training has the code ' + req.code + '.');
    if (f.row[T['Status']] !== req.status) {
      f.row[T['Status']] = req.status;
      f.row[T['Updated At']] = new Date(); f.row[T['Updated By']] = req.by;
      sheet_(TRAININGS).getRange(f.r, 1, 1, TRAINING_HEADERS.length).setValues([f.row]);
      audit_(f.row[T['Training Code']], req.status === 'Open' ? 'EVALUATION OPENED' : 'EVALUATION CLOSED', req.by, '', req.device);
    }
    return load_();
  });
}

// Administrator only: a wrong or duplicate response is marked Voided with the reason, never deleted.
function voidResponse_(req) {
  const why = clean_(req.reason);
  if (!why) throw new Error('Give the reason for voiding.');
  return withLock_(() => {
    const sh = sheet_(RESP), r = findRow_(sh, String(req.no || ''));
    if (!r) throw new Error('No response has the number ' + req.no + '.');
    if (sh.getRange(r, R['Record Status'] + 1).getValue() === 'Voided') throw new Error('This response is already voided.');
    sh.getRange(r, R['Record Status'] + 1, 1, 2).setValues([['Voided', why.slice(0, 300)]]);
    const rs = sheet_(RP), n = lastRow_(rs);
    if (n >= 2) rs.getRange(2, 1, n - 1, 1).getValues().forEach((v, i) => { if (v[0] === req.no) rs.getRange(i + 2, RP_HEADERS.length).setValue('Voided'); });
    audit_(req.no, 'RESPONSE VOIDED', req.by, why, req.device);
    return load_();
  });
}

function nextTrainingCode_(sh, date) {
  const y = Utilities.formatDate(date, TZ, 'yyyy'), pre = 'TE-' + y + '-';
  const n = lastRow_(sh);
  let max = 0;
  if (n >= 2) sh.getRange(2, 1, n - 1, 1).getValues().forEach(v => {
    const s = String(v[0]);
    if (s.indexOf(pre) === 0) max = Math.max(max, Number(s.slice(pre.length)) || 0);
  });
  return pre + String(max + 1).padStart(3, '0');
}

function findTraining_(code) {
  if (!code) return null;
  const sh = sheet_(TRAININGS), r = findRow_(sh, code);
  return r ? { r: r, row: sh.getRange(r, 1, 1, TRAINING_HEADERS.length).getValues()[0] } : null;
}

function toTraining_(r) {
  return { code: String(r[T['Training Code']]), title: show_(r[T['Title of Activity']]), dateFrom: fmtDate_(r[T['Date From']]),
    dateTo: fmtDate_(r[T['Date To']]), venue: show_(r[T['Venue']]), conductedBy: show_(r[T['Conducted By']]),
    speakers: splitList_(r[T['Resource Persons']]), skip: String(r[T['Venue Items Not Rated']] || '').split(',').filter(Boolean),
    expected: Number(r[T['Expected Participants']]) || 0, status: STATUSES.indexOf(r[T['Status']]) >= 0 ? String(r[T['Status']]) : 'Closed',
    remarks: show_(r[T['Remarks']]), createdBy: show_(r[T['Created By']]), updatedAt: fmt_(r[T['Updated At']]) };
}

function toResponse_(r) {
  return { no: String(r[R['Response No.']]), code: String(r[R['Training Code']]), at: fmt_(r[R['Submitted At']]),
    source: show_(r[R['Source']]), encodedBy: show_(r[R['Encoded By']]), province: show_(r[R['Province']]), gender: show_(r[R['Gender']]),
    ratings: ITEMS.map((it, i) => String(r[R_ITEM0 + i] || '')), overall: show_(r[R['III Over all']]),
    suggestions: show_(r[R['Suggestions / Recommendations']]), status: show_(r[R['Record Status']]) || 'Valid',
    voidReason: show_(r[R['Void Reason']]), rp: [] };
}

function splitList_(v) { return String(v || '').split('|').map(s => s.trim()).filter(Boolean); }

// "te 2026 1", "TE-2026-001" or a whole link -> "TE-2026-001"
function codeOf_(t) {
  const m = String(t || '').toUpperCase().match(/TE[\s-]*(\d{4})[\s-]*0*(\d{1,4})\b/);
  return m ? 'TE-' + m[1] + '-' + m[2].padStart(3, '0') : '';
}

// At most 120 public submissions a minute for the whole app (a full hall answering at once is fine),
// so a stuck page or a prank cannot flood the Sheet.
function throttle_() {
  if (typeof CacheService === 'undefined') return;
  const c = CacheService.getScriptCache(), k = 'rate-' + Math.floor(Date.now() / 60000);
  const n = Number(c.get(k) || 0) + 1;
  if (n > 120) throw new Error('Too many answers are coming in right now. Please wait a minute and send again.');
  c.put(k, String(n), 120);
}

// ---------- HRDU accounts and roles ----------

function usersSheet_() { return sheet_(USERS); }
function userRows_() { return readRows_(USERS, USER_HEADERS); }

function findUser_(username) {
  const u = String(username || '').trim().toLowerCase();
  const sh = usersSheet_();
  const r = u ? findRow_(sh, u) : 0;
  return r ? { r: r, row: sh.getRange(r, 1, 1, USER_HEADERS.length).getValues()[0] } : null;
}

function toMe_(row) {
  return { username: String(row[U['Username']]), name: String(row[U['Full Name']]), position: String(row[U['Position']]),
    role: ROLES[roleOf_(row[U['Role']])] ? roleOf_(row[U['Role']]) : 'Employee', mustChange: row[U['Must Change Password']] === 'Yes',
    empNo: String(row[U['Employee No.']] || '') };
}
// Accounts made with 1.0.0 say Head; that role is now called Administrator.
function roleOf_(v) { return String(v) === 'Head' ? ADMIN : String(v || ''); }
function publicMe_(me) { return { username: me.username, name: me.name, position: me.position, role: me.role, mustChange: me.mustChange, empNo: me.empNo }; }

// The person behind a sign-in token. The Users row is read every time, so a disabled
// account or a new role takes effect at once.
function session_(token) {
  const fail = msg => { const e = new Error(msg || 'Please sign in again.'); e.signIn = true; throw e; };
  token = String(token || '');
  if (!/^[a-f0-9]{64}$/.test(token)) fail('Please sign in.');
  const c = CacheService.getScriptCache();
  const u = c.get('s_' + token);
  if (!u) fail('Your sign-in has expired. Please sign in again.');
  const f = findUser_(u);
  if (!f || f.row[U['Status']] !== 'Active') { c.remove('s_' + token); fail('Your account is not active. Please ask the Administrator.'); }
  c.put('s_' + token, u, SESSION_SECONDS);   // six hours from the last use
  return toMe_(f.row);
}

function startSession_(row) {
  const token = token_() + token_();
  CacheService.getScriptCache().put('s_' + token, String(row[U['Username']]), SESSION_SECONDS);
  return token;
}

function signIn_(req) {
  const u = String(req.username || '').trim().toLowerCase();
  const c = CacheService.getScriptCache();
  if (!u || !req.password) throw new Error('Type your username and password.');
  if (c.get('lock_' + u)) throw new Error('Too many wrong tries. Please wait 15 minutes, or ask the Administrator to reset your password.');
  throttle_();
  return withLock_(() => {
    const f = findUser_(u);
    if (!f || f.row[U['Status']] !== 'Active' || !pwCheck_(req.password, f.row[U['Password']])) {
      const n = Number(c.get('fail_' + u) || 0) + 1;
      c.put('fail_' + u, String(n), 900);
      if (n >= 5) { c.put('lock_' + u, '1', 900); c.remove('fail_' + u); }
      if (f) audit_(u, 'SIGN-IN FAILED', u, n >= 5 ? 'Locked for 15 minutes after 5 wrong tries.' : 'Wrong username or password (' + n + ').', req.device);
      throw new Error(f && f.row[U['Status']] !== 'Active' && pwCheck_(req.password, f.row[U['Password']])
        ? 'Your account is disabled. Please ask the Administrator.' : 'Wrong username or password.');
    }
    c.remove('fail_' + u);
    f.row[U['Last Sign-in']] = dt_(new Date());
    usersSheet_().getRange(f.r, 1, 1, USER_HEADERS.length).setValues([f.row]);
    audit_(u, 'SIGNED IN', f.row[U['Full Name']], '', req.device);
    return { ok: true, token: startSession_(f.row), me: publicMe_(toMe_(f.row)) };
  });
}

// The very first account: the Administrator, made with the setup passcode (HRDU_PASSCODE).
function firstHead_(req) {
  const u = req.user || {};
  return withLock_(() => {
    if (lastRow_(usersSheet_()) >= 2) throw new Error('The first account is already made. Please sign in.');
    const want = PropertiesService.getScriptProperties().getProperty('HRDU_PASSCODE');
    if (!want) throw new Error('The setup passcode is not set. Run setup in Apps Script.');
    if (String(req.pin || '') !== want) throw new Error('Wrong setup passcode.');
    const row = newUserRow_(u, ADMIN, 'Setup');
    checkNewPassword_(u.password, row[U['Username']]);
    row[U['Password']] = pwHash_(u.password);
    row[U['Must Change Password']] = 'No';
    const sh = usersSheet_();
    sh.getRange(2, 1, 1, USER_HEADERS.length).setNumberFormat('@');
    sh.getRange(2, 1, 1, USER_HEADERS.length).setValues([row]);
    audit_(row[U['Username']], 'USER ADDED', row[U['Full Name']], 'First account (Administrator) made with the setup passcode.', req.device);
    return { ok: true, token: startSession_(row), me: publicMe_(toMe_(row)) };
  });
}

function newUserRow_(u, role, by) {
  const username = String(u.username || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) throw new Error('Username: 3 to 30 letters, numbers, dots, dashes or underscores, no spaces.');
  if (!clean_(u.fullName)) throw new Error('Full name is required.');
  if (!ROLES[role]) throw new Error('Pick a role: Administrator, Staff or Viewer.');
  const row = new Array(USER_HEADERS.length).fill('');
  const stamp = dt_(new Date());
  row[U['Username']] = username; row[U['Full Name']] = clean_(u.fullName); row[U['Position']] = clean_(u.position);
  row[U['Role']] = role; row[U['Status']] = 'Active'; row[U['Must Change Password']] = 'Yes';
  row[U['Created At']] = stamp; row[U['Created By']] = by; row[U['Updated At']] = stamp;
  return row;
}

function checkNewPassword_(pw, username) {
  pw = String(pw || '');
  if (pw.length < 8) throw new Error('The password needs at least 8 characters.');
  if (!/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) throw new Error('Use both letters and numbers in the password.');
  if (pw.toLowerCase().indexOf(String(username).toLowerCase()) >= 0) throw new Error('The password must not contain the username.');
}

function signOut_(token) {
  CacheService.getScriptCache().remove('s_' + String(token || ''));
  return { ok: true };
}

function changePassword_(req) {
  return withLock_(() => {
    const f = findUser_(req.me.username);
    if (!pwCheck_(req.old, f.row[U['Password']])) throw new Error('Your current password is wrong.');
    if (req.old === req.password) throw new Error('Choose a password different from the current one.');
    checkNewPassword_(req.password, f.row[U['Username']]);
    f.row[U['Password']] = pwHash_(req.password);
    f.row[U['Must Change Password']] = 'No';
    f.row[U['Updated At']] = dt_(new Date());
    usersSheet_().getRange(f.r, 1, 1, USER_HEADERS.length).setValues([f.row]);
    audit_(f.row[U['Username']], 'PASSWORD CHANGED', req.by, '', req.device);
    return { ok: true, me: publicMe_(toMe_(f.row)) };
  });
}

function listUsers_() {
  return { ok: true, users: userRows_().map(r => ({ username: String(r[U['Username']]), fullName: String(r[U['Full Name']]),
    position: String(r[U['Position']]), role: roleOf_(r[U['Role']]), status: String(r[U['Status']]),
    mustChange: r[U['Must Change Password']] === 'Yes', lastSignIn: show_(r[U['Last Sign-in']]), empNo: String(r[U['Employee No.']] || '') })) };
}

// Administrator only: add an HRDU account, change its name, position, role or status, or reset its password.
// New accounts and resets get a temporary password, shown once, that must be changed at the next sign-in.
function saveUser_(req) {
  const u = req.user || {};
  return withLock_(() => {
    const sh = usersSheet_();
    let row, r, what, temp = '';
    if (u.role !== undefined && STAFF_ROLES.indexOf(u.role) < 0) throw new Error('Pick a role: Administrator, Staff or Viewer. Employee accounts are made from the employee\'s leave card.');
    const empNo = u.empNo === undefined ? undefined : String(u.empNo || '').trim().toUpperCase();
    if (empNo && !findEmp_(empNo)) throw new Error('No employee has the number ' + empNo + '.');
    if (u.isNew) {
      if (findUser_(u.username)) throw new Error('The username ' + String(u.username).trim().toLowerCase() + ' is already taken.');
      row = newUserRow_(u, u.role, req.by);
      if (empNo) row[U['Employee No.']] = empNo;
      temp = tempPassword_();
      row[U['Password']] = pwHash_(temp);
      r = lastRow_(sh) + 1;
      what = 'Added as ' + row[U['Role']];
    } else {
      const f = findUser_(u.username);
      if (!f) throw new Error('No account has the username ' + u.username + '.');
      row = f.row; r = f.r;
      const before = [row[U['Full Name']], row[U['Position']], row[U['Role']], row[U['Status']], row[U['Employee No.']]].join(' / ');
      if (roleOf_(row[U['Role']]) === 'Employee' && u.role !== undefined) throw new Error('This is an employee account. Manage it from the employee\'s leave card.');
      if (empNo !== undefined) row[U['Employee No.']] = empNo;
      if (u.fullName !== undefined) { if (!clean_(u.fullName)) throw new Error('Full name is required.'); row[U['Full Name']] = clean_(u.fullName); }
      if (u.position !== undefined) row[U['Position']] = clean_(u.position);
      if (u.role !== undefined) { if (!ROLES[u.role]) throw new Error('Pick a role: Administrator, Staff or Viewer.'); row[U['Role']] = u.role; }
      if (u.status !== undefined) { if (['Active', 'Disabled'].indexOf(u.status) < 0) throw new Error('Pick Active or Disabled.'); row[U['Status']] = u.status; }
      if (u.resetPassword) { temp = tempPassword_(); row[U['Password']] = pwHash_(temp); row[U['Must Change Password']] = 'Yes'; }
      const after = [row[U['Full Name']], row[U['Position']], row[U['Role']], row[U['Status']], row[U['Employee No.']]].join(' / ');
      what = (before !== after ? before + ' to ' + after : '') + (u.resetPassword ? (before !== after ? '; ' : '') + 'password reset' : '');
      if (!what) return Object.assign(listUsers_(), { unchanged: true });
      // Someone must always be able to manage the accounts.
      const heads = userRows_().filter(x => String(x[U['Username']]) !== row[U['Username']] && roleOf_(x[U['Role']]) === ADMIN && x[U['Status']] === 'Active').length;
      if (!heads && (roleOf_(row[U['Role']]) !== ADMIN || row[U['Status']] !== 'Active')) throw new Error('There must always be at least one active Administrator account.');
    }
    row[U['Updated At']] = dt_(new Date());
    sh.getRange(r, 1, 1, USER_HEADERS.length).setNumberFormat('@');
    sh.getRange(r, 1, 1, USER_HEADERS.length).setValues([row]);
    audit_(row[U['Username']], u.isNew ? 'USER ADDED' : 'USER UPDATED', req.by, what, req.device);
    return Object.assign(listUsers_(), { tempPassword: temp, username: row[U['Username']] });
  });
}

// Salted SHA-256, repeated, so the Users tab never holds a password that can be read back.
function pwHash_(pw, salt) {
  salt = salt || token_();
  let h = salt;
  for (let i = 0; i < 400; i++) h = hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + '|' + pw, Utilities.Charset.UTF_8));
  return 'v1$' + salt + '$' + h;
}
function pwCheck_(pw, stored) {
  const p = String(stored || '').split('$');
  return p.length === 3 && p[0] === 'v1' && !!pw && pwHash_(String(pw), p[1]) === String(stored);
}
function hex_(bytes) { return bytes.map(b => ('0' + (b & 255).toString(16)).slice(-2)).join(''); }
function token_() { return Utilities.getUuid().replace(/-/g, '').toLowerCase(); }
function tempPassword_() {
  const a = 'abcdefghjkmnpqrstuvwxyz', d = '23456789', hex = token_();
  let s = '';
  for (let i = 0; i < 5; i++) s += a.charAt(parseInt(hex.substr(i * 2, 2), 16) % a.length);
  for (let i = 5; i < 9; i++) s += d.charAt(parseInt(hex.substr(i * 2, 2), 16) % d.length);
  return s;
}

// ---------- leave cards and leave applications ----------
// Rules from the CSC Omnibus Rules on Leave (CSC MC No. 41, s. 1998, as amended), the CSC conversion tables,
// and CSC MC No. 2, s. 2016 (constant factor). The application is Civil Service Form No. 6, Revised 2020.

const EMP = 'Employees', LEDGER = 'Leave Ledger', APPS = 'Leave Applications', SIGNERS = 'Signatories';
const EMP_HEADERS = ['Employee No.', 'Last Name', 'First Name', 'Middle Name', 'Position', 'Office / Unit', 'Status of Appointment',
  'Date of Original Appointment', 'Leave Card Start', 'Monthly Salary', 'Highest Monthly Salary', 'Employment Status', 'Separation Date',
  'Remarks', 'Created At', 'Created By', 'Updated At', 'Updated By'];
const LEDGER_HEADERS = ['Entry No.', 'Employee No.', 'Kind', 'Leave Type', 'Date From', 'Date To', 'Month', 'Particulars', 'Days',
  'Times Late', 'Minutes', 'VL W/P', 'VL W/O P', 'SL W/P', 'SL W/O P', 'VL Added', 'SL Added', 'Amount', 'Action Taken',
  'Application No.', 'Record Status', 'Void Reason', 'Encoded At', 'Encoded By'];
const APP_HEADERS = ['Application No.', 'Employee No.', 'Date of Filing', 'Leave Type', 'Others Specify', 'Details', 'Details Specify',
  'Days Applied', 'Date From', 'Date To', 'Inclusive Dates', 'Commutation', 'Status', 'Certified As Of', 'Certified By',
  'Recommended By', 'Recommendation', 'Disapproval Reason (7.B)', 'Approved By', 'Days With Pay', 'Days Without Pay', 'Others Approved',
  'Disapproved Due To (7.D)', 'Decided At', 'Entry No.', 'Filed By', 'Created At', 'Updated At', 'Updated By'];
const SIGN_HEADERS = ['Name', 'Position', 'Signs For', 'Status', 'Updated At', 'Updated By'];

const APPOINTMENTS = ['Permanent', 'Temporary', 'Casual', 'Coterminous', 'Contractual'];
// Section 6.A of CS Form No. 6, in its order, and which balance each one is charged to.
const LEAVE_TYPES = [
  { name: 'Vacation Leave', basis: 'Sec. 51, Rule XVI, Omnibus Rules Implementing E.O. No. 292', charge: 'VL' },
  { name: 'Mandatory/Forced Leave', basis: 'Sec. 25, Rule XVI, Omnibus Rules Implementing E.O. No. 292', charge: 'VL' },
  { name: 'Sick Leave', basis: 'Sec. 43, Rule XVI, Omnibus Rules Implementing E.O. No. 292', charge: 'SL' },
  { name: 'Maternity Leave', basis: 'R.A. No. 11210 / IRR issued by CSC, DOLE and SSS', charge: '' },
  { name: 'Paternity Leave', basis: 'R.A. No. 8187 / CSC MC No. 71, s. 1998, as amended', charge: '' },
  { name: 'Special Privilege Leave', basis: 'Sec. 21, Rule XVI, Omnibus Rules Implementing E.O. No. 292', charge: '' },
  { name: 'Solo Parent Leave', basis: 'RA No. 8972 / CSC MC No. 8, s. 2004', charge: '' },
  { name: 'Study Leave', basis: 'Sec. 68, Rule XVI, Omnibus Rules Implementing E.O. No. 292', charge: '' },
  { name: '10-Day VAWC Leave', basis: 'RA No. 9262 / CSC MC No. 15, s. 2005', charge: '' },
  { name: 'Rehabilitation Privilege', basis: 'Sec. 55, Rule XVI, Omnibus Rules Implementing E.O. No. 292', charge: '' },
  { name: 'Special Leave Benefits for Women', basis: 'RA No. 9710 / CSC MC No. 25, s. 2010', charge: '' },
  { name: 'Special Emergency (Calamity) Leave', basis: 'CSC MC No. 2, s. 2012, as amended', charge: '' },
  { name: 'Adoption Leave', basis: 'R.A. No. 8552', charge: '' },
  { name: 'Others', basis: '', charge: '' }
];
// Section 6.B of CS Form No. 6: the choices under each heading, and which leave types they go with.
const DETAILS = [
  { head: 'In case of Vacation/Special Privilege Leave', types: ['Vacation Leave', 'Mandatory/Forced Leave', 'Special Privilege Leave'], options: ['Within the Philippines', 'Abroad (Specify)'] },
  { head: 'In case of Sick Leave', types: ['Sick Leave'], options: ['In Hospital (Specify Illness)', 'Out Patient (Specify Illness)'] },
  { head: 'In case of Special Leave Benefits for Women', types: ['Special Leave Benefits for Women'], options: ['(Specify Illness)'] },
  { head: 'In case of Study Leave', types: ['Study Leave'], options: ["Completion of Master's Degree", 'BAR/Board Examination Review'] },
  { head: 'Other purpose', types: ['Others'], options: ['Monetization of Leave Credits', 'Terminal Leave'] }
];
const SIGNS_FOR = ['Certification of leave credits', 'Recommendation', 'Approval'];
const KINDS = ['Balance forwarded', 'Leave', 'Tardiness/Undertime', 'Absence without pay', 'Monetization', 'Forced leave forfeited', 'Adjustment'];
const APP_STATUSES = ['Filed', 'Approved', 'Disapproved', 'Cancelled'];
const MONTHLY_CREDIT = 1.25;   // VL and SL earned for each full month of service
const CF = 0.0481927;          // CSC MC No. 2, s. 2016: 12 / 249, for monetization and terminal leave
const SPL_DAYS = 3, FORCED_DAYS = 5;

const EI = idx_(EMP_HEADERS), LI = idx_(LEDGER_HEADERS), AI = idx_(APP_HEADERS), SI = idx_(SIGN_HEADERS);

const r3_ = n => Math.round((Number(n) || 0) * 1000 + (n < 0 ? -1e-7 : 1e-7)) / 1000;
const r2_ = n => Math.round((Number(n) || 0) * 100 + 1e-7) / 100;
const typeOf_ = name => LEAVE_TYPES.find(t => t.name === name);

// CSC table: hours and minutes as a fraction of an 8-hour day, to 3 decimals. As in the printed table, a half
// rounds down (30 minutes = .062), and every 60 minutes is .125.
function minutesToDays_(min) {
  min = Math.max(0, Math.round(Number(min) || 0));
  const m = min % 60, q = m * 25;
  return r3_(Math.floor(min / 60) * 0.125 + (Math.floor(q / 12) + (q % 12 * 2 > 12 ? 1 : 0)) / 1000);
}

// CSC tables: 1.25 days of VL and of SL a month. A month not fully in service, or with leave without pay,
// earns 1/30 of that less for each day missing (29 days = 1.208, 27 days = 1.125, 15 days = 0.625).
function earned_(daysInService, lwop) { return r3_(Math.max(0, Math.min(30, daysInService) - lwop) * MONTHLY_CREDIT / 30); }

function monthEnd_(ym) { const y = +ym.slice(0, 4), m = +ym.slice(5, 7); return ym + '-' + String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0'); }
function nextMonth_(ym) { let y = +ym.slice(0, 4), m = +ym.slice(5, 7) + 1; if (m > 12) { m = 1; y++; } return y + '-' + String(m).padStart(2, '0'); }
function prevMonth_(ym) { let y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1; if (m < 1) { m = 12; y--; } return y + '-' + String(m).padStart(2, '0'); }
function serviceDays_(ym, from, to) {
  const last = +monthEnd_(ym).slice(8);
  const a = from.slice(0, 7) === ym ? +from.slice(8, 10) : 1;
  const b = to && to.slice(0, 7) === ym ? +to.slice(8, 10) : last;
  return a === 1 && b === last ? 30 : Math.max(0, b - a + 1);
}
function monthOf_(s) { const m = String(s || '').match(/^(\d{4})-(\d{2})$/); return m && +m[2] >= 1 && +m[2] <= 12 ? m[0] : ''; }
function today_() { return fmtDate_(new Date()); }

// ---------- reading the tabs ----------

function toEmp_(r) {
  const o = { empNo: String(r[EI['Employee No.']]), last: show_(r[EI['Last Name']]), first: show_(r[EI['First Name']]), middle: show_(r[EI['Middle Name']]),
    position: show_(r[EI['Position']]), office: show_(r[EI['Office / Unit']]), appointment: show_(r[EI['Status of Appointment']]),
    appointed: fmtDate_(r[EI['Date of Original Appointment']]), cardStart: fmtDate_(r[EI['Leave Card Start']]),
    salary: Number(r[EI['Monthly Salary']]) || 0, highest: Number(r[EI['Highest Monthly Salary']]) || 0,
    status: r[EI['Employment Status']] === 'Separated' ? 'Separated' : 'Active', separated: fmtDate_(r[EI['Separation Date']]), remarks: show_(r[EI['Remarks']]) };
  o.name = o.last + ', ' + o.first + (o.middle ? ' ' + o.middle : '');
  o.fullName = o.first + (o.middle ? ' ' + o.middle.charAt(0) + '.' : '') + ' ' + o.last;
  return o;
}
function toEntry_(r) {
  const n = k => r3_(r[LI[k]]);
  return { no: String(r[LI['Entry No.']]), empNo: String(r[LI['Employee No.']]), kind: show_(r[LI['Kind']]), type: show_(r[LI['Leave Type']]),
    from: fmtDate_(r[LI['Date From']]), to: fmtDate_(r[LI['Date To']]), month: show_(r[LI['Month']]), particulars: show_(r[LI['Particulars']]),
    days: n('Days'), times: Number(r[LI['Times Late']]) || 0, minutes: Number(r[LI['Minutes']]) || 0,
    vlWP: n('VL W/P'), vlWOP: n('VL W/O P'), slWP: n('SL W/P'), slWOP: n('SL W/O P'), vlAdd: n('VL Added'), slAdd: n('SL Added'),
    amount: r2_(r[LI['Amount']]), action: show_(r[LI['Action Taken']]), appNo: show_(r[LI['Application No.']]),
    status: show_(r[LI['Record Status']]) || 'Valid', voidReason: show_(r[LI['Void Reason']]), at: fmt_(r[LI['Encoded At']]), by: show_(r[LI['Encoded By']]) };
}
function toApp_(r) {
  return { no: String(r[AI['Application No.']]), empNo: String(r[AI['Employee No.']]), filed: fmtDate_(r[AI['Date of Filing']]),
    type: show_(r[AI['Leave Type']]), othersSpecify: show_(r[AI['Others Specify']]), details: show_(r[AI['Details']]), specify: show_(r[AI['Details Specify']]),
    days: r3_(r[AI['Days Applied']]), from: fmtDate_(r[AI['Date From']]), to: fmtDate_(r[AI['Date To']]), dates: show_(r[AI['Inclusive Dates']]),
    commutation: show_(r[AI['Commutation']]) || 'Not Requested', status: show_(r[AI['Status']]) || 'Filed',
    certAsOf: fmtDate_(r[AI['Certified As Of']]), certifiedBy: show_(r[AI['Certified By']]), recommendedBy: show_(r[AI['Recommended By']]),
    recommendation: show_(r[AI['Recommendation']]), recReason: show_(r[AI['Disapproval Reason (7.B)']]), approvedBy: show_(r[AI['Approved By']]),
    withPay: r3_(r[AI['Days With Pay']]), withoutPay: r3_(r[AI['Days Without Pay']]), othersApproved: show_(r[AI['Others Approved']]),
    disapproved: show_(r[AI['Disapproved Due To (7.D)']]), decidedAt: fmt_(r[AI['Decided At']]), entryNo: show_(r[AI['Entry No.']]),
    filedBy: show_(r[AI['Filed By']]) };
}
function toSigner_(r) {
  return { name: show_(r[SI['Name']]), position: show_(r[SI['Position']]), signsFor: splitList_(r[SI['Signs For']]),
    status: r[SI['Status']] === 'Inactive' ? 'Inactive' : 'Active' };
}
function emps_() { return readRows_(EMP, EMP_HEADERS).map(toEmp_); }
function entries_() { return readRows_(LEDGER, LEDGER_HEADERS).map(toEntry_); }
function apps_() { return readRows_(APPS, APP_HEADERS).map(toApp_); }
function signers_() { return readRows_(SIGNERS, SIGN_HEADERS).map(toSigner_); }
function empKey_(s) { return String(s || '').trim().toUpperCase(); }
function findEmp_(empNo) {
  const k = empKey_(empNo); if (!k) return null;
  const sh = SpreadsheetApp.getActive().getSheetByName(EMP); if (!sh) return null;
  const r = findRow_(sh, k);
  return r ? { r: r, row: sh.getRange(r, 1, 1, EMP_HEADERS.length).getValues()[0] } : null;
}
function empOrFail_(empNo) { const f = findEmp_(empNo); if (!f) throw new Error('No employee has the number ' + empKey_(empNo) + '.'); return toEmp_(f.row); }

// ---------- the leave card ----------

// Every line of an employee's leave card in date order, with the running VL and SL balances.
// Earned credits are not typed in: each month up to the last full month (or the separation date) earns
// 1.25 VL and 1.25 SL, less the days without pay recorded for that month.
function cardOf_(emp, entries, today) {
  today = today || today_();
  const rows = [], valid = entries.filter(e => e.empNo === emp.empNo && e.status !== 'Voided');
  const lines = valid.map(e => {
    const date = e.kind === 'Tardiness/Undertime' ? monthEnd_(e.month) : e.from;
    const rank = e.kind === 'Balance forwarded' ? 0 : e.kind === 'Tardiness/Undertime' ? 2 : e.kind === 'Forced leave forfeited' ? 4 : 1;
    return { key: date + '~' + rank + '~' + e.no, date: date, e: e };
  });
  const start = emp.cardStart, from = emp.appointed && emp.appointed > start ? emp.appointed : start;
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    const last = emp.status === 'Separated' && emp.separated ? emp.separated.slice(0, 7) : prevMonth_(today.slice(0, 7));
    const lwop = {};
    valid.forEach(e => { const m = e.month || e.from.slice(0, 7); lwop[m] = r3_((lwop[m] || 0) + e.vlWOP + e.slWOP); });
    for (let m = from.slice(0, 7), i = 0; m <= last && i < 1200; m = nextMonth_(m), i++) {
      const days = serviceDays_(m, from, emp.status === 'Separated' ? emp.separated : ''), off = Math.min(lwop[m] || 0, 30);
      const n = earned_(days, off);
      lines.push({ key: monthEnd_(m) + '~3', date: monthEnd_(m), earned: { month: m, days: days, lwop: off, n: n } });
    }
  }
  lines.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  let vl = 0, sl = 0;
  lines.forEach(x => {
    const row = { date: x.date, vlEarned: 0, vlWP: 0, vlWOP: 0, slEarned: 0, slWP: 0, slWOP: 0, action: '', no: '', kind: 'Earned', particulars: '' };
    if (x.earned) {
      const g = x.earned;
      row.period = g.month; row.vlEarned = row.slEarned = g.n;
      row.particulars = g.days < 30 || g.lwop ? 'Earned (' + (g.days < 30 ? g.days + ' days in service' : '') + (g.days < 30 && g.lwop ? ', ' : '') + (g.lwop ? g.lwop + ' days without pay' : '') + ')' : 'Earned';
    } else {
      const e = x.e;
      Object.assign(row, { no: e.no, kind: e.kind, type: e.type, particulars: e.particulars, action: e.action, appNo: e.appNo, days: e.days, amount: e.amount,
        period: e.kind === 'Tardiness/Undertime' ? e.month : e.from, to: e.to, vlWP: e.vlWP, vlWOP: e.vlWOP, slWP: e.slWP, slWOP: e.slWOP,
        times: e.times, minutes: e.minutes, by: e.by });
      if (e.kind === 'Balance forwarded' || e.kind === 'Adjustment') { row.vlEarned = e.vlAdd; row.slEarned = e.slAdd; }
    }
    vl = r3_(vl + row.vlEarned - row.vlWP); sl = r3_(sl + row.slEarned - row.slWP);
    row.vlBal = vl; row.slBal = sl;
    rows.push(row);
  });
  return { rows: rows, vl: vl, sl: sl, through: start ? prevMonth_(today.slice(0, 7)) : '' };
}

// Balances just before a date (all lines dated on or before it).
function balanceAt_(card, date) {
  let b = { vl: 0, sl: 0 };
  card.rows.forEach(x => { if (x.date <= date) b = { vl: x.vlBal, sl: x.slBal }; });
  return b;
}

// What one year of the card says: SPL used, VL taken (counts toward the 5 days forced leave), monetized,
// the highest VL balance, and months with 10 or more times late (habitual tardiness watch).
function yearOf_(card, year) {
  const y = String(year), o = { spl: 0, vlTaken: 0, monetized: 0, maxVl: 0, forfeited: null, late: {} };
  let before = { vl: 0 };
  card.rows.forEach(x => {
    const ry = x.date.slice(0, 4);
    if (ry < y) before = { vl: x.vlBal };
    if (ry !== y) return;
    if (x.kind === 'Leave' && x.type === 'Special Privilege Leave') o.spl = r3_(o.spl + x.days);
    if (x.kind === 'Leave' && (x.type === 'Vacation Leave' || x.type === 'Mandatory/Forced Leave')) o.vlTaken = r3_(o.vlTaken + x.vlWP);
    if (x.kind === 'Monetization') o.monetized = r3_(o.monetized + x.vlWP);
    if (x.kind === 'Forced leave forfeited') o.forfeited = r3_((o.forfeited || 0) + x.vlWP);
    if (x.kind === 'Tardiness/Undertime' && x.times) o.late[x.period] = (o.late[x.period] || 0) + x.times;
    if (x.kind !== 'Forced leave forfeited') o.maxVl = Math.max(o.maxVl, x.vlBal);
  });
  o.maxVl = r3_(Math.max(o.maxVl, before.vl));
  o.startVl = r3_(before.vl);
  const bad = Object.keys(o.late).filter(m => o.late[m] >= 10).sort();
  // Habitual: 10 or more times late in a month, in two months of a semester or two months in a row.
  o.habitual = bad.some((m, i) => bad.some((n, j) => j > i && (nextMonth_(m) === n || (+m.slice(5) <= 6) === (+n.slice(5) <= 6))));
  o.lateMonths = bad;
  return o;
}

// The numbers for 7.A of CS Form No. 6: credits as of a date, this application, and what is left.
function certOf_(card, app) {
  const t = typeOf_(app.type) || {};
  const asOf = app.certAsOf || monthEnd_(card.through || app.filed.slice(0, 7));
  const b = balanceAt_(card, asOf);
  const lessVl = t.charge === 'VL' || app.details === 'Monetization of Leave Credits' ? app.days : 0;
  const lessSl = t.charge === 'SL' ? app.days : 0;
  return { asOf: asOf, vl: b.vl, sl: b.sl, lessVl: lessVl, lessSl: lessSl, balVl: r3_(b.vl - lessVl), balSl: r3_(b.sl - lessSl) };
}

function publicEmp_(e) {
  return { empNo: e.empNo, name: e.name, fullName: e.fullName, last: e.last, first: e.first, middle: e.middle, position: e.position, office: e.office,
    appointment: e.appointment, appointed: e.appointed, cardStart: e.cardStart, salary: e.salary, highest: e.highest, status: e.status,
    separated: e.separated, remarks: e.remarks };
}

function leaveForm_() {
  return { types: LEAVE_TYPES, details: DETAILS, appointments: APPOINTMENTS, kinds: KINDS, signsFor: SIGNS_FOR, cf: CF, spl: SPL_DAYS, forced: FORCED_DAYS };
}

// HRDU's list: every employee with the current balances, the applications waiting for action, and the signatories.
function leaveLoad_() {
  const today = today_(), all = entries_(), apps = apps_();
  const accounts = {};
  userRows_().forEach(r => { const n = String(r[U['Employee No.']] || ''); if (n && roleOf_(r[U['Role']]) === 'Employee') accounts[n] = String(r[U['Username']]); });
  const employees = emps_().map(e => {
    const c = cardOf_(e, all, today);
    return Object.assign(publicEmp_(e), { vl: c.vl, sl: c.sl, account: accounts[e.empNo] || '', pending: apps.filter(a => a.empNo === e.empNo && a.status === 'Filed').length });
  });
  const names = {}; employees.forEach(e => names[e.empNo] = e.name);
  return { ok: true, today: today, through: prevMonth_(today.slice(0, 7)), form: leaveForm_(), employees: employees, signers: signers_(),
    pending: apps.filter(a => a.status === 'Filed').map(a => Object.assign(a, { name: names[a.empNo] || a.empNo })) };
}

function cardView_(emp, forEmployee) {
  const today = today_(), all = entries_();
  const card = cardOf_(emp, all, today);
  const y = +today.slice(0, 4);
  const years = {}; [y - 1, y].forEach(k => years[k] = yearOf_(card, k));
  const apps = apps_().filter(a => a.empNo === emp.empNo).map(a => Object.assign(a, { cert: certOf_(card, a) })).reverse();
  if (forEmployee) card.rows.forEach(x => delete x.by);
  return { ok: true, today: today, through: card.through, form: leaveForm_(), employee: publicEmp_(emp), rows: card.rows, vl: card.vl, sl: card.sl,
    years: years, apps: apps, signers: signers_().filter(s => s.status === 'Active') };
}

function leaveCard_(empNo) { return cardView_(empOrFail_(empNo), false); }

// An employee's own leave card. The employee number comes from the signed-in account, never from the page.
function myLeave_(me) {
  if (!me.empNo) throw new Error('Your account is not linked to an employee record yet. Please ask HRDU.');
  return Object.assign(cardView_(empOrFail_(me.empNo), true), { me: publicMe_(me) });
}

// ---------- employees ----------

function saveEmployee_(req) {
  const x = req.employee || {};
  const empNo = empKey_(x.empNo);
  if (!/^[A-Z0-9][A-Z0-9-]{0,19}$/.test(empNo)) throw new Error('Employee No.: letters, numbers and dashes only, up to 20.');
  if (!clean_(x.last) || !clean_(x.first)) throw new Error('Last name and first name are required.');
  if (APPOINTMENTS.indexOf(x.appointment) < 0) throw new Error('Pick the status of appointment.');
  const start = toDate_(x.cardStart);
  if (!start) throw new Error('Give the date the leave card starts (the date of the balances carried over, or the first day of service).');
  const appointed = toDate_(x.appointed);
  const sep = x.status === 'Separated';
  if (sep && !toDate_(x.separated)) throw new Error('Give the date of separation.');
  const money = v => { const n = Number(String(v == null ? '' : v).replace(/,/g, '')); if (isNaN(n) || n < 0) throw new Error('Salary must be a number.'); return r2_(n); };
  return withLock_(() => {
    const sh = sheet_(EMP), stamp = new Date();
    const f = findEmp_(empNo), isNew = !!x.isNew;
    if (isNew && f) throw new Error('Employee No. ' + empNo + ' is already in the list.');
    if (!isNew && !f) throw new Error('No employee has the number ' + empNo + '.');
    const row = isNew ? new Array(EMP_HEADERS.length).fill('') : f.row, at = isNew ? lastRow_(sh) + 1 : f.r;
    const wasActive = row[EI['Employment Status']] !== 'Separated';
    if (isNew) { row[EI['Employee No.']] = empNo; row[EI['Created At']] = stamp; row[EI['Created By']] = req.by; }
    row[EI['Last Name']] = clean_(x.last).slice(0, 80); row[EI['First Name']] = clean_(x.first).slice(0, 80); row[EI['Middle Name']] = clean_(x.middle).slice(0, 80);
    row[EI['Position']] = clean_(x.position).slice(0, 150); row[EI['Office / Unit']] = clean_(x.office).slice(0, 150);
    row[EI['Status of Appointment']] = x.appointment;
    row[EI['Date of Original Appointment']] = appointed || ''; row[EI['Leave Card Start']] = start;
    row[EI['Monthly Salary']] = money(x.salary); row[EI['Highest Monthly Salary']] = money(x.highest);
    row[EI['Employment Status']] = sep ? 'Separated' : 'Active'; row[EI['Separation Date']] = sep ? toDate_(x.separated) : '';
    row[EI['Remarks']] = clean_(x.remarks).slice(0, 500);
    row[EI['Updated At']] = stamp; row[EI['Updated By']] = req.by;
    sh.getRange(at, 1, 1, EMP_HEADERS.length).setNumberFormat('@');
    ['Date of Original Appointment', 'Leave Card Start', 'Separation Date'].forEach(k => sh.getRange(at, EI[k] + 1).setNumberFormat('mmm d, yyyy'));
    ['Created At', 'Updated At'].forEach(k => sh.getRange(at, EI[k] + 1).setNumberFormat('mmm d, yyyy h:mm am/pm'));
    ['Monthly Salary', 'Highest Monthly Salary'].forEach(k => sh.getRange(at, EI[k] + 1).setNumberFormat('#,##0.00'));
    sh.getRange(at, 1, 1, EMP_HEADERS.length).setValues([row]);
    audit_(empNo, isNew ? 'EMPLOYEE ADDED' : 'EMPLOYEE UPDATED', req.by, toEmp_(row).name + (sep ? ', separated ' + fmtDate_(row[EI['Separation Date']]) : ''), req.device);
    // The balances carried over from the old leave card.
    if (isNew && (x.vl !== undefined && x.vl !== '' || x.sl !== undefined && x.sl !== '')) {
      const vl = r3_(x.vl), sl = r3_(x.sl);
      if (vl < 0 || sl < 0) throw new Error('Balances cannot be below zero.');
      addEntry_({ empNo: empNo, kind: 'Balance forwarded', from: start, particulars: 'Balance forwarded', vlAdd: vl, slAdd: sl }, req);
    }
    // A separated employee can no longer sign in.
    if (sep && wasActive) setEmpAccountStatus_(empNo, 'Disabled', req);
    if (!sep && !wasActive) setEmpAccountStatus_(empNo, 'Active', req);
    return Object.assign(leaveLoad_(), { empNo: empNo });
  });
}

function setEmpAccountStatus_(empNo, status, req) {
  const sh = usersSheet_();
  userRows_().forEach((r, i) => {
    if (String(r[U['Employee No.']]) === empNo && roleOf_(r[U['Role']]) === 'Employee' && r[U['Status']] !== status) {
      sh.getRange(i + 2, U['Status'] + 1).setValue(status);
      audit_(String(r[U['Username']]), 'USER UPDATED', req.by, 'Employee account ' + status.toLowerCase(), req.device);
    }
  });
}

// ---------- ledger entries ----------

function nextNo_(sh, pre, width) {
  const n = lastRow_(sh); let max = 0;
  if (n >= 2) sh.getRange(2, 1, n - 1, 1).getValues().forEach(v => { const s = String(v[0]); if (s.indexOf(pre) === 0) max = Math.max(max, Number(s.slice(pre.length)) || 0); });
  return pre + String(max + 1).padStart(width, '0');
}

function addEntry_(e, req) {
  const sh = sheet_(LEDGER), row = new Array(LEDGER_HEADERS.length).fill('');
  const no = nextNo_(sh, 'LV-', 6), at = lastRow_(sh) + 1;
  row[LI['Entry No.']] = no; row[LI['Employee No.']] = e.empNo; row[LI['Kind']] = e.kind; row[LI['Leave Type']] = e.type || '';
  row[LI['Date From']] = e.from || ''; row[LI['Date To']] = e.to || '';
  row[LI['Month']] = e.month || (e.from ? fmtDate_(e.from).slice(0, 7) : '');
  row[LI['Particulars']] = String(e.particulars || '').slice(0, 300);
  ['Days', 'Times Late', 'Minutes', 'VL W/P', 'VL W/O P', 'SL W/P', 'SL W/O P', 'VL Added', 'SL Added', 'Amount'].forEach(k => row[LI[k]] = 0);
  row[LI['Days']] = r3_(e.days); row[LI['Times Late']] = Math.round(e.times || 0); row[LI['Minutes']] = Math.round(e.minutes || 0);
  row[LI['VL W/P']] = r3_(e.vlWP); row[LI['VL W/O P']] = r3_(e.vlWOP); row[LI['SL W/P']] = r3_(e.slWP); row[LI['SL W/O P']] = r3_(e.slWOP);
  row[LI['VL Added']] = r3_(e.vlAdd); row[LI['SL Added']] = r3_(e.slAdd); row[LI['Amount']] = r2_(e.amount);
  row[LI['Action Taken']] = clean_(e.action).slice(0, 300); row[LI['Application No.']] = e.appNo || '';
  row[LI['Record Status']] = 'Valid'; row[LI['Encoded At']] = new Date(); row[LI['Encoded By']] = req.by;
  sh.getRange(at, 1, 1, LEDGER_HEADERS.length).setNumberFormat('@');
  ['Date From', 'Date To'].forEach(k => sh.getRange(at, LI[k] + 1).setNumberFormat('mmm d, yyyy'));
  sh.getRange(at, LI['Encoded At'] + 1).setNumberFormat('mmm d, yyyy h:mm am/pm');
  sh.getRange(at, LI['Days'] + 1, 1, 3).setNumberFormat('0.###');
  sh.getRange(at, LI['VL W/P'] + 1, 1, 6).setNumberFormat('0.000');
  sh.getRange(at, LI['Amount'] + 1).setNumberFormat('#,##0.00');
  sh.getRange(at, 1, 1, LEDGER_HEADERS.length).setValues([row]);
  audit_(no, 'LEAVE ' + e.kind.toUpperCase(), req.by, e.empNo + ': ' + row[LI['Particulars']], req.device);
  return no;
}

function days_(v, max) {
  const n = r3_(v);
  if (!(n > 0)) throw new Error('Give the number of days.');
  if (n > (max || 366)) throw new Error('That is more days than allowed here (' + (max || 366) + ').');
  return n;
}
function dateText_(from, to) {
  const f = d => Utilities.formatDate(d, TZ, 'MMM d, yyyy');
  return to && fmtDate_(to) !== fmtDate_(from) ? f(from) + ' to ' + f(to) : f(from);
}
const dd_ = n => r3_(n) + (r3_(n) === 1 ? ' day' : ' days');

// Splits days of leave into with pay and without pay, against the balances on that date.
// Sick leave goes to SL first, then to VL when SL runs out (Omnibus Rules on Leave).
function splitLeave_(charge, days, bal, withoutPay) {
  const o = { vlWP: 0, vlWOP: 0, slWP: 0, slWOP: 0 };
  if (!charge) return o;
  if (withoutPay) { o[charge === 'VL' ? 'vlWOP' : 'slWOP'] = days; return o; }
  if (charge === 'VL') { o.vlWP = r3_(Math.min(days, Math.max(0, bal.vl))); o.vlWOP = r3_(days - o.vlWP); return o; }
  o.slWP = r3_(Math.min(days, Math.max(0, bal.sl)));
  const rest = r3_(days - o.slWP);
  o.vlWP = r3_(Math.min(rest, Math.max(0, bal.vl))); o.slWOP = r3_(rest - o.vlWP);
  return o;
}
function splitText_(s) {
  const p = [];
  if (s.vlWP && s.slWP) p.push(dd_(s.vlWP) + ' charged to VL');
  if (s.vlWOP + s.slWOP) p.push(dd_(s.vlWOP + s.slWOP) + ' without pay');
  return p.length ? ' (' + p.join(', ') + ')' : '';
}

// Monetization (Sections 22 and 23): at least 10 days, with at least 15 days of VL and 5 left after; or, for
// health, calamity, education and the like, up to half of VL and SL together, VL first.
function monetize_(emp, card, date, days, special, reason) {
  const b = balanceAt_(card, date), y = yearOf_(card, date.slice(0, 4));
  const o = { vlWP: 0, slWP: 0 };
  if (!(emp.salary > 0)) throw new Error('Put in the monthly salary of ' + emp.name + ' first.');
  if (special) {
    if (!clean_(reason)) throw new Error('Give the reason for monetizing 50% or more (health, calamity, education and the like).');
    const cap = r3_((b.vl + b.sl) / 2);
    if (days > cap) throw new Error('At most half of VL and SL together: ' + cap + ' days.');
    o.vlWP = r3_(Math.min(days, b.vl)); o.slWP = r3_(days - o.vlWP);
  } else {
    if (b.vl < 15) throw new Error('Monetization needs at least 15 days of VL. ' + emp.name + ' has ' + b.vl + '.');
    if (days < 10) throw new Error('Monetize at least 10 days.');
    if (r3_(b.vl - days) < 5) throw new Error('At least 5 days of VL must be left. At most ' + r3_(b.vl - 5) + ' days can be monetized.');
    if (y.monetized + days > 30) throw new Error('At most 30 days a year. ' + y.monetized + ' days were already monetized this year.');
    o.vlWP = days;
  }
  o.amount = r2_(emp.salary * days * CF);
  return o;
}

// HRDU records something on an employee's leave card.
function saveEntry_(req) {
  const x = req.entry || {};
  return withLock_(() => {
    const emp = empOrFail_(x.empNo), card = cardOf_(emp, entries_());
    const e = { empNo: emp.empNo, kind: x.kind, action: x.action };
    if (x.kind === 'Leave') {
      const t = typeOf_(x.type); if (!t || t.name === 'Others') throw new Error('Pick the type of leave.');
      const from = toDate_(x.from); if (!from) throw new Error('Give the date the leave starts.');
      const to = toDate_(x.to) || from; if (to < from) throw new Error('The end date is before the start date.');
      e.type = t.name; e.from = from; e.to = to; e.days = days_(x.days);
      if (t.name === 'Special Privilege Leave') checkSpl_(card, fmtDate_(from), e.days);
      Object.assign(e, splitLeave_(t.charge, e.days, balanceAt_(card, fmtDate_(from)), !!x.withoutPay));
      e.particulars = t.name + ', ' + dd_(e.days) + ', ' + dateText_(from, to) + splitText_(e);
    } else if (x.kind === 'Tardiness/Undertime') {
      e.month = monthOf_(x.month); if (!e.month) throw new Error('Pick the month.');
      e.times = Math.max(0, Math.round(Number(x.times) || 0));
      const late = Math.max(0, Math.round(Number(x.late) || 0)), under = Math.max(0, Math.round(Number(x.under) || 0));
      e.minutes = late + under;
      if (!e.minutes) throw new Error('Give the total minutes late or undertime.');
      e.days = minutesToDays_(e.minutes);
      const b = balanceAt_(card, monthEnd_(e.month));
      e.vlWP = r3_(Math.min(e.days, Math.max(0, b.vl))); e.vlWOP = r3_(e.days - e.vlWP);
      e.from = toDate_(monthEnd_(e.month));
      e.particulars = 'Tardiness/undertime, ' + e.minutes + ' minutes' + (e.times ? ', ' + e.times + ' times late' : '') + ' = ' + e.days.toFixed(3) + (e.vlWOP ? ' (' + dd_(e.vlWOP) + ' without pay)' : '');
    } else if (x.kind === 'Absence without pay') {
      const from = toDate_(x.from); if (!from) throw new Error('Give the date of the absence.');
      const to = toDate_(x.to) || from; if (to < from) throw new Error('The end date is before the start date.');
      e.from = from; e.to = to; e.days = days_(x.days, 31); e.vlWOP = e.days;
      e.particulars = 'Absence without pay, ' + dd_(e.days) + ', ' + dateText_(from, to) + (clean_(x.note) ? ', ' + clean_(x.note) : '');
    } else if (x.kind === 'Monetization') {
      const from = toDate_(x.from); if (!from) throw new Error('Give the date.');
      e.from = from; e.days = days_(x.days, 300);
      Object.assign(e, monetize_(emp, card, fmtDate_(from), e.days, !!x.special, x.reason));
      e.particulars = 'Monetization, ' + dd_(e.days) + (x.special ? ' (50% or more: ' + clean_(x.reason) + ')' : '') + ', PHP ' + e.amount.toFixed(2);
    } else if (x.kind === 'Adjustment') {
      if (req.me.role !== ADMIN) throw new Error('Only the Administrator can adjust balances.');
      const from = toDate_(x.from); if (!from) throw new Error('Give the date.');
      e.from = from; e.vlAdd = r3_(x.vlAdd); e.slAdd = r3_(x.slAdd);
      if (!e.vlAdd && !e.slAdd) throw new Error('Give the VL or SL to add (or a negative number to take away).');
      if (!clean_(x.reason)) throw new Error('Give the reason for the adjustment.');
      e.particulars = 'Adjustment: ' + clean_(x.reason);
    } else if (x.kind === 'Balance forwarded') {
      if (card.rows.some(r => r.kind === 'Balance forwarded')) throw new Error('This leave card already has its balance forwarded. Void that line first to change it.');
      e.from = toDate_(emp.cardStart); e.vlAdd = r3_(x.vlAdd); e.slAdd = r3_(x.slAdd);
      if (e.vlAdd < 0 || e.slAdd < 0) throw new Error('Balances cannot be below zero.');
      e.particulars = 'Balance forwarded';
    } else throw new Error('Pick what to record.');
    const no = addEntry_(e, req);
    return Object.assign(leaveCard_(emp.empNo), { no: no });
  });
}

function checkSpl_(card, date, days) {
  const used = yearOf_(card, date.slice(0, 4)).spl;
  if (used + days > SPL_DAYS) throw new Error('Special privilege leave is at most ' + SPL_DAYS + ' days a year. ' + dd_(used) + ' already used in ' + date.slice(0, 4) + '.');
}

// Administrator only: a wrong line is Voided with the reason, never deleted.
function voidEntry_(req) {
  const why = clean_(req.reason);
  if (!why) throw new Error('Give the reason for voiding.');
  return withLock_(() => {
    const sh = sheet_(LEDGER), r = findRow_(sh, String(req.no || ''));
    if (!r) throw new Error('No line has the number ' + req.no + '.');
    const row = sh.getRange(r, 1, 1, LEDGER_HEADERS.length).getValues()[0];
    if (row[LI['Record Status']] === 'Voided') throw new Error('This line is already voided.');
    sh.getRange(r, LI['Record Status'] + 1, 1, 2).setValues([['Voided', why.slice(0, 300)]]);
    audit_(req.no, 'LEAVE LINE VOIDED', req.by, row[LI['Employee No.']] + ': ' + why, req.device);
    // An approved application whose line is voided goes back to Cancelled.
    const appNo = String(row[LI['Application No.']] || '');
    if (appNo) { const f = findApp_(appNo); if (f) { f.row[AI['Status']] = 'Cancelled'; f.row[AI['Updated At']] = new Date(); f.row[AI['Updated By']] = req.by; sheet_(APPS).getRange(f.r, 1, 1, APP_HEADERS.length).setValues([f.row]); } }
    return leaveCard_(String(row[LI['Employee No.']]));
  });
}

// ---------- forced leave at the end of the year ----------

// Section 25: anyone with 10 or more days of VL must take 5 days of VL within the year. What is not taken
// is forfeited (deducted from VL) at the end of the year, unless the head cancelled it for the service.
function forcedRows_(year) {
  if (!(year >= 2000 && year <= 2100)) throw new Error('Pick the year.');
  const all = entries_(), endY = year + '-12-31', today = String(year + 1) + '-01-15';
  return emps_().filter(e => e.cardStart && e.cardStart <= endY && !(e.status === 'Separated' && e.separated && e.separated <= endY)).map(e => {
    const card = cardOf_(e, all, today > today_() ? today_() : today), y = yearOf_(card, year), bal = balanceAt_(card, endY);
    const need = y.maxVl >= 10 ? FORCED_DAYS : 0;
    const forfeit = y.forfeited != null ? 0 : r3_(Math.max(0, Math.min(need - y.vlTaken, bal.vl)));
    return { empNo: e.empNo, name: e.name, maxVl: y.maxVl, taken: y.vlTaken, balance: bal.vl, need: need, forfeit: forfeit, posted: y.forfeited };
  });
}

function postForced_(req) {
  const year = Number(req.year);
  if (today_() < (year + 1) + '-01-01') throw new Error('Forced leave for ' + year + ' can be posted from January 1, ' + (year + 1) + '.');
  const skip = (req.skip || []).map(empKey_), why = clean_(req.reason);
  if (skip.length && !why) throw new Error('Give the reason for those not charged (for example, leave cancelled by the head for the service).');
  return withLock_(() => {
    const done = [];
    forcedRows_(year).forEach(x => {
      if (!x.forfeit) return;
      if (skip.indexOf(x.empNo) >= 0) { audit_(x.empNo, 'FORCED LEAVE NOT CHARGED', req.by, year + ': ' + why, req.device); return; }
      addEntry_({ empNo: x.empNo, kind: 'Forced leave forfeited', from: toDate_(year + '-12-31'), vlWP: x.forfeit,
        particulars: 'Forced leave not taken in ' + year + ' (' + FORCED_DAYS + ' required, ' + x.taken + ' taken)' }, req);
      done.push(x.empNo);
    });
    return { ok: true, year: year, posted: done, rows: forcedRows_(year) };
  });
}

// ---------- leave applications (CS Form No. 6, Revised 2020) ----------

function findApp_(no) {
  const sh = sheet_(APPS), r = findRow_(sh, String(no || ''));
  return r ? { r: r, row: sh.getRange(r, 1, 1, APP_HEADERS.length).getValues()[0] } : null;
}
function signerName_(name, role) {
  name = clean_(name); if (!name) return '';
  const s = signers_().find(x => x.name === name && x.signsFor.indexOf(role) >= 0);
  if (!s) throw new Error(name + ' is not on the list of signatories for ' + role.toLowerCase() + '.');
  return s.name;
}

// An employee files a leave application, or HRDU types in a paper one for an employee.
function fileLeave_(req) {
  const a = req.app || {};
  const empNo = req.me.role === 'Employee' ? req.me.empNo : empKey_(a.empNo || req.me.empNo);
  if (!empNo) throw new Error('Your account is not linked to an employee record yet. Please ask HRDU.');
  const emp = empOrFail_(empNo);
  if (emp.status !== 'Active') throw new Error(emp.name + ' is separated from the service.');
  const t = typeOf_(a.type); if (!t) throw new Error('Pick the type of leave (6.A).');
  const group = DETAILS.find(g => g.types.indexOf(t.name) >= 0);
  const details = group && group.options.indexOf(a.details) >= 0 ? a.details : '';
  if (t.name === 'Others' && !clean_(a.othersSpecify) && !details) throw new Error('Say what the other leave or purpose is.');
  if (group && /Specify/.test(details) && !clean_(a.specify)) throw new Error('Please specify: ' + details.replace(/\s*\(Specify.*\)/, '') + '.');
  const purpose = details === 'Monetization of Leave Credits' || details === 'Terminal Leave';
  const from = toDate_(a.from), to = toDate_(a.to) || from;
  if (!purpose && !from) throw new Error('Give the inclusive dates.');
  if (from && to < from) throw new Error('The end date is before the start date.');
  const days = details === 'Terminal Leave' ? r3_(a.days) : days_(a.days);
  return withLock_(() => {
    if (t.name === 'Special Privilege Leave') checkSpl_(cardOf_(emp, entries_()), fmtDate_(from), days);
    const sh = sheet_(APPS), row = new Array(APP_HEADERS.length).fill(''), stamp = new Date();
    const no = nextNo_(sh, 'LA-' + Utilities.formatDate(stamp, TZ, 'yyyy') + '-', 4), at = lastRow_(sh) + 1;
    row[AI['Application No.']] = no; row[AI['Employee No.']] = emp.empNo;
    row[AI['Date of Filing']] = toDate_(a.filed) || toDate_(today_());
    row[AI['Leave Type']] = t.name; row[AI['Others Specify']] = clean_(a.othersSpecify).slice(0, 150);
    row[AI['Details']] = details; row[AI['Details Specify']] = clean_(a.specify).slice(0, 200);
    row[AI['Days Applied']] = days; row[AI['Date From']] = from || ''; row[AI['Date To']] = from ? to : '';
    row[AI['Inclusive Dates']] = from ? dateText_(from, to) : '';
    row[AI['Commutation']] = a.commutation === 'Requested' ? 'Requested' : 'Not Requested';
    row[AI['Status']] = 'Filed'; row[AI['Recommended By']] = signerName_(a.recommendedBy, 'Recommendation');
    row[AI['Filed By']] = req.by; row[AI['Created At']] = stamp; row[AI['Updated At']] = stamp; row[AI['Updated By']] = req.by;
    ['Days Applied', 'Days With Pay', 'Days Without Pay'].forEach(k => row[AI[k]] = row[AI[k]] === '' ? 0 : row[AI[k]]);
    sh.getRange(at, 1, 1, APP_HEADERS.length).setNumberFormat('@');
    ['Date of Filing', 'Date From', 'Date To', 'Certified As Of'].forEach(k => sh.getRange(at, AI[k] + 1).setNumberFormat('mmm d, yyyy'));
    ['Decided At', 'Created At', 'Updated At'].forEach(k => sh.getRange(at, AI[k] + 1).setNumberFormat('mmm d, yyyy h:mm am/pm'));
    ['Days Applied', 'Days With Pay', 'Days Without Pay'].forEach(k => sh.getRange(at, AI[k] + 1).setNumberFormat('0.###'));
    sh.getRange(at, 1, 1, APP_HEADERS.length).setValues([row]);
    audit_(no, 'LEAVE APPLICATION FILED', req.by, emp.empNo + ': ' + t.name + ', ' + dd_(days), req.device);
    const out = req.me.role === 'Employee' ? myLeave_(req.me) : leaveCard_(emp.empNo);
    return Object.assign(out, { appNo: no });
  });
}

// HRDU fills in part 7 of an application: who certifies, recommends and approves, and the decision.
// An approved leave goes on the leave card. Days with pay cannot be more than the credits allow.
function actOnLeave_(req) {
  const a = req.app || {};
  return withLock_(() => {
    const f = findApp_(a.no); if (!f) throw new Error('No application has the number ' + a.no + '.');
    const row = f.row, app = toApp_(row);
    if (app.status !== 'Filed') throw new Error('This application is already ' + app.status.toLowerCase() + '.');
    const emp = empOrFail_(app.empNo), t = typeOf_(app.type) || {};
    if (a.certAsOf !== undefined) row[AI['Certified As Of']] = toDate_(a.certAsOf) || '';
    if (a.certifiedBy !== undefined) row[AI['Certified By']] = signerName_(a.certifiedBy, 'Certification of leave credits');
    if (a.recommendedBy !== undefined) row[AI['Recommended By']] = signerName_(a.recommendedBy, 'Recommendation');
    if (a.approvedBy !== undefined) row[AI['Approved By']] = signerName_(a.approvedBy, 'Approval');
    if (a.recommendation !== undefined) {
      row[AI['Recommendation']] = ['For approval', 'For disapproval'].indexOf(a.recommendation) >= 0 ? a.recommendation : '';
      row[AI['Disapproval Reason (7.B)']] = row[AI['Recommendation']] === 'For disapproval' ? clean_(a.recReason).slice(0, 300) : '';
    }
    let what = 'Signatories saved';
    if (a.decision === 'Approved' || a.decision === 'Disapproved') {
      const card = cardOf_(emp, entries_());
      row[AI['Status']] = a.decision; row[AI['Decided At']] = new Date();
      if (a.decision === 'Disapproved') {
        if (!clean_(a.disapproved)) throw new Error('Give the reason for the disapproval (7.D).');
        row[AI['Disapproved Due To (7.D)']] = clean_(a.disapproved).slice(0, 300);
        what = 'Disapproved: ' + row[AI['Disapproved Due To (7.D)']];
      } else {
        const wp = r3_(a.withPay), wop = r3_(a.withoutPay);
        if (wp < 0 || wop < 0 || !(wp + wop > 0) && app.details !== 'Terminal Leave') throw new Error('Give the days approved with pay and without pay (7.C).');
        row[AI['Days With Pay']] = wp; row[AI['Days Without Pay']] = wop; row[AI['Others Approved']] = clean_(a.othersApproved).slice(0, 150);
        const date = app.from || app.filed;
        let e = null;
        if (app.details === 'Monetization of Leave Credits') {
          e = Object.assign({ kind: 'Monetization', from: toDate_(date), days: wp }, monetize_(emp, card, date, wp, !!a.special, a.reason));
          e.particulars = 'Monetization, ' + dd_(wp) + ', PHP ' + e.amount.toFixed(2);
        } else if (app.details !== 'Terminal Leave' && t.name !== 'Others') {
          if (t.name === 'Special Privilege Leave') checkSpl_(card, date, wp + wop);
          const bal = balanceAt_(card, date), s = { vlWP: 0, vlWOP: 0, slWP: 0, slWOP: 0 };
          if (t.charge) {
            const auto = splitLeave_(t.charge, wp, bal, false);
            if (auto.vlWOP + auto.slWOP > 0) throw new Error('Only ' + r3_(t.charge === 'VL' ? bal.vl : bal.sl + (t.charge === 'SL' ? bal.vl : 0)) + ' days can be with pay on ' + date + '. Put the rest under days without pay.');
            Object.assign(s, auto);
            s[t.charge === 'VL' ? 'vlWOP' : 'slWOP'] = wop;
          } else if (wop) s.vlWOP = wop;
          e = Object.assign({ kind: 'Leave', type: t.name, from: toDate_(date), to: toDate_(app.to || date), days: r3_(wp + wop) }, s);
          e.particulars = t.name + ', ' + dd_(e.days) + ', ' + (app.dates || date) + splitText_(s);
        }
        if (e) {
          e.empNo = emp.empNo; e.appNo = app.no; e.action = 'Approved (' + app.no + ')';
          row[AI['Entry No.']] = addEntry_(e, req);
        }
        what = 'Approved: ' + dd_(wp) + ' with pay' + (wop ? ', ' + dd_(wop) + ' without pay' : '');
      }
    }
    row[AI['Updated At']] = new Date(); row[AI['Updated By']] = req.by;
    sheet_(APPS).getRange(f.r, 1, 1, APP_HEADERS.length).setValues([row]);
    audit_(app.no, a.decision ? 'LEAVE APPLICATION ' + a.decision.toUpperCase() : 'LEAVE APPLICATION UPDATED', req.by, what, req.device);
    return leaveCard_(emp.empNo);
  });
}

// The employee (own application) or HRDU cancels an application that has not been acted on.
function cancelLeave_(req) {
  return withLock_(() => {
    const f = findApp_(req.no); if (!f) throw new Error('No application has the number ' + req.no + '.');
    const app = toApp_(f.row);
    if (req.me.role === 'Employee' && app.empNo !== req.me.empNo) throw new Error('No application has the number ' + req.no + '.');
    if (app.status !== 'Filed') throw new Error('Only an application not yet acted on can be cancelled.');
    f.row[AI['Status']] = 'Cancelled'; f.row[AI['Updated At']] = new Date(); f.row[AI['Updated By']] = req.by;
    sheet_(APPS).getRange(f.r, 1, 1, APP_HEADERS.length).setValues([f.row]);
    audit_(app.no, 'LEAVE APPLICATION CANCELLED', req.by, clean_(req.reason), req.device);
    return req.me.role === 'Employee' ? myLeave_(req.me) : leaveCard_(app.empNo);
  });
}

// ---------- signatories (the drop-down lists on the form) ----------

function saveSigner_(req) {
  const s = req.signer || {};
  const name = clean_(s.name).slice(0, 120);
  if (!name) throw new Error('Give the name as it should appear on the form.');
  const signs = (s.signsFor || []).filter(x => SIGNS_FOR.indexOf(x) >= 0);
  if (!signs.length) throw new Error('Tick what this person signs.');
  return withLock_(() => {
    const sh = sheet_(SIGNERS), key = clean_(s.original || name);
    let r = findRow_(sh, key);
    if (!s.original && r) throw new Error(name + ' is already on the list.');
    if (s.original && !r) throw new Error('Not found: ' + s.original + '.');
    if (s.original && name !== s.original && findRow_(sh, name)) throw new Error(name + ' is already on the list.');
    if (!r) r = lastRow_(sh) + 1;
    sh.getRange(r, 1, 1, SIGN_HEADERS.length).setNumberFormat('@');
    sh.getRange(r, 1, 1, SIGN_HEADERS.length).setValues([[name, clean_(s.position).slice(0, 150), signs.join(' | '),
      s.status === 'Inactive' ? 'Inactive' : 'Active', dt_(new Date()), req.by]]);
    audit_(name, s.original ? 'SIGNATORY UPDATED' : 'SIGNATORY ADDED', req.by, clean_(s.position) + ': ' + signs.join(', ') + (s.status === 'Inactive' ? ' (inactive)' : ''), req.device);
    return { ok: true, signers: signers_() };
  });
}

// ---------- employee sign-in accounts ----------

// HRDU makes or resets an employee's account (role Employee, sees only that employee's leave card),
// or makes accounts for every active employee who has none. Temporary passwords are shown once.
function empAccount_(req) {
  return withLock_(() => {
    const sh = usersSheet_(), rows = userRows_(), made = [];
    const has = {}; rows.forEach(r => { const n = String(r[U['Employee No.']] || ''); if (n && roleOf_(r[U['Role']]) === 'Employee') has[n] = r; });
    const make = (emp, username) => {
      username = String(username || emp.empNo).trim().toLowerCase();
      if (findUser_(username)) throw new Error('The username ' + username + ' is already taken. Type another one.');
      const row = newUserRow_({ username: username, fullName: emp.fullName, position: emp.position }, 'Employee', req.by);
      const temp = tempPassword_();
      row[U['Password']] = pwHash_(temp); row[U['Employee No.']] = emp.empNo;
      const at = lastRow_(sh) + 1;
      sh.getRange(at, 1, 1, USER_HEADERS.length).setNumberFormat('@');
      sh.getRange(at, 1, 1, USER_HEADERS.length).setValues([row]);
      audit_(username, 'USER ADDED', req.by, 'Employee account for ' + emp.empNo, req.device);
      made.push({ empNo: emp.empNo, name: emp.fullName, username: username, tempPassword: temp });
    };
    if (req.mode === 'all') {
      const skipped = [];
      emps_().filter(e => e.status === 'Active' && !has[e.empNo]).forEach(e => { try { make(e); } catch (err) { skipped.push(e.empNo + ': ' + err.message); } });
      return Object.assign(leaveLoad_(), { made: made, skipped: skipped });
    }
    const emp = empOrFail_(req.empNo);
    if (req.mode === 'reset') {
      const r = has[emp.empNo]; if (!r) throw new Error(emp.name + ' has no account yet.');
      const f = findUser_(r[U['Username']]), temp = tempPassword_();
      f.row[U['Password']] = pwHash_(temp); f.row[U['Must Change Password']] = 'Yes'; f.row[U['Updated At']] = dt_(new Date());
      if (emp.status === 'Active') f.row[U['Status']] = 'Active';
      sh.getRange(f.r, 1, 1, USER_HEADERS.length).setValues([f.row]);
      audit_(String(f.row[U['Username']]), 'USER UPDATED', req.by, 'Employee password reset', req.device);
      made.push({ empNo: emp.empNo, name: emp.fullName, username: String(f.row[U['Username']]), tempPassword: temp });
    } else {
      if (has[emp.empNo]) throw new Error(emp.name + ' already has an account: ' + has[emp.empNo][U['Username']] + '.');
      if (emp.status !== 'Active') throw new Error(emp.name + ' is separated from the service.');
      make(emp, req.username);
    }
    return Object.assign(leaveLoad_(), { made: made });
  });
}

// ---------- monthly backup of this Sheet to Drive ----------

function backupFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('BACKUP_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (err) {} }
  const f = DriveApp.createFolder(BACKUP_FOLDER);
  props.setProperty('BACKUP_FOLDER_ID', f.getId());
  return f;
}

function backupNow_(by) {
  const ss = SpreadsheetApp.getActive();
  const name = ss.getName() + ' (backup ' + Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HHmm') + ')';
  const copy = DriveApp.getFileById(ss.getId()).makeCopy(name, backupFolder_());
  const props = PropertiesService.getScriptProperties();
  props.setProperty('LAST_BACKUP', dt_(new Date()));
  props.setProperty('LAST_BACKUP_URL', copy.getUrl());
  audit_('', 'BACKUP', by, name, '');
  return { ok: true, last: props.getProperty('LAST_BACKUP'), url: copy.getUrl() };
}

function monthlyBackup() { withLock_(() => backupNow_('Automatic monthly backup')); }

function installBackupTrigger_() {
  if (ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'monthlyBackup')) return;
  ScriptApp.newTrigger('monthlyBackup').timeBased().onMonthDay(1).atHour(6).create();
}

// ---------- setup ----------

function setup() {
  const ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetTimeZone(TZ);
  [[TRAININGS, TRAINING_HEADERS], [RESP, RESP_HEADERS], [RP, RP_HEADERS], [EMP, EMP_HEADERS], [LEDGER, LEDGER_HEADERS], [APPS, APP_HEADERS],
    [SIGNERS, SIGN_HEADERS], [USERS, USER_HEADERS], [AUDIT, AUDIT_HEADERS]].forEach(x => {
    let sh = ss.getSheetByName(x[0]);
    if (!sh) sh = ss.insertSheet(x[0]);
    const have = sh.getRange(1, 1, 1, x[1].length).getValues()[0];
    if (have.join('|') !== x[1].join('|')) sh.getRange(1, 1, 1, x[1].length).setValues([x[1]]).setFontWeight('bold');
    sh.setFrozenRows(1);
    protect_(sh);
  });
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('HRDU_PASSCODE')) props.setProperty('HRDU_PASSCODE', '1234');
  backupFolder_();
  installBackupTrigger_();
  audit_('', 'SETUP', Session.getEffectiveUser().getEmail(), 'Version ' + VERSION, '');
  Logger.log('Setup done. Deploy the web app, then open it and make the first account with the setup passcode.');
}

// ---------- helpers ----------

function readRows_(name, headers) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) return [];
  const n = lastRow_(sh);
  return n < 2 ? [] : sh.getRange(2, 1, n - 1, headers.length).getValues().filter(r => r[0] !== '');
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);   // two people saving at once won't overwrite each other
  try { const out = fn(); SpreadsheetApp.flush(); return out; }
  finally { lock.releaseLock(); }
}

function sheet_(name) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error('Tab "' + name + '" not found. Run setup in Apps Script.');
  return sh;
}

function lastRow_(sh) {
  const vals = sh.getRange(1, 1, sh.getMaxRows(), 1).getValues();
  for (let i = vals.length - 1; i >= 0; i--) if (vals[i][0] !== '') return i + 1;
  return 1;
}

function findRow_(sh, key) {
  const n = lastRow_(sh);
  if (!key || n < 2) return 0;
  const vals = sh.getRange(2, 1, n - 1, 1).getValues();
  for (let i = 0; i < vals.length; i++) if (String(vals[i][0]) === key) return i + 2;
  return 0;
}

function audit_(ref, action, by, details, device) {
  const sh = sheet_(AUDIT);
  const r = lastRow_(sh) + 1;
  sh.getRange(r, 1, 1, AUDIT_HEADERS.length)
    .setValues([[new Date(), ref || '', action, by || '', String(details || '').slice(0, 2000), String(device || '').slice(0, 200)]]);
  sh.getRange(r, 1).setNumberFormat('mmm d, yyyy h:mm:ss am/pm');
}

function protect_(sh) {
  const p = sh.getProtections(SpreadsheetApp.ProtectionType.SHEET)[0] || sh.protect();
  p.setDescription('Controlled record - edit through the HRDU Training Evaluation app only');
  const me = Session.getEffectiveUser();
  p.addEditor(me);
  p.removeEditors(p.getEditors().filter(u => u.getEmail() !== me.getEmail()));
  if (p.canDomainEdit()) p.setDomainEdit(false);
}

function appUrl_() { try { return ScriptApp.getService().getUrl() || ''; } catch (err) { return ''; } }

// Text from the page is kept as typed, except a leading = + @ that a spreadsheet would run as a formula.
function clean_(s) { return String(s == null ? '' : s).trim().replace(/^[=+@]+\s*/, '').replace(/^-+(?=\s*[=+@(])/, '').slice(0, 1500); }

function toDate_(s) {
  if (s instanceof Date) return s;
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? Utilities.parseDate(m[0] + ' 12:00', TZ, 'yyyy-MM-dd HH:mm') : null;   // noon Manila, so no day shift
}

function show_(v) { return v instanceof Date ? fmtDate_(v) : String(v == null ? '' : v); }
function dt_(d) { return Utilities.formatDate(d, TZ, 'yyyy-MM-dd HH:mm'); }
function fmt_(d) { return d instanceof Date ? Utilities.formatDate(d, TZ, 'MMM d, yyyy h:mm a') : String(d || ''); }
function fmtDate_(d) { return d instanceof Date ? Utilities.formatDate(d, TZ, 'yyyy-MM-dd') : String(d || ''); }
function idx_(h) { const o = {}; h.forEach((k, i) => o[k] = i); return o; }

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
