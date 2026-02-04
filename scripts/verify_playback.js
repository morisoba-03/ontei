
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

(async () => {
    console.log("Launching Browser...");
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();

    // Capture Logs
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));

    try {
        console.log("Navigating to App...");
        await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });

        console.log("Waiting for AudioEngine...");
        await page.waitForFunction(() => window.audioEngine);

        console.log("Initializing Fake Audio Data...");
        await page.evaluate(async () => {
            const engine = window.audioEngine;
            await engine.ensureAudio();
            const ctx = engine.audioCtx;

            // Create Dummy Buffer (10s)
            const sr = ctx.sampleRate;
            const buf = ctx.createBuffer(1, sr * 10, sr);
            const data = buf.getChannelData(0);
            for (let i = 0; i < data.length; i++) data[i] = Math.sin(i * 0.01); // Sine wave

            engine.backingBuffer = buf;

            // Create Fake Notes
            // Note 1: 0.0 - 1.0 (C4)
            // Note 2: 2.0 - 4.0 (E4) -> Long note spanning 2.5s seek point!
            // Note 3: 5.0 - 6.0 (G4)
            const notes = [
                { midi: 60, time: 0.0, duration: 1.0 },
                { midi: 64, time: 2.0, duration: 2.0 },
                { midi: 67, time: 5.0, duration: 1.0 }
            ];

            engine.state.currentTracks = [{ name: 'Test Track', notes }];
            engine.state.melodyTrackIndex = 0;
            engine.state.playbackPosition = 0;
            engine.draw();
            console.log("Fake Data Loaded. Notes:", JSON.stringify(notes));
        });

        // Screenshot Initial
        await page.screenshot({ path: 'verify_init.png' });
        console.log("Screenshot saved: verify_init.png");

        // Start Playback
        console.log("Starting Playback...");
        await page.evaluate(() => {
            window.audioEngine.startPlayback();
        });

        await new Promise(r => setTimeout(r, 1000)); // Play 1s

        // Seek to 2.5s (Middle of Note 2)
        console.log("Seeking to 2.5s (Mid-Note)...");
        await page.evaluate(() => {
            window.audioEngine.updateState({ playbackPosition: 2.5 });
        });

        // Check Internal State
        const result = await page.evaluate(() => {
            const e = window.audioEngine;
            return {
                isPlaying: e.state.isPlaying,
                pos: e.state.playbackPosition,
                nextIndex: e.nextGuideNoteIndex,
                // Check if buffer source is running (hard to check directly but we assume syncBackingTrack ran)
            };
        });

        console.log("Post-Seek State:", result);
        // Expected: nextIndex Should be the Index of the NEXT note (Note 3, index 2).
        // Note 2 (index 1) started at 2.0, ends at 4.0.
        // We are at 2.5.
        // The algorithm: while notes[idx].end < time idx++
        // Note 0 end 1.0 < 2.5 -> skip.
        // Note 1 end 4.0 > 2.5 -> stop. idx = 1.
        // Then `scheduleGuideNotes` runs starting from idx=1.
        // Note 1 start 2.0 < 2.5. -> It is overlapping.
        // It SHOULD schedule it immediately.
        // And increment index.

        // So nextGuideNoteIndex should eventually be 2 (after scheduling Note 1).

        await new Promise(r => setTimeout(r, 500)); // Let it run a bit

        const finalIndex = await page.evaluate(() => window.audioEngine.nextGuideNoteIndex);
        console.log("Final Index:", finalIndex);

        if (finalIndex === 2) {
            console.log("SUCCESS: Note 1 (overlapping) was processed (index advanced).");
        } else {
            console.log("FAILURE: Index stuck at " + finalIndex);
        }

        await page.screenshot({ path: 'verify_seek.png' });
        console.log("Screenshot saved: verify_seek.png");

    } catch (e) {
        console.error("Verification Error:", e);
    } finally {
        await browser.close();
    }
})();
