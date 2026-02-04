
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

        const canvas = await page.$('canvas');
        const box = await canvas.boundingBox();
        const centerX = box.x + box.width / 2;
        const centerY = box.y + box.height / 2;

        await page.mouse.move(centerX, centerY);

        // 1. Verify Vertical Scroll (Wheel)
        console.log("--- Test 1: Vertical Scroll (Wheel) ---");
        const vOffsetBefore = await page.evaluate(() => window.audioEngine.state.verticalOffset);
        console.log("vOffset Before:", vOffsetBefore);

        // Scroll Down (deltaY > 0) -> Should decrease offset (See lower pitches)
        await page.mouse.wheel({ deltaY: 100 });
        // Wait a bit for state update (though it's synchronous in React usually, effect might lag)
        await new Promise(r => setTimeout(r, 100));

        const vOffsetAfter = await page.evaluate(() => window.audioEngine.state.verticalOffset);
        console.log("vOffset After:", vOffsetAfter);

        if (vOffsetAfter >= vOffsetBefore) {
            console.error("FAIL: Vertical Offset did not decrease (or stayed same).");
        } else {
            console.log("PASS: Vertical Scroll works.");
        }

        // 2. Verify Horizontal Scroll (Shift + Wheel)
        console.log("--- Test 2: Horizontal Scroll (Shift + Wheel) ---");
        const posBefore = await page.evaluate(() => window.audioEngine.state.playbackPosition);
        console.log("Pos Before:", posBefore);

        await page.keyboard.down('Shift');
        await page.mouse.wheel({ deltaY: 100 }); // Shift+WheelDown -> Scroll Right -> Increase Time
        await page.keyboard.up('Shift');
        await new Promise(r => setTimeout(r, 100));

        const posAfter = await page.evaluate(() => window.audioEngine.state.playbackPosition);
        console.log("Pos After:", posAfter);

        if (posAfter <= posBefore) {
            console.error("FAIL: Playback Position did not increase.");
        } else {
            console.log("PASS: Horizontal Scroll works.");
        }

        // 3. Verify Zoom Time (Ctrl + Wheel)
        console.log("--- Test 3: Zoom Time (Ctrl + Wheel) ---");
        const zoomBefore = await page.evaluate(() => window.audioEngine.state.pxPerSec);
        console.log("pxPerSec Before:", zoomBefore);

        await page.keyboard.down('Control');
        await page.mouse.wheel({ deltaY: -100 }); // Wheel Up -> Zoom In -> Increase pxPerSec
        await page.keyboard.up('Control');
        await new Promise(r => setTimeout(r, 100));

        const zoomAfter = await page.evaluate(() => window.audioEngine.state.pxPerSec);
        console.log("pxPerSec After:", zoomAfter);

        if (zoomAfter <= zoomBefore) {
            console.error("FAIL: pxPerSec did not increase.");
        } else {
            console.log("PASS: Zoom Time works.");
        }

    } catch (e) {
        console.error("Error:", e);
    } finally {
        await browser.close();
    }
})();
