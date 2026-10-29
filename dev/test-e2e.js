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
    assert.match(await pc.inputValue('#shLink'), /\?t=TE-2026-001$/);
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
