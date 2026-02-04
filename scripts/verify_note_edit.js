
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

        // 1. Setup: Create a note directly in state
        console.log("Setting up: Creating a test note at Time 1.0, MIDI 69 (A4)");
        await page.evaluate(() => {
            window.audioEngine.state.currentTracks = [{
                name: 'Test',
                notes: [{ time: 1.0, midi: 69, duration: 1.0 }]
            }];
            window.audioEngine.state.melodyTrackIndex = 0;
            // Ensure offset makes it visible
            window.audioEngine.state.playbackPosition = 0;
            window.audioEngine.state.verticalOffset = 60; // 69 is around middle
            window.audioEngine.draw();
        });

        // 2. Switch to Select Tool
        console.log("Switching to Select Tool...");
        await page.evaluate(() => window.audioEngine.setTool('select'));

        // 3. Click on the note
        // Need to calculate screen position of Time 1.0, MIDI 69
        const coords = await page.evaluate(() => {
            const state = window.audioEngine.state;
            const canvas = document.querySelector('canvas');
            const w = canvas.width;
            const h = canvas.height;

            // Replicate Visualizer Logic to find X, Y
            const playX = Math.round(Math.max(60, Math.min(w - 80, w * 0.33)));
            const eff = state.playbackPosition + state.timelineOffsetSec;
            const x = playX + (1.0 - eff) * state.pxPerSec / state.tempoFactor;

            const total = state.verticalZoom * 12;
            const vmin = 36 + Math.round((132 - 36 - total) * (state.verticalOffset / 100));
            const pxSemi = h / total;
            // dispMidi = midi + offset
            const dispMidi = 69 + (state.guideOctaveOffset * 12);
            const y = h - (dispMidi - vmin + 1) * pxSemi; // Top of note rect?
            // Note height is usually pxSemi?
            // Let's click center of note
            const rect = canvas.getBoundingClientRect();
            return { x: rect.left + x + 10, y: rect.top + y + pxSemi / 2 };
        });

        console.log(`Clicking at X:${coords.x}, Y:${coords.y}`);
        await page.mouse.click(coords.x, coords.y);

        // 4. Check if Selected
        const isSelected = await page.evaluate(() => {
            const sel = window.audioEngine.state.selectedNote;
            return sel && sel.time === 1.0 && sel.midi === 69;
        });

        if (isSelected) {
            console.log("PASS: Note Successfully Selected.");
        } else {
            console.error("FAIL: Note NOT Selected.");
            const stateLog = await page.evaluate(() => ({
                tool: window.audioEngine.state.editTool,
                sel: window.audioEngine.state.selectedNote
            }));
            console.log("State:", stateLog);
        }

    } catch (e) {
        console.error("Error:", e);
    } finally {
        await browser.close();
    }
})();
