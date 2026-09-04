import { chromium } from 'playwright';

(async () => {
  console.log('--- TESTING CLEAN LOGIN MODAL (NO DEMO ROLES) ---');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 }
  });

  const page = await context.newPage();

  try {
    console.log('[TEST] Visiting homepage as Guest...');
    await page.goto('http://100.90.80.85:5174/', { waitUntil: 'networkidle', timeout: 15000 });
    
    // Clear localStorage
    await page.evaluate(() => {
      localStorage.clear();
      window.location.reload();
    });
    await page.waitForLoadState('networkidle');

    // Click Sign In in Header
    console.log('[TEST] Opening Login Modal...');
    await page.click('header button:has-text("Sign in")');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: '/home/minibox/e2e-tests/clean_login_modal.png' });

    const modalText = await page.textContent('.fixed.inset-0.z-\\[100\\]');
    if (modalText.includes('Demo Roles') || modalText.includes('admin123') || modalText.includes('user123')) {
      throw new Error('Login Modal STILL contains Demo Roles buttons or text!');
    }
    console.log('✓ Verified: Demo roles buttons and text are completely removed from Login Modal.');

    // Perform real manual login
    console.log('[TEST] Performing manual login with username and password...');
    await page.fill('#modal-username', 'admin');
    await page.fill('#modal-password', 'admin123');
    await page.click('button[type="submit"]:has-text("Sign in")');
    await page.waitForTimeout(2000);

    const headerText = await page.textContent('header');
    if (!headerText.includes('admin') && !headerText.includes('ADMIN')) {
      throw new Error('Login failed after submitting manual credentials!');
    }
    console.log('✓ Manual login succeeded for admin.');
    await page.screenshot({ path: '/home/minibox/e2e-tests/clean_login_success.png' });

    console.log('=== TEST PASSED: DEMO ROLES SUCCESSFULLY ELIMINATED! ===');
  } catch (err) {
    console.error('TEST FAILED:', err);
    await page.screenshot({ path: '/home/minibox/e2e-tests/clean_login_failure.png' });
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
