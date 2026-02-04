
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

        // 1. Switch to View Tool
        console.log("Switching to View Tool...");
        await page.evaluate(() => window.audioEngine.setTool('view'));

        // 2. Start Drag
        const canvas = await page.$('canvas');
        const box = await canvas.boundingBox();
        const startX = box.x + 400;
        const startY = box.y + 300;

        console.log("Mouse Down at", startX, startY);
        await page.mouse.move(startX, startY);
        await page.mouse.down();

        const vOffsetBefore = await page.evaluate(() => window.audioEngine.state.verticalOffset);
        console.log("vOffset Before:", vOffsetBefore);

        // 3. Drag 100px Down (dy = +100)
        // In CanvasView: verticalOffset = start + dy / 5
        // So expected change is +20.
        console.log("Dragging Down...");
        await page.mouse.move(startX, startY + 100, { steps: 10 });

        const vOffsetAfter = await page.evaluate(() => window.audioEngine.state.verticalOffset);
        console.log("vOffset After:", vOffsetAfter);

        if (Math.abs(vOffsetAfter - vOffsetBefore) < 0.1) {
            console.error("FAIL: Vertical Offset DID NOT CHANGE. Vertical Pan is stuck.");
        } else {
            console.log("PASS: Vertical Offset Changed.");
            console.log("Delta:", vOffsetAfter - vOffsetBefore);
        }

    } catch (e) {
        console.error("Error:", e);
    } finally {
        await browser.close();
    }
})();
