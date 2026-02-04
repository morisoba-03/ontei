
import puppeteer from 'puppeteer';

(async () => {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();

    page.on('console', msg => console.log('PAGE LOG:', msg.type(), msg.text()));
    page.on('pageerror', err => console.log('PAGE ERROR:', err.toString()));
    page.on('requestfailed', req => console.log('REQ FAILED:', req.url(), req.failure().errorText));

    try {
        console.log("Navigating to http://localhost:5173...");
        const response = await page.goto('http://localhost:5173', { waitUntil: 'networkidle0', timeout: 5000 });
        console.log("Status:", response.status());

        const content = await page.content();
        console.log("Root Element InnerHTML:", await page.$eval('#root', el => el.innerHTML).catch(() => "ROOT ELEMENT NOT FOUND"));

        // Check for Canvas
        const canvas = await page.$('canvas');
        console.log("Canvas Found:", !!canvas);

    } catch (e) {
        console.error("Script Error:", e);
    } finally {
        await browser.close();
    }
})();
