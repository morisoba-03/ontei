
import puppeteer from 'puppeteer';

(async () => {
    const browser = await puppeteer.launch({
        headless: true, // Headless is fine for logic check
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    page.on('console', msg => console.log('PAGE:', msg.text()));

    try {
        await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
        await page.waitForFunction(() => window.audioEngine);

        // 1. Get PPM
        const ppm = await page.evaluate(() => window.audioEngine.state.pxPerSec / window.audioEngine.state.tempoFactor);
        console.log("PPM:", ppm); // e.g. 100

        // 2. Click Ruler (Seek to Start)
        console.log("Clicking Ruler...");
        const canvas = await page.$('canvas');
        const box = await canvas.boundingBox();
        const startX = box.x + 300;
        const startY = box.y + 10; // Ruler

        await page.mouse.move(startX, startY);
        await page.mouse.down(); // Start Drag

        const posAtClick = await page.evaluate(() => window.audioEngine.state.playbackPosition);
        console.log("Pos At Click (Anchor):", posAtClick);

        // 3. Drag 200px Right
        const dragDist = 200;
        const steps = 20; // Simulate slow drag to catch acceleration loop
        console.log(`Dragging ${dragDist}px Right in ${steps} steps...`);

        await page.mouse.move(startX + dragDist, startY, { steps: steps });

        const posAfterDrag = await page.evaluate(() => window.audioEngine.state.playbackPosition);
        console.log("Pos After Drag:", posAfterDrag);

        // 4. Expected Delta
        const expectedDelta = dragDist / ppm;
        console.log("Expected Delta:", expectedDelta);
        console.log("Actual Delta:", posAfterDrag - posAtClick);

        // Tolerance: 0.1s
        if (Math.abs((posAfterDrag - posAtClick) - expectedDelta) < 0.1) {
            console.log("PASS: Drag matches linear calculations.");
        } else {
            console.error("FAIL: Drag delta mismatch! (Likely feedback loop or incorrect scale).");
        }

    } catch (e) {
        console.error("Error:", e);
    } finally {
        await browser.close();
    }
})();
