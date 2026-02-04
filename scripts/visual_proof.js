
import puppeteer from 'puppeteer';
import fs from 'fs';

(async () => {
    // Launch standard Puppeteer (which works in this env)
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 }); // Set decent size

    // Log console to stdout
    page.on('console', msg => console.log('PAGE:', msg.text()));

    try {
        console.log("Navigating to app...");
        await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
        await page.waitForFunction(() => window.audioEngine);

        // 1. Initial Screenshot
        await page.screenshot({ path: 'proof_1_initial.png' });
        console.log("Captured proof_1_initial.png");

        // 2. Perform Drag Interaction (Simulate issue scenario)
        // Issue: "Audio continues... timeline moves but audio doesn't" (Previous)
        // Fix: "Mute on Drag, Jump on Release".

        // We will Drag.
        const canvas = await page.$('canvas');
        const box = await canvas.boundingBox();
        const startX = box.x + 300;
        const startY = box.y + 10;

        console.log("Starting Drag...");
        await page.mouse.move(startX, startY);
        await page.mouse.down();
        await page.mouse.move(startX + 200, startY, { steps: 10 });

        // While dragging, check isSeeking?
        const isSeeking = await page.evaluate(() => window.audioEngine._isSeeking);
        console.log("During Drag - isSeeking:", isSeeking); // Should be TRUE

        // Check Gain?
        // Hard to check AudioNode gain in Puppeteer without complex query.
        // But isSeeking = true implies Muted given code.

        await page.screenshot({ path: 'proof_2_dragging.png' });
        console.log("Captured proof_2_dragging.png");

        await page.mouse.up();
        console.log("Released Drag.");

        // Check After Release
        const isSeekingAfter = await page.evaluate(() => window.audioEngine._isSeeking);
        console.log("After Release - isSeeking:", isSeekingAfter); // Should be FALSE

        const pos = await page.evaluate(() => window.audioEngine.state.playbackPosition);
        console.log("Final Position:", pos);

        await page.screenshot({ path: 'proof_3_released.png' });
        console.log("Captured proof_3_released.png");

    } catch (e) {
        console.error("Error:", e);
    } finally {
        await browser.close();
    }
})();
