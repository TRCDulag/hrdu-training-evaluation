/**
 * HRDU Training Evaluation (Level 1) - backend for the "Index" page.
 * Keeps the trainings of the Human Resource Development Unit of DOH TRC Dulag and the
 * participants' answers to the Training Evaluation Tool (Level 1), and gives the page what it
 * needs for the summary report of each training.
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
const VERSION = '1.0.2';
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
  'Last Sign-in', 'Created At', 'Created By', 'Updated At'];
const AUDIT_HEADERS = ['Timestamp', 'Reference', 'Action', 'By', 'Details', 'Device'];

const ROLES = { 'Viewer': 1, 'Staff': 2, 'Administrator': 3 };
const ADMIN = 'Administrator';
// The lowest role that may do each action. Anything not listed is refused.
const NEED = { load: 'Viewer', me: 'Viewer', signOut: 'Viewer', changePassword: 'Viewer',
  saveTraining: 'Staff', setStatus: 'Staff', encodeResponse: 'Staff',
  voidResponse: ADMIN, listUsers: ADMIN, saveUser: ADMIN, backupNow: ADMIN };
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
    .setTitle(code ? 'Training Evaluation' : 'HRDU Training Evaluation')
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
    // Everything else is for a signed-in HRDU user whose role allows it.
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
    role: ROLES[roleOf_(row[U['Role']])] ? roleOf_(row[U['Role']]) : 'Viewer', mustChange: row[U['Must Change Password']] === 'Yes' };
}
// Accounts made with 1.0.0 say Head; that role is now called Administrator.
function roleOf_(v) { return String(v) === 'Head' ? ADMIN : String(v || ''); }
function publicMe_(me) { return { username: me.username, name: me.name, position: me.position, role: me.role, mustChange: me.mustChange }; }

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
    mustChange: r[U['Must Change Password']] === 'Yes', lastSignIn: show_(r[U['Last Sign-in']]) })) };
}

// Administrator only: add an HRDU account, change its name, position, role or status, or reset its password.
// New accounts and resets get a temporary password, shown once, that must be changed at the next sign-in.
function saveUser_(req) {
  const u = req.user || {};
  return withLock_(() => {
    const sh = usersSheet_();
    let row, r, what, temp = '';
    if (u.isNew) {
      if (findUser_(u.username)) throw new Error('The username ' + String(u.username).trim().toLowerCase() + ' is already taken.');
      row = newUserRow_(u, u.role, req.by);
      temp = tempPassword_();
      row[U['Password']] = pwHash_(temp);
      r = lastRow_(sh) + 1;
      what = 'Added as ' + row[U['Role']];
    } else {
      const f = findUser_(u.username);
      if (!f) throw new Error('No account has the username ' + u.username + '.');
      row = f.row; r = f.r;
      const before = [row[U['Full Name']], row[U['Position']], row[U['Role']], row[U['Status']]].join(' / ');
      if (u.fullName !== undefined) { if (!clean_(u.fullName)) throw new Error('Full name is required.'); row[U['Full Name']] = clean_(u.fullName); }
      if (u.position !== undefined) row[U['Position']] = clean_(u.position);
      if (u.role !== undefined) { if (!ROLES[u.role]) throw new Error('Pick a role: Administrator, Staff or Viewer.'); row[U['Role']] = u.role; }
      if (u.status !== undefined) { if (['Active', 'Disabled'].indexOf(u.status) < 0) throw new Error('Pick Active or Disabled.'); row[U['Status']] = u.status; }
      if (u.resetPassword) { temp = tempPassword_(); row[U['Password']] = pwHash_(temp); row[U['Must Change Password']] = 'Yes'; }
      const after = [row[U['Full Name']], row[U['Position']], row[U['Role']], row[U['Status']]].join(' / ');
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
  [[TRAININGS, TRAINING_HEADERS], [RESP, RESP_HEADERS], [RP, RP_HEADERS], [USERS, USER_HEADERS], [AUDIT, AUDIT_HEADERS]].forEach(x => {
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
