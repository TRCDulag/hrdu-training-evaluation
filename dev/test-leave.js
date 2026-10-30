// Leave card tests: CSC rules on the mock of Google services, with the clock fixed at Oct 30, 2026. Run: npm test
const assert = require('assert');
const { loadBackend, seed } = require('./mock-gas');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok   ' + name); }
  catch (e) { console.log('FAIL ' + name + '\n     ' + (e.stack || e).split('\n').slice(0, 3).join('\n     ')); process.exitCode = 1; }
}

const be = loadBackend(Date.parse('2026-10-30T10:00:00+08:00')); seed(be);
const call = req => be.code.handle_(JSON.parse(JSON.stringify(req)));
const tab = n => be.gas._ss.getSheetByName(n)._data.filter(r => r.some(v => v !== ''));
const signIn = (u, pw) => { const s = call({ action: 'signIn', username: u, password: pw }); assert.ok(s.ok, s.error); return s; };
const newAccount = (head, u, role, empNo) => {
  const j = call({ action: 'saveUser', token: head, user: { isNew: true, username: u, fullName: u, role, empNo } });
  assert.ok(j.ok, j.error);
  const s = signIn(u, j.tempPassword);
  assert.ok(call({ action: 'changePassword', token: s.token, old: j.tempPassword, password: 'pass1234x' }).ok);
  return s.token;
};
const ctx = k => require('vm').runInContext(k, be.ctx);

let head, staff, viewer, emp;
const ana = { isNew: true, empNo: '2019-0012', last: 'Reyes', first: 'Ana', middle: 'Cruz', position: 'Nurse II', office: 'Nursing',
  appointment: 'Permanent', appointed: '2019-03-01', cardStart: '2026-01-01', salary: '30,000', highest: '45000', vl: '12', sl: '20' };

test('CSC conversion tables', () => {
  const m = ctx('minutesToDays_'), e = ctx('earned_');
  [[1, .002], [6, .012], [7, .015], [10, .021], [18, .037], [25, .052], [30, .062], [40, .083], [45, .094], [55, .115], [60, .125], [85, .177], [480, 1]]
    .forEach(([min, d]) => assert.strictEqual(m(min), d, min + ' minutes'));
  [[30, 0, 1.25], [30, 1, 1.208], [30, 2, 1.167], [30, 3, 1.125], [30, 0.5, 1.229], [15, 0, 0.625], [30, 30, 0], [30, 10, 0.833]]
    .forEach(([d, l, n]) => assert.strictEqual(e(d, l), n, d + '/' + l));
  assert.strictEqual(ctx('serviceDays_')('2026-03', '2026-03-17', ''), 15);
  assert.strictEqual(ctx('serviceDays_')('2026-02', '2026-01-01', ''), 30);
});

test('accounts: staff with roles, and staff roles only from Accounts', () => {
  head = call({ action: 'firstHead', pin: '1234', user: { username: 'hrdu.head', fullName: 'Maria Santos', position: 'AO IV', password: 'secret123' } }).token;
  staff = newAccount(head, 'encoder', 'Staff');
  viewer = newAccount(head, 'viewer', 'Viewer');
  assert.match(call({ action: 'saveUser', token: head, user: { isNew: true, username: 'emp1', fullName: 'X', role: 'Employee' } }).error, /Employee accounts are made/);
});

test('HRDU adds an employee with the balances carried over', () => {
  assert.match(call({ action: 'saveEmployee', token: viewer, employee: ana }).error, /role/);
  assert.match(call({ action: 'saveEmployee', token: staff, employee: Object.assign({}, ana, { appointment: '' }) }).error, /appointment/);
  const j = call({ action: 'saveEmployee', token: staff, employee: ana });
  assert.ok(j.ok, j.error);
  const e = j.employees[0];
  assert.strictEqual(e.empNo, '2019-0012'); assert.strictEqual(e.salary, 30000); assert.strictEqual(e.name, 'Reyes, Ana Cruz');
  // 12 + 9 months (Jan to Sep) x 1.25
  assert.strictEqual(e.vl, 23.25); assert.strictEqual(e.sl, 31.25);
  assert.match(call({ action: 'saveEmployee', token: staff, employee: ana }).error, /already/);
  assert.strictEqual(j.through, '2026-09');
});

test('leave without pay lowers what the month earns', () => {
  let j = call({ action: 'saveEntry', token: staff, entry: { empNo: '2019-0012', kind: 'Absence without pay', from: '2026-06-15', to: '2026-06-16', days: 2 } });
  assert.ok(j.ok, j.error);
  const june = j.rows.find(r => r.kind === 'Earned' && r.period === '2026-06');
  assert.strictEqual(june.vlEarned, 1.167); assert.strictEqual(june.slEarned, 1.167);
  assert.strictEqual(j.vl, 23.167);
});

test('tardiness is charged to VL using the conversion table', () => {
  const j = call({ action: 'saveEntry', token: staff, entry: { empNo: '2019-0012', kind: 'Tardiness/Undertime', month: '2026-03', times: 7, late: 85, under: 40 } });
  assert.ok(j.ok, j.error);
  const r = j.rows.find(x => x.kind === 'Tardiness/Undertime');
  assert.strictEqual(r.vlWP, minutes(125));
  assert.strictEqual(j.vl, Math.round((23.167 - minutes(125)) * 1000) / 1000);
  function minutes(n) { return ctx('minutesToDays_')(n); }
});

test('sick leave beyond SL goes to VL, then without pay', () => {
  const card = ctx('splitLeave_');
  assert.strictEqual(JSON.stringify(card('SL', 5, { vl: 2, sl: 2.5 }, false)), JSON.stringify({ vlWP: 2, vlWOP: 0, slWP: 2.5, slWOP: 0.5 }));
  assert.strictEqual(JSON.stringify(card('VL', 3, { vl: 1, sl: 9 }, false)), JSON.stringify({ vlWP: 1, vlWOP: 2, slWP: 0, slWOP: 0 }));
});

test('special privilege leave is at most 3 days a year', () => {
  let j = call({ action: 'saveEntry', token: staff, entry: { empNo: '2019-0012', kind: 'Leave', type: 'Special Privilege Leave', from: '2026-04-06', to: '2026-04-07', days: 2 } });
  assert.ok(j.ok, j.error);
  assert.strictEqual(j.years[2026].spl, 2);
  j = call({ action: 'saveEntry', token: staff, entry: { empNo: '2019-0012', kind: 'Leave', type: 'Special Privilege Leave', from: '2026-05-06', to: '2026-05-07', days: 2 } });
  assert.match(j.error, /at most 3 days/);
});

test('monetization rules and the 0.0481927 factor', () => {
  let j = call({ action: 'saveEntry', token: staff, entry: { empNo: '2019-0012', kind: 'Monetization', from: '2026-10-01', days: 5 } });
  assert.match(j.error, /at least 10/);
  j = call({ action: 'saveEntry', token: staff, entry: { empNo: '2019-0012', kind: 'Monetization', from: '2026-10-01', days: 20 } });
  assert.match(j.error, /5 days of VL must be left/);
  j = call({ action: 'saveEntry', token: staff, entry: { empNo: '2019-0012', kind: 'Monetization', from: '2026-10-01', days: 10 } });
  assert.ok(j.ok, j.error);
  const r = j.rows.find(x => x.kind === 'Monetization');
  assert.strictEqual(r.amount, 14457.81);
});

test('only the Administrator adjusts and voids', () => {
  assert.match(call({ action: 'saveEntry', token: staff, entry: { empNo: '2019-0012', kind: 'Adjustment', from: '2026-10-01', vlAdd: 1, reason: 'x' } }).error, /Administrator/);
  let j = call({ action: 'saveEntry', token: head, entry: { empNo: '2019-0012', kind: 'Adjustment', from: '2026-10-01', vlAdd: 0.5, reason: 'Correction of 2025 card' } });
  assert.ok(j.ok, j.error);
  const no = j.no, before = j.vl;
  assert.match(call({ action: 'voidEntry', token: staff, no, reason: 'x' }).error, /role/);
  j = call({ action: 'voidEntry', token: head, no, reason: 'Typed twice' });
  assert.ok(j.ok, j.error);
  assert.strictEqual(j.vl, Math.round((before - 0.5) * 1000) / 1000);
  assert.ok(tab('Leave Ledger').some(r => r[0] === no && r.includes('Voided')));
});

test('employee account sees only its own card', () => {
  call({ action: 'saveEmployee', token: staff, employee: Object.assign({}, ana, { empNo: '2020-0001', last: 'Bautista', first: 'Ben', vl: 3, sl: 3 }) });
  const j = call({ action: 'empAccount', token: staff, empNo: '2019-0012' });
  assert.ok(j.ok, j.error);
  const m = j.made[0];
  assert.strictEqual(m.username, '2019-0012');
  assert.match(call({ action: 'empAccount', token: staff, empNo: '2019-0012' }).error, /already has an account/);
  const s = signIn('2019-0012', m.tempPassword);
  assert.strictEqual(s.me.role, 'Employee');
  call({ action: 'changePassword', token: s.token, old: m.tempPassword, password: 'mine12345' });
  emp = s.token;
  ['load', 'leaveLoad', 'leaveCard', 'saveEntry', 'listUsers'].forEach(a => assert.match(call({ action: a, token: emp, empNo: '2020-0001' }).error, /role/, a));
  const mine = call({ action: 'myLeave', token: emp, empNo: '2020-0001' });
  assert.ok(mine.ok, mine.error);
  assert.strictEqual(mine.employee.empNo, '2019-0012');
  assert.ok(mine.rows.every(r => !('by' in r)));
  const all = call({ action: 'empAccount', token: staff, mode: 'all' });
  assert.strictEqual(all.made.length, 1); assert.strictEqual(all.made[0].empNo, '2020-0001');
});

test('signatories and the CS Form No. 6 flow', () => {
  assert.match(call({ action: 'saveSigner', token: staff, signer: { name: 'X' } }).error, /role/);
  [['HRDU OFFICER', 'Administrative Officer IV', ['Certification of leave credits']], ['UNIT HEAD', 'Nurse V', ['Recommendation']],
   ['CHIEF', 'Chief of Hospital III', ['Approval']]].forEach(([name, position, signsFor]) =>
    assert.ok(call({ action: 'saveSigner', token: head, signer: { name, position, signsFor } }).ok));
  let j = call({ action: 'fileLeave', token: emp, app: { empNo: '2020-0001', type: 'Vacation Leave', details: 'Within the Philippines', specify: 'Tacloban',
    from: '2026-11-09', to: '2026-11-11', days: 3, recommendedBy: 'UNIT HEAD' } });
  assert.ok(j.ok, j.error);
  assert.strictEqual(j.employee.empNo, '2019-0012');   // always the signed-in employee
  const no = j.appNo;
  assert.match(no, /^LA-2026-0001$/);
  const a = j.apps.find(x => x.no === no);
  assert.strictEqual(a.cert.asOf, '2026-09-30');
  assert.strictEqual(a.cert.lessVl, 3);
  assert.match(call({ action: 'actOnLeave', token: emp, app: { no, decision: 'Approved' } }).error, /role/);
  assert.match(call({ action: 'actOnLeave', token: staff, app: { no, approvedBy: 'UNIT HEAD' } }).error, /not on the list/);
  const before = call({ action: 'leaveCard', token: staff, empNo: '2019-0012' }).rows.length;
  j = call({ action: 'actOnLeave', token: staff, app: { no, certifiedBy: 'HRDU OFFICER', approvedBy: 'CHIEF', recommendation: 'For approval', decision: 'Approved', withPay: 3, withoutPay: 0 } });
  assert.ok(j.ok, j.error);
  assert.strictEqual(j.rows.length, before + 1);
  const r = j.rows.find(x => x.appNo === no);
  assert.strictEqual(r.vlWP, 3);
  assert.strictEqual(j.apps.find(x => x.no === no).status, 'Approved');
  assert.match(call({ action: 'cancelLeave', token: emp, no }).error, /not yet acted on/);
  // An employee cannot touch another employee's application.
  const other = call({ action: 'fileLeave', token: staff, app: { empNo: '2020-0001', type: 'Sick Leave', details: 'Out Patient (Specify Illness)', specify: 'Flu', from: '2026-10-05', days: 1 } });
  assert.ok(other.ok, other.error);
  assert.match(call({ action: 'cancelLeave', token: emp, no: other.appNo }).error, /No application/);
  // Days with pay cannot go past the credits.
  assert.match(call({ action: 'actOnLeave', token: staff, app: { no: other.appNo, decision: 'Approved', withPay: 40 } }).error, /can be with pay/);
});

test('forced leave at the end of the year', () => {
  const rows = call({ action: 'forcedPreview', token: viewer, year: 2026 }).rows;
  const a = rows.find(x => x.empNo === '2019-0012');
  assert.strictEqual(a.need, 5); assert.strictEqual(a.taken, 3); assert.strictEqual(a.forfeit, 2);
  assert.match(call({ action: 'postForced', token: head, year: 2026 }).error, /January 1, 2027/);
  // From Jan 1, 2027 it posts once; someone excused by the head is not charged.
  const b2 = loadBackend(Date.parse('2027-01-02T10:00:00+08:00')); seed(b2);
  const c2 = req => b2.code.handle_(JSON.parse(JSON.stringify(req)));
  const h2 = c2({ action: 'firstHead', pin: '1234', user: { username: 'hrdu.head', fullName: 'Maria Santos', password: 'secret123' } }).token;
  c2({ action: 'saveEmployee', token: h2, employee: ana });
  c2({ action: 'saveEmployee', token: h2, employee: Object.assign({}, ana, { empNo: 'B-2', last: 'Lim' }) });
  assert.match(c2({ action: 'postForced', token: h2, year: 2026, skip: ['B-2'] }).error, /reason/);
  const p = c2({ action: 'postForced', token: h2, year: 2026, skip: ['B-2'], reason: 'Leave cancelled by the Chief for the service' });
  assert.ok(p.ok, p.error);
  assert.strictEqual(JSON.stringify(p.posted), '["2019-0012"]');
  assert.strictEqual(p.rows.find(x => x.empNo === '2019-0012').posted, 5);
  assert.strictEqual(c2({ action: 'postForced', token: h2, year: 2026 }).posted.length, 1);   // B-2 only, the rest already posted
});

test('separation disables the employee account', () => {
  const j = call({ action: 'saveEmployee', token: staff, employee: Object.assign({}, ana, { isNew: false, status: 'Separated', separated: '2026-10-15' }) });
  assert.ok(j.ok, j.error);
  assert.match(call({ action: 'myLeave', token: emp }).error, /not active/);
  // October earns for 15 days of service: 0.625
  const c = call({ action: 'leaveCard', token: staff, empNo: '2019-0012' });
  const oct = c.rows.find(r => r.kind === 'Earned' && r.period === '2026-10');
  assert.strictEqual(oct.vlEarned, 0.625);
});

console.log(passed + ' passed');
