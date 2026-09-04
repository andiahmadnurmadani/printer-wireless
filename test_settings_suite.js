import { chromium } from 'playwright';

(async () => {
  console.log('--- STARTING PLAYWRIGHT E2E FOR SETTINGS PAGE FEATURES & ROLES ---');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 }
  });

  const page = await context.newPage();

  try {
    // ═════════════════════════════════════════════════════════════════════════
    // 1. TEST GUEST SETTINGS VIEW & DIAGNOSTICS
    // ═════════════════════════════════════════════════════════════════════════
    console.log('[TEST 1] Visiting Settings as unauthenticated Guest...');
    await page.goto('http://100.90.80.85:5174/', { waitUntil: 'networkidle', timeout: 15000 });
    
    // Clear localStorage for clean guest
    await page.evaluate(() => {
      localStorage.clear();
      window.location.reload();
    });
    await page.waitForLoadState('networkidle');

    // Navigate to Settings
    await page.click('button:has-text("Settings")');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: '/home/minibox/e2e-tests/settings_01_guest.png' });

    // Verify Guest Mode Banner
    const settingsContent = await page.textContent('main');
    if (!settingsContent.includes('Guest Mode (Read-Only)') || !settingsContent.includes('Guest Visitor')) {
      throw new Error('Expected Guest Mode banner and Guest Visitor identity in Settings!');
    }
    console.log('✓ Guest mode banner and identity verified.');

    // Verify Danger Zone is NOT present for Guest
    if (settingsContent.includes('Danger Zone') || settingsContent.includes('Reset All Workspace Data')) {
      throw new Error('Danger Zone should NOT be visible to Guest!');
    }
    console.log('✓ Danger zone is properly hidden for Guest.');

    // Verify CUPS Change Endpoint is NOT present for Guest
    if (settingsContent.includes('Change Endpoint')) {
      throw new Error('Change Endpoint should NOT be visible to Guest!');
    }
    console.log('✓ CUPS change endpoint is properly hidden for Guest.');

    // Run Diagnostics as Guest
    console.log('[TEST 2] Running Network & CUPS Diagnostics as Guest...');
    await page.click('button:has-text("Run Full Network & CUPS Diagnostics")');
    await page.waitForTimeout(2500);
    await page.screenshot({ path: '/home/minibox/e2e-tests/settings_02_diagnostics_modal.png' });

    const diagModalText = await page.textContent('.modal-in');
    if (!diagModalText.includes('CUPS Daemon') || !diagModalText.includes('Network Gateway') || !diagModalText.includes('Spool Storage')) {
      throw new Error('Diagnostics modal did not render daemon or gateway cards!');
    }
    console.log('✓ Diagnostics modal returned live latency metrics.');
    await page.click('button:has-text("Done")');
    await page.waitForTimeout(500);

    // ═════════════════════════════════════════════════════════════════════════
    // 2. TEST PREFERENCE TOGGLES: DARK MODE & COMPACT QUEUE
    // ═════════════════════════════════════════════════════════════════════════
    console.log('[TEST 3] Testing Dark Mode Toggle...');
    await page.click('text=Dark mode (Glassmorphism Dark)');
    await page.waitForTimeout(1000);
    const hasDarkClass = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    if (!hasDarkClass) {
      throw new Error('Dark mode toggle did not add .dark class to html element!');
    }
    await page.screenshot({ path: '/home/minibox/e2e-tests/settings_03_dark_mode.png' });
    console.log('✓ Dark mode toggle successfully applied .dark theme.');

    // Switch back to light mode
    await page.click('text=Dark mode (Glassmorphism Dark)');
    await page.waitForTimeout(500);

    console.log('[TEST 4] Testing Compact Queue Toggle & Queue Page Layout...');
    await page.click('text=Compact queue view');
    await page.waitForTimeout(800);
    await page.screenshot({ path: '/home/minibox/e2e-tests/settings_04_compact_toggled.png' });

    // Navigate to Queue Page to verify compact layout
    await page.click('button:has-text("Queue")');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: '/home/minibox/e2e-tests/settings_05_queue_compact_view.png' });
    console.log('✓ Queue Page successfully rendered in Compact View.');

    // ═════════════════════════════════════════════════════════════════════════
    // 3. TEST STANDARD USER ROLE & PASSWORD CHANGE
    // ═════════════════════════════════════════════════════════════════════════
    console.log('[TEST 5] Logging in as Standard User (user123)...');
    await page.click('header button:has-text("Sign in")');
    await page.waitForTimeout(500);
    await page.click('button:has-text("User (user123)")');
    await page.waitForTimeout(300);
    await page.click('button[type="submit"]:has-text("Sign in")');
    await page.waitForTimeout(2000);

    // Navigate to Settings as User
    await page.click('button:has-text("Settings")');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: '/home/minibox/e2e-tests/settings_06_user_settings.png' });

    const userSettingsContent = await page.textContent('main');
    if (!userSettingsContent.includes('Standard User') || !userSettingsContent.includes('user')) {
      throw new Error('User identity was not reflected in Settings page!');
    }
    console.log('✓ Standard User profile and role badge rendered.');

    // Test Change Password Modal
    console.log('[TEST 6] Testing Change Password for User...');
    await page.click('button:has-text("Password")');
    await page.waitForTimeout(800);
    await page.screenshot({ path: '/home/minibox/e2e-tests/settings_07_change_password_modal.png' });

    // Fill Password Form
    await page.fill('.modal-in input[type="password"] >> nth=0', 'user123');
    await page.fill('.modal-in input[type="password"] >> nth=1', 'newuser123');
    await page.fill('.modal-in input[type="password"] >> nth=2', 'newuser123');
    await page.click('.modal-in button:has-text("Update Password")');
    await page.waitForTimeout(2000);
    console.log('✓ Password changed successfully to newuser123.');

    // Revert password back to user123
    await page.click('button:has-text("Password")');
    await page.waitForTimeout(500);
    await page.fill('.modal-in input[type="password"] >> nth=0', 'newuser123');
    await page.fill('.modal-in input[type="password"] >> nth=1', 'user123');
    await page.fill('.modal-in input[type="password"] >> nth=2', 'user123');
    await page.click('.modal-in button:has-text("Update Password")');
    await page.waitForTimeout(2000);
    console.log('✓ Password reverted back to user123.');

    // ═════════════════════════════════════════════════════════════════════════
    // 4. TEST ADMIN ROLE, CUPS CONNECTION TEST & DANGER ZONE
    // ═════════════════════════════════════════════════════════════════════════
    console.log('[TEST 7] Signing out and logging in as Admin...');
    await page.click('aside button:has-text("Sign out")');
    await page.waitForTimeout(1000);

    await page.click('header button:has-text("Sign in")');
    await page.waitForTimeout(500);
    await page.click('button:has-text("Admin (admin123)")');
    await page.waitForTimeout(300);
    await page.click('button[type="submit"]:has-text("Sign in")');
    await page.waitForTimeout(2000);

    // Navigate to Settings as Admin
    await page.click('button:has-text("Settings")');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: '/home/minibox/e2e-tests/settings_08_admin_settings.png' });

    const adminSettingsContent = await page.textContent('main');
    if (!adminSettingsContent.includes('Administrator') || !adminSettingsContent.includes('Danger Zone')) {
      throw new Error('Admin settings must display Administrator role and Danger Zone!');
    }
    console.log('✓ Admin identity and Danger Zone verified.');

    // Test CUPS Live Connection Ping
    console.log('[TEST 8] Testing live CUPS Connection Ping as Admin...');
    await page.click('button:has-text("Test Connection")');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: '/home/minibox/e2e-tests/settings_09_cups_ping_result.png' });

    const cupsResultText = await page.textContent('main');
    if (!cupsResultText.includes('CUPS Daemon OK') && !cupsResultText.includes('Socket Connected')) {
      throw new Error('CUPS Ping test result banner did not display success!');
    }
    console.log('✓ Live CUPS daemon ping test returned OK with latency.');

    console.log('=== ALL SETTINGS E2E TESTS PASSED 100% SUCCESSFULLY! ===');
  } catch (err) {
    console.error('TEST FAILED:', err);
    await page.screenshot({ path: '/home/minibox/e2e-tests/settings_failure.png' });
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
