const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', error => console.log('PAGE ERROR:', error.message));
  page.on('requestfailed', request => console.log('REQUEST FAILED:', request.url(), request.failure().errorText));
  
  console.log('Navigating to http://localhost:3000/login');
  await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle0' });
  
  console.log('Typing credentials');
  await page.type('input[type="text"]', 'admin');
  await page.type('input[type="password"]', 'admin123'); // Assuming admin123 is the password, or just whatever
  
  console.log('Clicking submit');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {}),
    page.click('button[type="submit"]')
  ]);
  
  console.log('Current URL:', page.url());
  
  console.log('Navigating to PM2 page');
  await page.goto('http://localhost:3000/pm2', { waitUntil: 'networkidle0' });
  
  console.log('PM2 Page URL:', page.url());
  
  await browser.close();
})();
