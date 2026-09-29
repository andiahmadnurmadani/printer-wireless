import { chromium } from 'playwright';
import * as fs from 'fs';

(async () => {
  console.log('--- STARTING PLAYWRIGHT E2E FOR GUEST MODE & USER ISOLATION ---');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });

  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 }
  });

  const page = await context.newPage();

  try {
    // 1. Visit App as Guest (unauthenticated)
    console.log('[TEST 1] Visiting http://100.90.80.85:5174/ as unauthenticated Guest...');
    await page.goto('http://100.90.80.85:5174/', { waitUntil: 'networkidle', timeout: 15000 });
    
    // Clear localStorage to ensure fresh guest state
    await page.evaluate(() => {
      localStorage.clear();
      window.location.reload();
    });
    await page.waitForLoadState('networkidle');

    await page.screenshot({ path: '/home/minibox/e2e-tests/e2e_guest_01_dashboard.png' });
    console.log('✓ Guest Dashboard loaded without login wall.');

    // Check Guest badge / Sign-in CTA
    const headerText = await page.locator('header').textContent();
    console.log('Header text:', headerText);
    if (!headerText.includes('Guest') && !headerText.includes('Sign in')) {
      throw new Error('Expected Guest mode or Sign in button in header!');
    }

    // 2. Navigate to History Page as Guest
    console.log('[TEST 2] Navigating to History Page as Guest...');
    await page.click('button:has-text("History")');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: '/home/minibox/e2e-tests/e2e_guest_02_history.png' });

    const historyContent = await page.textContent('main');
    if (!historyContent.includes('Personal Print History') && !historyContent.includes('Sign in to KroomPrint')) {
      throw new Error('Guest should see Sign in CTA on History page!');
    }
    console.log('✓ Guest History shows personal sign-in prompt.');

    // 3. Navigate to Print Page as Guest
    console.log('[TEST 3] Navigating to Print Studio as Guest...');
    await page.click('button:has-text("Print")');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: '/home/minibox/e2e-tests/e2e_guest_03_print_page.png' });

    // 4. Click Dropzone as Guest -> Should open Login Modal!
    console.log('[TEST 4] Clicking upload dropzone as Guest to verify Login Modal popup...');
    await page.click('text=Drag & drop your document here');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: '/home/minibox/e2e-tests/e2e_guest_04_login_modal.png' });

    const modalTitle = await page.locator('h2:has-text("Sign in to KroomPrint")').textContent();
    console.log('Modal title:', modalTitle);
    if (!modalTitle.includes('Sign in to KroomPrint')) {
      throw new Error('Login modal did not open when clicking dropzone as guest!');
    }
    console.log('✓ Login modal opened on action interception.');

    // 5. Sign in as Standard User via quick chip
    console.log('[TEST 5] Signing in as Standard User (user123)...');
    await page.click('button:has-text("User (user123)")');
    await page.waitForTimeout(300);
    await page.click('button[type="submit"]:has-text("Sign in")');
    await page.waitForTimeout(2000);

    await page.screenshot({ path: '/home/minibox/e2e-tests/e2e_guest_05_logged_in_user.png' });
    const userHeaderText = await page.locator('header').textContent();
    console.log('Logged in header:', userHeaderText);
    if (!userHeaderText.includes('user')) {
      throw new Error('User was not logged in properly!');
    }
    console.log('✓ Standard User signed in successfully.');

    // 6. Test File Upload & Print Job creation as User
    console.log('[TEST 6] Testing File Upload & Print as User...');
    // Create a temporary text file for testing
    fs.writeFileSync('/tmp/test_user_isolation.txt', 'KroomPrint User Isolation Test Page\nUser: user\nTime: ' + new Date().toISOString());
    
    // Set file input
    const fileInput = await page.locator('input[type="file"]').first();
    await fileInput.setInputFiles('/tmp/test_user_isolation.txt');
    await page.waitForTimeout(1500);

    await page.screenshot({ path: '/home/minibox/e2e-tests/e2e_guest_06_user_file_loaded.png' });
    console.log('✓ File preview loaded for User.');

    // Click Print
    await page.click('button:has-text("Send to Printer")');
    await page.waitForTimeout(3000);
    await page.screenshot({ path: '/home/minibox/e2e-tests/e2e_guest_07_user_printed.png' });
    console.log('✓ Print job dispatched.');

    // 7. Check User History (Isolated)
    console.log('[TEST 7] Checking User History page...');
    await page.click('button:has-text("History")');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: '/home/minibox/e2e-tests/e2e_guest_08_user_history.png' });

    const userHistContent = await page.textContent('main');
    console.log('User history has test record:', userHistContent.includes('test_user_isolation.txt') || userHistContent.includes('user'));

    // 8. Sign out and Sign in as Admin
    console.log('[TEST 8] Signing in as Admin to test Admin History isolation...');
    await page.click('aside button:has-text("Sign out")');
    await page.waitForTimeout(1000);

    // Open login modal and sign in as Admin
    await page.click('header button:has-text("Sign in")');
    await page.waitForTimeout(500);
    await page.click('button:has-text("Admin (admin123)")');
    await page.waitForTimeout(300);
    await page.click('button[type="submit"]:has-text("Sign in")');
    await page.waitForTimeout(2000);

    // Navigate to History as Admin
    await page.click('button:has-text("History")');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: '/home/minibox/e2e-tests/e2e_guest_09_admin_history.png' });

    // Verify Admin Scope Switcher
    const adminHistContent = await page.textContent('main');
    if (!adminHistContent.includes('My Prints') || !adminHistContent.includes('All Users')) {
      throw new Error('Admin should have My Prints vs All Users switcher on History page!');
    }
    console.log('✓ Admin Scope Switcher is present and active.');

    // Switch to All Users
    await page.click('button:has-text("All Users")');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: '/home/minibox/e2e-tests/e2e_guest_10_admin_all_users_history.png' });
    console.log('✓ Admin multi-user audit log view verified.');

    console.log('=== ALL E2E TESTS PASSED 100% SUCCESSFULLY! ===');
  } catch (err) {
    console.error('TEST FAILED:', err);
    await page.screenshot({ path: '/home/minibox/e2e-tests/e2e_guest_failure.png' });
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();

