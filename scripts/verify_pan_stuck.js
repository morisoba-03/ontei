
import puppeteer from 'puppeteer';

(async () => {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    page.on('console', msg => console.log('PAGE:', msg.text()));

    try {
        await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
        await page.waitForFunction(() => window.audioEngine);

        // 1. Switch to View Tool (Pan)
        console.log("Switching to View Tool...");
        await page.evaluate(() => window.audioEngine.setTool('view'));

        // 2. Start Drag
        const canvas = await page.$('canvas');
        const box = await canvas.boundingBox();
        const startX = box.x + 400;
        const startY = box.y + 300; // Middle of canvas

        console.log("Mouse Down at", startX, startY);
        await page.mouse.move(startX, startY);
        await page.mouse.down();

        const posBefore = await page.evaluate(() => window.audioEngine.state.playbackPosition);
        console.log("Pos Before:", posBefore);

        // 3. Drag 200px Left
        console.log("Dragging Left...");
        await page.mouse.move(startX - 200, startY, { steps: 10 });

        const posAfter = await page.evaluate(() => window.audioEngine.state.playbackPosition);
        console.log("Pos After:", posAfter);

        if (posAfter === posBefore) {
            console.error("FAIL: Position DID NOT CHANGE. Pan is stuck.");
        } else {
            console.log("PASS: Position Changed.");
            console.log("Delta:", posAfter - posBefore);
        }

    } catch (e) {
        console.error("Error:", e);
    } finally {
        await browser.close();
    }
})();
