// Browser test: runs the page against Code.gs on the mock, as HRDU and as a participant. Run: npm run test:e2e
// Screenshots go to dev/screenshots.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { start } = require('./server');

const shots = path.join(__dirname, 'screenshots');
fs.mkdirSync(shots, { recursive: true });

(async () => {
  const port = 8791, base = 'http://localhost:' + port;
  const { server } = await start(port);
  const browser = await chromium.launch();
  const errors = [];
  const watch = p => { p.on('pageerror', e => errors.push(e.message)); p.on('dialog', d => d.accept(d.type() === 'prompt' ? 'Sent twice from one phone' : undefined)); return p; };
  try {
    // ---- HRDU: first account, then a training ----
    const pc = watch(await browser.newPage({ viewport: { width: 1280, height: 860 } }));
    await pc.goto(base);
    await pc.waitForSelector('#setupForm:not(.hidden)');
    await pc.screenshot({ path: path.join(shots, '00-first-account.png') });
    await pc.fill('#suPin', '1234'); await pc.fill('#suName', 'Maria L. Santos'); await pc.fill('#suUser', 'msantos'); await pc.fill('#suPw', 'hrdu2026ok');
    await pc.click('#suBtn');
    await pc.waitForSelector('#app:not(.hidden)');
    await pc.click('#hAdd');
    await pc.fill('#trTitle', 'Basic Life Support (BLS) Training');
    await pc.fill('#trFrom', '2026-11-03'); await pc.fill('#trTo', '2026-11-04');
    await pc.fill('#trVenue', 'TRC Dulag Function Hall'); await pc.fill('#trExp', '25');
    await pc.fill('#trRp', 'Dr. Ana Reyes\nMr. Ben Cruz');
    await pc.check('#trSkip input[value="v3"]');
    await pc.screenshot({ path: path.join(shots, '01-add-training.png') });
    await pc.click('#trSave');
    await pc.waitForSelector('#shDlg[open]');
    assert.match(await pc.inputValue('#shLink'), /^https:\/\/trcdulag\.github\.io\/hrdu-training-evaluation\/#t=TE-2026-001$/);
    await pc.screenshot({ path: path.join(shots, '02-share.png') });
    await pc.click('#shDlg [data-close]');

    // ---- participant on a phone ----
    const ph = watch(await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }));
    await ph.goto(base + '/?t=TE-2026-001');
    await ph.waitForSelector('#evForm');
    assert.strictEqual(await ph.locator('fieldset[data-name="evv3"]').count(), 0, 'Accommodation is left out');
    await ph.screenshot({ path: path.join(shots, '03-phone-form.png') });
    await ph.click('#evSend');
    assert.match(await ph.textContent('#evMsg'), /province/);
    await ph.fill('input[name="evprovince"]', 'Leyte');
    await ph.click('#evSend');
    assert.match(await ph.textContent('#evMsg'), /gender/);
    await ph.click('.choice label:has-text("Female")');
    await ph.click('#evSend');
    assert.match(await ph.textContent('#evMsg'), /marked in red/);
    await ph.screenshot({ path: path.join(shots, '04-phone-missing.png') });
    const pickAll = async (p, val) => {
      for (const fs of await p.locator('#evBody fieldset.q').all()) if (await fs.isVisible()) await fs.locator(`label.${val}`).click();
    };
    await ph.check('.rpcard[data-rp="1"] .rpskip');   // did not attend Mr. Cruz's session
    await pickAll(ph, 'E');
    await ph.locator('fieldset[data-name="evc4"] label.VS').click();
    await ph.fill('textarea[name="evsugg"]', 'More practice time on the manikins, please.');
    await ph.click('#evSend');
    await ph.waitForSelector('.thanks');
    await ph.screenshot({ path: path.join(shots, '05-phone-thanks.png') });
    // a second participant on the same phone
    await ph.click('#evAgain');
    await ph.waitForSelector('.note');
    await ph.fill('input[name="evprovince"]', 'southern leyte');
    await ph.click('.choice label:has-text("Male")');
    await pickAll(ph, 'VS');
    await ph.click('#evSend');
    await ph.waitForSelector('.thanks');

    // ---- HRDU types in a paper form, then reads the summary ----
    await pc.click('#mReload'.replace('#mReload', '#menuBtn')); await pc.click('#mReload');
    await pc.waitForFunction(() => document.querySelectorAll('#tResp tr[data-n]').length === 2);
    await pc.click('#tEnc');
    await pc.locator('fieldset[data-name="enp1"] label.S').click();
    await pc.locator('fieldset[data-name="enoverall"] label.P').click();
    await pc.locator('fieldset[data-name="enrp1r1"] label.S').click();
    await pc.screenshot({ path: path.join(shots, '06-paper-form.png') });
    await pc.click('#encSave');
    await pc.waitForFunction(() => /Saved as TE-2026-001-003/.test(document.getElementById('encMsg').textContent));
    await pc.click('#encDlg [data-close]');
    const tiles = await pc.textContent('#tTiles');
    assert.match(tiles, /Answers3/);
    // part III: E (4), VS (3), P (1) -> 2.67
    assert.match(tiles, /Over all \(part III\)2\.67Very Satisfactory/);
    await pc.screenshot({ path: path.join(shots, '07-summary.png'), fullPage: true });

    // void the paper form (Administrator)
    await pc.click('#tResp tr[data-n="TE-2026-001-003"]');
    await pc.click('#rsVoid');
    await pc.waitForFunction(() => /Answers2/.test(document.getElementById('tTiles').textContent));
    assert.match(await pc.textContent('#tTiles'), /Over all \(part III\)3\.50Excellent/);

    // printouts render
    await pc.evaluate(() => { window.print = () => {}; });
    for (const [btn, name] of [['#tPrint', '08-print-summary'], ['#tBlank', '09-print-blank-form']]) {
      await pc.click(btn);
      await pc.waitForTimeout(300);
      await pc.emulateMedia({ media: 'print' });
      await pc.evaluate(() => document.body.classList.add('printing'));
      await pc.setViewportSize({ width: 794, height: 1123 });
      await pc.screenshot({ path: path.join(shots, name + '.png'), fullPage: true });
      await pc.pdf({ path: path.join(shots, name + '.pdf'), format: 'A4', printBackground: true });
      await pc.emulateMedia({ media: 'screen' });
      await pc.evaluate(() => document.body.classList.remove('printing'));
      await pc.setViewportSize({ width: 1280, height: 860 });
    }
    const pdfPages = n => (fs.readFileSync(path.join(shots, n + '.pdf'), 'latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    assert.strictEqual(pdfPages('09-print-blank-form'), 1, 'the blank form fits on one A4 page');

    // yearly report and close the form
    await pc.click('nav.tabs button[data-v="rep"]');
    assert.match(await pc.textContent('#rBody'), /Basic Life Support[\s\S]*3\.50/);
    await pc.screenshot({ path: path.join(shots, '10-yearly-report.png') });
    await pc.click('nav.tabs button[data-v="home"]');
    await pc.screenshot({ path: path.join(shots, '11-trainings.png') });
    await pc.click('#hBody tr[data-c="TE-2026-001"]');
    await pc.click('#tOpen');
    await pc.waitForFunction(() => /Online form closed/.test(document.getElementById('tMeta').textContent));
    await ph.goto(base + '/?t=TE-2026-001');
    await ph.waitForSelector('text=The evaluation for this training is closed');

    // accounts
    await pc.click('nav.tabs button[data-v="acc"]');
    await pc.click('#aAdd');
    await pc.fill('#usName', 'Juan Dela Cruz'); await pc.fill('#usUser', 'jdelacruz');
    await pc.click('#usSave');
    await pc.waitForSelector('#usTemp:not(.hidden)');
    await pc.screenshot({ path: path.join(shots, '12-accounts.png') });


    // ---- leave cards (CSC rules) and CS Form No. 6 ----
    await pc.click('#usDlg [data-close]');
    for (const [name, pos, box] of [['JEAN D. CRUZ', 'Administrative Officer IV', 'Certification of leave credits'], ['DR. PAUL MENDOZA', 'Medical Officer IV', 'Recommendation'], ['DR. LUZ VILLANUEVA', 'Chief of Hospital III', 'Approval']]) {
      await pc.click('#sgAdd'); await pc.fill('#sgName', name); await pc.fill('#sgPos', pos);
      await pc.check(`#sgFor input[value="${box}"]`); await pc.click('#sgSave');
      await pc.waitForSelector(`#sgBody tr[data-s="${name}"]`);
    }
    await pc.click('nav.tabs button[data-v="lv"]');
    await pc.waitForSelector('#lvBody .empty');
    await pc.click('#lvAdd');
    await pc.fill('#emNo', 'TRCD-0112'); await pc.selectOption('#emAppt', 'Permanent');
    await pc.fill('#emLast', 'Reyes'); await pc.fill('#emFirst', 'Ana'); await pc.fill('#emMid', 'Cruz');
    await pc.fill('#emPos', 'Nurse II'); await pc.fill('#emOff', 'Nursing Service'); await pc.fill('#emAppd', '2019-03-01');
    await pc.fill('#emStart', '2026-01-01'); await pc.fill('#emVl', '12'); await pc.fill('#emSl', '20'); await pc.fill('#emSal', '36619'); await pc.fill('#emHigh', '36619');
    await pc.screenshot({ path: path.join(shots, '13-add-employee.png') });
    await pc.click('#emSave');
    await pc.waitForSelector('#v-card:not(.hidden) #cTiles .tile');
    await pc.click('#v-card [data-kind="Tardiness/Undertime"]');
    await pc.fill('#enMonth', '2026-03'); await pc.fill('#enTimes', '7'); await pc.fill('#enLate', '85'); await pc.fill('#enUnder', '40');
    assert.match(await pc.textContent('#enHint'), /125 minutes = 0\.260/);
    await pc.click('#enSave');
    await pc.waitForSelector('#cBody td:has-text("Tardiness/undertime")');
    await pc.click('#v-card [data-kind="Absence without pay"]');
    await pc.fill('#enFrom', '2026-06-15'); await pc.fill('#enTo', '2026-06-16');
    assert.strictEqual(await pc.inputValue('#enDays'), '2');
    await pc.click('#enSave');
    await pc.waitForSelector('#cBody td:has-text("Absence without pay")');
    assert.match(await pc.textContent('#cBody'), /June 2026Earned \(2 days without pay\)\s*1\.167/);
    await pc.screenshot({ path: path.join(shots, '14-leave-card.png'), fullPage: true });

    // accounts for every employee; the employee signs in on a phone
    await pc.click('#v-card [data-go="lv"]');
    await pc.click('#lvAccAll');
    await pc.waitForSelector('#eaDlg[open] .temp');
    const temp = (await pc.textContent('#eaDlg .temp')).trim();
    await pc.click('#eaDlg [data-close]');
    const em = watch(await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }));
    await em.goto(base);
    await em.fill('#uIn', 'trcd-0112'); await em.fill('#pwIn', temp); await em.click('#lockBtn');
    await em.waitForSelector('#chgForm:not(.hidden)');
    await em.fill('#chgPw', 'anareyes2026'); await em.fill('#chgPw2', 'anareyes2026'); await em.click('#chgBtn');
    await em.waitForSelector('#v-card.self:not(.hidden) #cTiles .tile');
    assert.ok(!(await em.isVisible('nav.tabs button[data-v="home"]')), 'an employee sees no trainings');
    await em.screenshot({ path: path.join(shots, '15-phone-my-leave.png'), fullPage: true });
    await em.click('#cApply');
    await em.selectOption('#laType', 'Vacation Leave');
    await em.fill('#laFrom', '2026-11-09'); await em.fill('#laTo', '2026-11-11');
    assert.strictEqual(await em.inputValue('#laDays'), '3');
    await em.selectOption('#laRec', 'DR. PAUL MENDOZA');
    await em.screenshot({ path: path.join(shots, '16-phone-apply.png'), fullPage: true });
    await em.click('#laSave');
    await em.waitForSelector('#acDlg[open]');
    assert.match(await em.textContent('#acSum'), /Waiting for action/);

    // HRDU picks the signatories, prints CS Form No. 6, then records the approval
    await pc.click('#menuBtn'); await pc.click('#mReload');
    await pc.click('nav.tabs button[data-v="apps"]');
    await pc.waitForSelector('#apBody tr[data-a="LA-2026-0001"]');
    await pc.click('#apBody tr[data-a="LA-2026-0001"]');
    await pc.waitForSelector('#acDlg[open]');
    assert.strictEqual(await pc.inputValue('#acCert'), 'JEAN D. CRUZ');
    assert.strictEqual(await pc.inputValue('#acApp'), 'DR. LUZ VILLANUEVA');
    await pc.selectOption('#acRecV', 'For approval');
    await pc.click('#acSaveS');
    await pc.waitForFunction(() => /Saved/.test(document.getElementById('acMsg').textContent));
    await pc.click('#acPrint');
    await pc.waitForTimeout(300);
    await pc.emulateMedia({ media: 'print' });
    await pc.evaluate(() => document.body.classList.add('printing'));
    await pc.setViewportSize({ width: 816, height: 1248 });
    await pc.screenshot({ path: path.join(shots, '17-print-cs-form-6.png'), fullPage: true });
    await pc.pdf({ path: path.join(shots, '17-print-cs-form-6.pdf'), width: '8.5in', height: '13in', printBackground: true, preferCSSPageSize: true });
    await pc.emulateMedia({ media: 'screen' });
    await pc.evaluate(() => document.body.classList.remove('printing'));
    await pc.setViewportSize({ width: 1280, height: 860 });
    assert.strictEqual(pdfPages('17-print-cs-form-6'), 1, 'CS Form No. 6 fits on one long bond page');
    await pc.click('#acApprove');
    await pc.waitForFunction(() => /Approved and put/.test(document.getElementById('acMsg').textContent));
    await pc.click('#acDlg [data-close]');
    assert.match(await pc.textContent('#cBody'), /Vacation Leave, 3 days/);
    await pc.click('#cPrint');
    await pc.waitForTimeout(300);
    await pc.emulateMedia({ media: 'print' });
    await pc.evaluate(() => document.body.classList.add('printing'));
    await pc.setViewportSize({ width: 1248, height: 816 });
    await pc.screenshot({ path: path.join(shots, '18-print-leave-card.png'), fullPage: true });
    await pc.emulateMedia({ media: 'screen' });
    await pc.evaluate(() => document.body.classList.remove('printing'));
    await pc.setViewportSize({ width: 1280, height: 860 });
    await pc.click('nav.tabs button[data-v="lv"]');
    await pc.waitForSelector('#lvBody tr[data-e="TRCD-0112"]');
    await pc.screenshot({ path: path.join(shots, '19-leave-cards.png') });
    // the sign-in page opens a form from a typed code
    const p3 = watch(await browser.newPage({ viewport: { width: 390, height: 844 } }));
    await p3.goto(base);
    await p3.fill('#codeIn', 'te 2026 1');
    await p3.click('#codeForm button');
    await p3.waitForSelector('text=Basic Life Support (BLS) Training');

    assert.deepStrictEqual(errors, []);
    console.log('e2e ok');
  } catch (e) {
    console.error(e); process.exitCode = 1;
  } finally {
    await browser.close(); server.close();
  }
})();
