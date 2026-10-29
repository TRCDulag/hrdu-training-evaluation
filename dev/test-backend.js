// Backend tests: runs apps-script/Code.gs on the mock of Google services. Run: npm test
const assert = require('assert');
const { loadBackend, seed } = require('./mock-gas');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok   ' + name); }
  catch (e) { console.log('FAIL ' + name + '\n     ' + (e.stack || e).split('\n').slice(0, 3).join('\n     ')); process.exitCode = 1; }
}

const be = loadBackend(); seed(be);
const call = req => be.code.handle_(JSON.parse(JSON.stringify(req)));
const tab = n => be.gas._ss.getSheetByName(n)._data.filter(r => r.some(v => v !== ''));
const same = (a, b) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
const fullAnswers = (o = {}) => Object.assign({ province: 'Leyte', gender: 'Female', overall: 'E', suggestions: 'More hands-on time.',
  ratings: { p1: 'E', p2: 'VS', c1: 'E', c2: 'E', c3: 'VS', c4: 'S', c5: 'VS', c6: 'E', v1: 'E', v2: 'VS', v3: 'S', v4: 'E', v5: 'P' },
  rp: [{ name: 'Dr. Ana Reyes', ratings: { r1: 'E', r2: 'E', r3: 'VS', r4: 'VS', r5: 'E' } },
       { name: 'Mr. Ben Cruz', skip: true }] }, o);

let head, staff, viewer, code;

test('setup makes the tabs and the passcode', () => {
  ['Trainings', 'Responses', 'Resource Person Ratings', 'Users', 'Audit Trail'].forEach(n => assert.ok(be.gas._ss.getSheetByName(n), n));
  assert.strictEqual(be.gas._props.HRDU_PASSCODE, '1234');
  same(be.gas._triggers, ['monthlyBackup']);
  assert.ok(call({ action: 'publicInit' }).needsSetup);
});

test('first head needs the passcode, then only once', () => {
  assert.match(call({ action: 'firstHead', pin: '0000', user: { username: 'hrdu', fullName: 'Head HRDU', password: 'secret123' } }).error, /passcode/);
  const j = call({ action: 'firstHead', pin: '1234', user: { username: 'Hrdu.Head', fullName: 'Maria Santos', position: 'HRDU Head', password: 'secret123' } });
  assert.ok(j.ok, j.error); head = j.token;
  assert.strictEqual(j.me.role, 'Administrator');
  assert.match(call({ action: 'firstHead', pin: '1234', user: { username: 'x2', fullName: 'X', password: 'secret123' } }).error, /already/);
  assert.ok(!call({ action: 'publicInit' }).needsSetup);
});

test('head adds staff and viewer; temp password must be changed', () => {
  let j = call({ action: 'saveUser', token: head, user: { isNew: true, username: 'encoder', fullName: 'Juan Dela Cruz', role: 'Staff' } });
  assert.ok(j.ok, j.error); assert.match(j.tempPassword, /^[a-z]{5}\d{4}$/);
  let s = call({ action: 'signIn', username: 'encoder', password: j.tempPassword });
  assert.ok(s.ok && s.me.mustChange);
  assert.match(call({ action: 'load', token: s.token }).error, /temporary password/);
  assert.ok(call({ action: 'changePassword', token: s.token, old: j.tempPassword, password: 'newpass99' }).ok);
  staff = s.token;
  j = call({ action: 'saveUser', token: head, user: { isNew: true, username: 'viewer', fullName: 'Viewer Only', role: 'Viewer' } });
  s = call({ action: 'signIn', username: 'viewer', password: j.tempPassword });
  call({ action: 'changePassword', token: s.token, old: j.tempPassword, password: 'viewpass1' });
  viewer = s.token;
});

test('a training gets the next code for its year', () => {
  assert.match(call({ action: 'saveTraining', token: viewer, training: { title: 'X', dateFrom: '2026-11-03' } }).error, /role/);
  assert.match(call({ action: 'saveTraining', token: staff, training: { title: '', dateFrom: '2026-11-03' } }).error, /Title/);
  let j = call({ action: 'saveTraining', token: staff, training: { title: 'Basic Life Support Training', dateFrom: '2026-11-03', dateTo: '2026-11-04',
    venue: 'TRC Dulag Function Hall', conductedBy: 'HRDU', speakers: 'Dr. Ana Reyes\nMr. Ben Cruz\n', skip: ['v3', 'c1'], expected: '30' } });
  assert.ok(j.ok, j.error); code = j.code;
  assert.strictEqual(code, 'TE-2026-001');
  const t = j.trainings.find(x => x.code === code);
  same(t.speakers, ['Dr. Ana Reyes', 'Mr. Ben Cruz']);
  same(t.skip, ['v3']);   // only venue items can be left out
  assert.strictEqual(t.status, 'Open');
  assert.strictEqual(t.expected, 30);
  j = call({ action: 'saveTraining', token: staff, training: { title: 'Records Management Seminar', dateFrom: '2026-11-10' } });
  assert.strictEqual(j.code, 'TE-2026-002');
  j = call({ action: 'saveTraining', token: staff, training: { title: 'Next year', dateFrom: '2027-01-15' } });
  assert.strictEqual(j.code, 'TE-2027-001');
});

test('the public form shows the training without names of participants', () => {
  const j = call({ action: 'evalInfo', code: 'te 2026 1' });
  assert.ok(j.ok, j.error);
  assert.strictEqual(j.training.title, 'Basic Life Support Training');
  same(Object.keys(j.training).sort(), ['code', 'conductedBy', 'dateFrom', 'dateTo', 'skip', 'speakers', 'status', 'title', 'venue']);
  assert.strictEqual(j.form.items.length, 13);
  assert.match(call({ action: 'evalInfo', code: 'TE-2026-099' }).error, /No training/);
  assert.match(call({ action: 'evalInfo', code: 'hello' }).error, /not a training code/);
});

test('a participant must answer everything', () => {
  let a = fullAnswers(); delete a.ratings.c4;
  assert.match(call({ action: 'submitEval', code, answers: a }).error, /II\.A\.4/);
  a = fullAnswers({ gender: '' });
  assert.match(call({ action: 'submitEval', code, answers: a }).error, /gender/);
  a = fullAnswers({ overall: '' });
  assert.match(call({ action: 'submitEval', code, answers: a }).error, /part III/);
  a = fullAnswers({ rp: [{ name: 'Dr. Ana Reyes', ratings: { r1: 'E' } }] });
  assert.match(call({ action: 'submitEval', code, answers: a }).error, /Dr\. Ana Reyes/);
});

test('a participant answer is saved, with N/A for venue items not rated', () => {
  const j = call({ action: 'submitEval', code, answers: fullAnswers({ suggestions: '=HYPERLINK("x")' }) });
  assert.ok(j.ok, j.error);
  assert.strictEqual(j.no, 'TE-2026-001-001');
  const row = tab('Responses')[1];
  assert.strictEqual(row[0], 'TE-2026-001-001');
  assert.ok(row.includes('N/A'));
  assert.ok(!String(row.join('|')).includes('=HYPERLINK'));   // no formulas from the page
  const rp = tab('Resource Person Ratings');
  assert.strictEqual(rp.length, 2);   // header + Dr. Reyes only; Mr. Cruz was skipped
  assert.strictEqual(rp[1][2], 'Dr. Ana Reyes');
  assert.strictEqual(call({ action: 'submitEval', code, answers: fullAnswers() }).no, 'TE-2026-001-002');
});

test('names on the list only; unknown resource persons are ignored', () => {
  const j = call({ action: 'submitEval', code, answers: fullAnswers({ rp: [{ name: 'Someone Else', ratings: { r1: 'E', r2: 'E', r3: 'E', r4: 'E', r5: 'E' } }] }) });
  assert.ok(j.ok);
  assert.strictEqual(tab('Resource Person Ratings').length, 3);
});

test('HRDU encodes a paper form with blanks; load returns the ratings', () => {
  const j = call({ action: 'encodeResponse', token: staff, code, answers: { gender: 'Male', ratings: { p1: 'S' }, overall: 'VS',
    rp: [{ name: 'Mr. Ben Cruz', ratings: { r1: 'VS', r5: 'E' } }] } });
  assert.ok(j.ok, j.error);
  const r = j.responses.find(x => x.no === j.no);
  assert.strictEqual(r.source, 'Paper form');
  assert.strictEqual(r.encodedBy, 'Juan Dela Cruz');
  assert.strictEqual(r.ratings[0], 'S');
  assert.strictEqual(r.ratings[10], 'N/A');   // v3 Accommodation is not rated for this training
  same(r.rp, [{ name: 'Mr. Ben Cruz', ratings: ['VS', '', '', '', 'E'] }]);
  assert.strictEqual(j.responses.find(x => x.no === 'TE-2026-001-001').rp[0].ratings.join(','), 'E,E,VS,VS,E');
});

test('a closed training takes no more online answers', () => {
  assert.match(call({ action: 'setStatus', token: viewer, code, status: 'Closed' }).error, /role/);
  assert.ok(call({ action: 'setStatus', token: staff, code, status: 'Closed' }).ok);
  assert.match(call({ action: 'submitEval', code, answers: fullAnswers() }).error, /closed/);
  assert.ok(call({ action: 'encodeResponse', token: staff, code, answers: { gender: 'Female' } }).ok);   // paper forms still go in
  call({ action: 'setStatus', token: staff, code, status: 'Open' });
});

test('a rated resource person cannot be removed from the training', () => {
  const j = call({ action: 'saveTraining', token: staff, training: { code, title: 'Basic Life Support Training', dateFrom: '2026-11-03', speakers: ['Mr. Ben Cruz'] } });
  assert.match(j.error, /Dr\. Ana Reyes already has ratings/);
  const k = call({ action: 'saveTraining', token: staff, training: { code, title: 'Basic Life Support (BLS) Training', dateFrom: '2026-11-03', dateTo: '2026-11-04',
    speakers: ['Dr. Ana Reyes', 'Mr. Ben Cruz', 'Ms. Carla Lim'] } });
  assert.ok(k.ok, k.error);
  assert.strictEqual(k.code, code);
  assert.strictEqual(k.trainings.find(x => x.code === code).speakers.length, 3);
});

test('only the head voids, with a reason; the row stays', () => {
  assert.match(call({ action: 'voidResponse', token: staff, no: 'TE-2026-001-002', reason: 'Duplicate' }).error, /role/);
  assert.match(call({ action: 'voidResponse', token: head, no: 'TE-2026-001-002', reason: '' }).error, /reason/);
  const j = call({ action: 'voidResponse', token: head, no: 'TE-2026-001-002', reason: 'Sent twice from one phone' });
  assert.ok(j.ok, j.error);
  const r = j.responses.find(x => x.no === 'TE-2026-001-002');
  assert.strictEqual(r.status, 'Voided');
  assert.strictEqual(r.voidReason, 'Sent twice from one phone');
  assert.ok(tab('Resource Person Ratings').some(x => x[0] === 'TE-2026-001-002' && x[x.length - 1] === 'Voided'));
});

test('the link with ?t= opens that training; other text is ignored', () => {
  const page = be.code.doGet({ parameter: { t: 'TE-2026-001' } });
  assert.match(page.html, /const BOOT_T = "TE-2026-001";/);
  assert.strictEqual(page.title, 'Training Evaluation');
  const bad = be.code.doGet({ parameter: { t: '"</script><script>alert(1)</script>' } });
  assert.match(bad.html, /const BOOT_T = \/\*BOOT\*\/"";/);
});

test('backup, audit trail and sign-in lockout', () => {
  assert.ok(call({ action: 'backupNow', token: head }).ok);
  assert.strictEqual(be.gas._copies.length, 1);
  const actions = tab('Audit Trail').map(r => r[2]);
  ['TRAINING ADDED', 'PAPER FORM ENCODED', 'EVALUATION CLOSED', 'RESPONSE VOIDED', 'BACKUP'].forEach(a => assert.ok(actions.includes(a), a));
  for (let i = 0; i < 5; i++) call({ action: 'signIn', username: 'viewer', password: 'wrong' });
  assert.match(call({ action: 'signIn', username: 'viewer', password: 'viewpass1' }).error, /15 minutes/);
});

test('an account saved as Head in 1.0.0 is an Administrator', () => {
  const us = be.gas._ss.getSheetByName('Users');
  us._data[1][3] = 'Head';
  const j = call({ action: 'listUsers', token: head });
  assert.ok(j.ok, j.error);
  assert.strictEqual(j.users[0].role, 'Administrator');
});

test('there is always an active administrator', () => {
  assert.match(call({ action: 'saveUser', token: head, user: { username: 'hrdu.head', role: 'Staff' } }).error, /at least one active Administrator/);
});

console.log(passed + ' passed');
