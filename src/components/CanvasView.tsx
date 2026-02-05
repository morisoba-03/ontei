import { useEffect, useRef, useState } from 'react';
import { audioEngine } from '../lib/AudioEngine';
import type { Note, Track } from '../lib/types';

type InteractionMode = 'idle' | 'pan' | 'move_note' | 'resize_note' | 'resize_note_left' | 'resize_note_right' | 'creating_note' | 'set_loop';

// Helper to match Visualizer layout
function getPlayX(width: number): number {
    const w = Math.max(0, width | 0);
    return Math.round(Math.max(60, Math.min(w - 80, w * 0.33)));
}

export function CanvasView() {
    // ... (refs)
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [cursor, setCursor] = useState('default');

    // Interaction State
    const modeRef = useRef<InteractionMode | 'scrub'>('idle'); // Added 'scrub'
    const startPosRef = useRef({ x: 0, y: 0 });
    const startStateRef = useRef({
        vOffset: 0,
        tOffset: 0,
        noteTime: 0,
        noteMidi: 0,
        noteDur: 0,
        noteStartTime: 0,
        noteStartMidi: 0,
        clickTimeOffset: 0,
        clickMidiOffset: 0,
        playbackPosition: 0
    });
    const targetNoteRef = useRef<Note | null>(null);
    const dragStartSnapshotRef = useRef<Track[] | null>(null);

    useEffect(() => {
        if (canvasRef.current && containerRef.current) {
            const updateSize = () => {
                if (containerRef.current && canvasRef.current) {
                    const w = containerRef.current.clientWidth;
                    const h = containerRef.current.clientHeight;
                    if (Math.abs(canvasRef.current.width - w) > 1 || Math.abs(canvasRef.current.height - h) > 1) {
                        canvasRef.current.width = w;
                        canvasRef.current.height = h;
                        audioEngine.draw();
                    }
                }
            };
            updateSize();
            window.addEventListener('resize', updateSize);
            audioEngine.setCanvas(canvasRef.current);
            return () => window.removeEventListener('resize', updateSize);
        }
    }, []);

    // Touch gestures: Pinch-to-zoom and two-finger swipe
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        let lastTouchDistance = 0;
        let lastTouchCenterX = 0;
        let isTwoFingerGesture = false;
        let anchorTime = 0; // Time at pinch center (fixed point during zoom)

        const getTouchDistance = (touches: TouchList) => {
            if (touches.length < 2) return 0;
            const dx = touches[0].clientX - touches[1].clientX;
            const dy = touches[0].clientY - touches[1].clientY;
            return Math.sqrt(dx * dx + dy * dy);
        };

        const getTouchCenterX = (touches: TouchList) => {
            if (touches.length < 2) return touches[0]?.clientX || 0;
            return (touches[0].clientX + touches[1].clientX) / 2;
        };

        const handleTouchStart = (e: TouchEvent) => {
            if (e.touches.length === 2) {
                e.preventDefault();
                isTwoFingerGesture = true;
                lastTouchDistance = getTouchDistance(e.touches);
                lastTouchCenterX = getTouchCenterX(e.touches);

                // Calculate the time at the pinch center point
                const rect = canvas.getBoundingClientRect();
                const centerXOnCanvas = lastTouchCenterX - rect.left;
                const playX = getPlayX(canvas.width);
                const ppm = audioEngine.state.pxPerSec;
                const eff = audioEngine.state.playbackPosition + audioEngine.state.timelineOffsetSec;
                anchorTime = eff + (centerXOnCanvas - playX) / ppm;

                audioEngine.startSeek();
            }
        };

        const handleTouchMove = (e: TouchEvent) => {
            if (!isTwoFingerGesture || e.touches.length < 2) return;
            e.preventDefault();

            const rect = canvas.getBoundingClientRect();
            const currentDistance = getTouchDistance(e.touches);
            const currentCenterX = getTouchCenterX(e.touches);
            const centerXOnCanvas = currentCenterX - rect.left;
            const playX = getPlayX(canvas.width);

            // Pinch zoom (centered on pinch point)
            if (lastTouchDistance > 0) {
                const scale = currentDistance / lastTouchDistance;
                if (Math.abs(scale - 1) > 0.01) {
                    const oldPxPerSec = audioEngine.state.pxPerSec;
                    const newPxPerSec = Math.max(20, Math.min(800, oldPxPerSec * scale));
                    const newPpm = newPxPerSec;

                    // Calculate new playback position to keep anchorTime at the same screen position
                    // anchorTime should appear at centerXOnCanvas
                    // newPlaybackPos = anchorTime - timelineOffset - (centerXOnCanvas - playX) / newPpm
                    const newPos = Math.max(0, anchorTime - audioEngine.state.timelineOffsetSec - (centerXOnCanvas - playX) / newPpm);

                    audioEngine.updateState({
                        pxPerSec: newPxPerSec,
                        playbackPosition: newPos
                    });
                }
            }

            // Two-finger horizontal swipe (pan/seek)
            const deltaX = currentCenterX - lastTouchCenterX;
            if (Math.abs(deltaX) > 2) {
                const ppm = audioEngine.state.pxPerSec;
                const dt = -deltaX / ppm;
                const newPos = Math.max(0, audioEngine.state.playbackPosition + dt);
                audioEngine.updateState({ playbackPosition: newPos });

                // Update anchor time for the new center position
                const eff = newPos + audioEngine.state.timelineOffsetSec;
                anchorTime = eff + (centerXOnCanvas - playX) / ppm;
            }

            lastTouchDistance = currentDistance;
            lastTouchCenterX = currentCenterX;
        };

        const handleTouchEnd = (e: TouchEvent) => {
            if (isTwoFingerGesture && e.touches.length < 2) {
                isTwoFingerGesture = false;
                audioEngine.endSeek();
            }
        };

        canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
        canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
        canvas.addEventListener('touchend', handleTouchEnd);
        canvas.addEventListener('touchcancel', handleTouchEnd);

        return () => {
            canvas.removeEventListener('touchstart', handleTouchStart);
            canvas.removeEventListener('touchmove', handleTouchMove);
            canvas.removeEventListener('touchend', handleTouchEnd);
            canvas.removeEventListener('touchcancel', handleTouchEnd);
        };
    }, []);

    const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
        // Initialize Audio Context
        if (!audioEngine.audioCtx) {
            audioEngine.ensureAudio();
        }

        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        canvas.setPointerCapture(e.pointerId);
        startPosRef.current = { x, y };

        const { editTool, timelineOffsetSec, verticalOffset, selectedNote, playbackPosition, pxPerSec, guideOctaveOffset } = audioEngine.state;
        const offset = guideOctaveOffset * 12;

        // --- RULER SEEK (Top 30px) ---
        if (y < 30) {
            const playX = getPlayX(canvas.width);
            const ppm = pxPerSec;
            const targetTime = (playbackPosition + timelineOffsetSec) + (x - playX) / ppm;
            const newPos = Math.max(0, targetTime - timelineOffsetSec);

            // Alt+drag = Set loop range
            if (e.altKey) {
                modeRef.current = 'set_loop';
                audioEngine.updateState({
                    loopEnabled: true,
                    loopStart: newPos,
                    loopEnd: newPos // Will be updated on move
                });
                startStateRef.current.playbackPosition = newPos; // Store loop start
                setCursor('col-resize');
                return;
            }

            modeRef.current = 'scrub';
            audioEngine.updateState({ playbackPosition: newPos });
            startStateRef.current.playbackPosition = newPos;
            audioEngine.startSeek();
            setCursor('ew-resize');
            return;
        }

        // --- Tool: VIEW (Pan only) ---
        // --- Tool: VIEW (Pan behaves as Scrub) ---
        if (editTool === 'view') {
            modeRef.current = 'pan';
            // Save Anchor for Time Drag
            startStateRef.current.playbackPosition = playbackPosition;
            startStateRef.current.vOffset = verticalOffset;

            audioEngine.startSeek(); // Mute during Pan
            setCursor('grabbing');
            return;
        }

        // ... (rest of hit tests)
        const result = audioEngine.visualizer?.getQuantizedTimeMidi(x, y, audioEngine.state);
        // ...

        // (Copy Note Body logic)
        let hitNote: Note | null = null;
        let isResizeRightHit = false;
        let isResizeLeftHit = false;

        if (result) {
            const { exactTime, exactMidi } = result;
            console.log('[Debug] PointerDown', JSON.stringify({ x, y, exactTime, exactMidi, offset }));

            // Check Handles ...
            if (selectedNote) {
                const startT = selectedNote.time;
                const endT = selectedNote.time + selectedNote.duration;
                // Fix: Apply offset to note midi for comparison
                const noteVisualMidi = selectedNote.midi + offset;

                if (Math.abs(exactTime - startT) < 0.2 && Math.abs(exactMidi - noteVisualMidi) < 1.0) {
                    hitNote = selectedNote;
                    isResizeLeftHit = true;
                } else if (Math.abs(exactTime - endT) < 0.2 && Math.abs(exactMidi - noteVisualMidi) < 1.0) {
                    hitNote = selectedNote;
                    isResizeRightHit = true;
                }
            }
            if (!hitNote) {
                const track = audioEngine.state.currentTracks[audioEngine.state.melodyTrackIndex];
                // Fix: Apply offset to check
                hitNote = track?.notes.find(n => {
                    const diffMidi = Math.abs((n.midi + offset) - exactMidi);
                    const match = exactTime >= n.time && exactTime <= n.time + n.duration && diffMidi < 0.8;
                    console.log('[Debug] Check Note', JSON.stringify({ noteTime: n.time, noteMidi: n.midi, visMidi: n.midi + offset, exactTime, exactMidi, diffMidi, match }));
                    return match;
                }) || null;
            }
            // Capture Offsets
            if (hitNote) {
                startStateRef.current.noteStartTime = hitNote.time;
                startStateRef.current.noteStartMidi = hitNote.midi;
                startStateRef.current.noteDur = hitNote.duration;
                startStateRef.current.clickTimeOffset = exactTime - hitNote.time;
                // Fix: Delta should be Visual Click - Visual Note (or Real Click - Real Note).
                // exactMidi is visual. hitNote.midi is real.
                // We want offset in "Visual Domain" or "Real Domain"?
                // If we move visual cursor: newVisual = oldVisual + delta.
                // newReal = newVisual - offset.
                // Let's store visual offset for simplicity?
                // Or simply: visualClickOffset = exactMidi - (hitNote.midi + offset)
                startStateRef.current.clickMidiOffset = exactMidi - (hitNote.midi + offset);
            }
        }

        if (editTool === 'eraser') {
            if (hitNote) {
                audioEngine.removeNote(hitNote);
                if (selectedNote === hitNote) audioEngine.updateState({ selectedNote: null });
            }
            return;
        }

        const isPencilSelect = editTool === 'pencil' && hitNote;
        if (editTool === 'select' || isPencilSelect) {
            if (hitNote) {
                dragStartSnapshotRef.current = JSON.parse(JSON.stringify(audioEngine.state.currentTracks));
                targetNoteRef.current = hitNote;
                if (isResizeLeftHit) {
                    modeRef.current = 'resize_note_left';
                    setCursor('ew-resize');
                } else if (isResizeRightHit) {
                    modeRef.current = 'resize_note_right';
                    setCursor('ew-resize');
                } else {
                    audioEngine.previewNote(hitNote.midi + offset); // Preview visual pitch? or real? visual usually
                    modeRef.current = 'move_note';
                    setCursor('move');
                }
                audioEngine.updateState({ selectedNote: hitNote });
                return;
            }
            if (editTool === 'select') {
                audioEngine.updateState({ selectedNote: null });
            }
        }

        if (editTool === 'pencil' && result && !hitNote) {
            // (Create Note logic)
            // ...
            // Reusing existing logic by block copy if possible or strict replacement?
            // Since I am replacing the whole Function, I must preserve this logic.
            // I'll keep it concise.

            let initialDur = 0.25;
            const track = audioEngine.state.currentTracks[audioEngine.state.melodyTrackIndex];
            if (track) {
                // ... overlaps ...
                const BUFFER = 0.001;
                const samePitchOverlap = track.notes.find(n =>
                    result.time >= n.time && result.time < n.time + n.duration - BUFFER && Math.abs((n.midi + offset) - result.midi) < 0.5
                );
                if (samePitchOverlap) return;

                if (audioEngine.state.isMonophonic) {
                    const anyPitchOverlap = track.notes.find(n =>
                        result.time >= n.time && result.time < n.time + n.duration - BUFFER
                    );
                    if (anyPitchOverlap) return;
                }

                // Clamp
                const checkAnyPitch = audioEngine.state.isMonophonic;
                const nextNote = track.notes.filter(n => {
                    if (n.time <= result.time + BUFFER) return false;
                    if (checkAnyPitch) return true;
                    return Math.abs((n.midi + offset) - result.midi) < 0.5;
                }).sort((a, b) => a.time - b.time)[0];

                if (nextNote) {
                    initialDur = Math.min(0.25, nextNote.time - result.time);
                    if (initialDur <= 0) return;
                }
            }

            const newNote: Note = {
                time: result.time,
                midi: result.midi - offset,
                duration: initialDur
            };
            audioEngine.addNote(newNote);
            audioEngine.updateState({ selectedNote: newNote });
            audioEngine.previewNote(result.midi);

            // Set Start State for Creating Note (Anchor Start, Drag Pitch/Duration)
            startStateRef.current.noteStartTime = result.time;
            startStateRef.current.noteStartMidi = result.midi; // Visual Midi

            modeRef.current = 'creating_note';
            targetNoteRef.current = newNote;
            setCursor('crosshair');
            dragStartSnapshotRef.current = null;
        }
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (modeRef.current === 'idle') return;

        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const dx = x - startPosRef.current.x;
        const dy = y - startPosRef.current.y;

        const { pxPerSec, verticalZoom } = audioEngine.state;

        // SCRUB
        if (modeRef.current === 'scrub') {
            const ppm = pxPerSec;
            // Anchor-based Drag:
            // Calculate Delta Time from Drag Distance (dx)
            // dx is (x - startX).
            // We want to move playbackPosition by dt.
            // If dragging Right (+dx), we want to advance time (or retreat?).
            // Standard Scrub: Drag Right -> Move Forward in Time -> Increase Pos.
            const dt = dx / ppm;

            // Use Saved Anchor Position
            const newPos = Math.max(0, startStateRef.current.playbackPosition + dt);

            audioEngine.updateState({ playbackPosition: newPos });
            return;
        }

        // SET_LOOP (Alt+drag on ruler)
        if (modeRef.current === 'set_loop') {
            const ppm = pxPerSec;
            const playX = getPlayX(canvas.width);
            const eff = audioEngine.state.playbackPosition + audioEngine.state.timelineOffsetSec;
            const currentTime = eff + (x - playX) / ppm;

            const loopStart = startStateRef.current.playbackPosition;
            const loopEnd = Math.max(loopStart + 0.5, currentTime); // Min 0.5s loop

            audioEngine.updateState({ loopEnd });
            return;
        }
        // PAN (Now behaves as Scrub/Move Playhead)
        if (modeRef.current === 'pan') {
            const ppm = pxPerSec;
            const dt = -dx / ppm;
            const newPos = Math.max(0, startStateRef.current.playbackPosition + dt);

            // Paper-like drag: 1px drag = 1px content move
            // verticalOffset is % (0-100) of scrollable range.
            // Scrollable range = Total Range - Visible Range.
            // Assumption: Total Range is ~96 semitones (based on visualizer constants 36 to 132).
            const visibleSemitones = verticalZoom * 12;
            const totalSemitones = 96;
            const scrollableSemitones = Math.max(1, totalSemitones - visibleSemitones);

            // dy pixels -> how many semitones?
            // pixels/semitone = rect.height / visibleSemitones
            const semitonesMoved = dy * (visibleSemitones / rect.height);

            // Convert to % of scrollable range
            const dOffsetPercent = (semitonesMoved / scrollableSemitones) * 100;

            audioEngine.updateState({
                playbackPosition: newPos,
                timelineOffsetSec: 0,
                verticalOffset: startStateRef.current.vOffset + dOffsetPercent
            });
            return;
        }

        const result = audioEngine.visualizer?.getQuantizedTimeMidi(x, y, audioEngine.state);
        if (!result || !targetNoteRef.current) return;
        const n = targetNoteRef.current;

        // MOVE (Relative)
        if (modeRef.current === 'move_note') {
            // ... existing move logic
            const rawTargetTime = result.exactTime - startStateRef.current.clickTimeOffset;
            const rawTargetMidi = result.exactMidi - startStateRef.current.clickMidiOffset;
            const newTimeQuantized = Math.max(0, Math.round(rawTargetTime * 20) / 20);

            // Fix: Calculate Target Visual Pitch -> Convert to Real Stored Pitch
            const offset = audioEngine.state.guideOctaveOffset * 12;
            const visualMidiQuantized = Math.max(0, Math.min(127, Math.round(rawTargetMidi)));
            const newRealMidi = visualMidiQuantized - offset;

            // Collision logic (simplified copy)
            const track = audioEngine.state.currentTracks[audioEngine.state.melodyTrackIndex];
            if (track) {
                const checkAnyPitch = audioEngine.state.isMonophonic;
                const myEnd = newTimeQuantized + n.duration;
                const overlap = track.notes.some(other => {
                    if (other === n) return false;
                    const otherEnd = other.time + other.duration;
                    const timeOverlap = (newTimeQuantized < otherEnd - 0.01 && myEnd > other.time + 0.01);
                    if (!timeOverlap) return false;
                    if (checkAnyPitch) return true;
                    return Math.abs(other.midi - newRealMidi) < 0.5;
                });
                if (overlap) return;
            }

            // if (n.midi !== newRealMidi) audioEngine.previewNote(visualMidiQuantized); // Disabled spam
            n.time = newTimeQuantized;
            n.midi = newRealMidi;
            audioEngine.draw();
        }

        // RESIZE RIGHT
        else if (modeRef.current === 'resize_note_right' || modeRef.current === 'resize_note') {
            let newEnd = Math.max(n.time + 0.05, result.time);
            const track = audioEngine.state.currentTracks[audioEngine.state.melodyTrackIndex];
            if (track) {
                const checkAnyPitch = audioEngine.state.isMonophonic;
                const nextNote = track.notes.filter(other => {
                    if (other === n) return false;
                    if (other.time < n.time) return false;
                    if (checkAnyPitch) return true;
                    return Math.abs(other.midi - n.midi) < 0.5;
                }).sort((a, b) => a.time - b.time)[0];
                if (nextNote) newEnd = Math.min(newEnd, nextNote.time);
            }
            n.duration = Math.max(0.05, Math.round((newEnd - n.time) * 20) / 20);
            audioEngine.draw();
        }

        // RESIZE LEFT
        else if (modeRef.current === 'resize_note_left') {
            const originalEnd = startStateRef.current.noteStartTime + startStateRef.current.noteDur;
            let newStart = result.time;
            newStart = Math.min(originalEnd - 0.05, newStart);
            newStart = Math.max(0, newStart);

            const track = audioEngine.state.currentTracks[audioEngine.state.melodyTrackIndex];
            if (track) {
                const checkAnyPitch = audioEngine.state.isMonophonic;
                const prevNote = track.notes.filter(other => {
                    if (other === n) return false;
                    if (other.time >= originalEnd) return false;
                    if (checkAnyPitch) return true;
                    return Math.abs(other.midi - n.midi) < 0.5;
                }).filter(other => other.time < n.time).sort((a, b) => b.time - a.time)[0];
                if (prevNote) newStart = Math.max(newStart, prevNote.time + prevNote.duration);
            }
            const newDur = Math.max(0.05, Math.round((originalEnd - newStart) * 20) / 20);
            const actualStart = originalEnd - newDur;
            n.time = actualStart;
            n.duration = newDur;
            audioEngine.draw();
        }

        // CREATING NOTE MODE (Anchor Start, Adjust Pitch & Duration)
        else if (modeRef.current === 'creating_note') {
            // 1. Duration (Drag X) - Anchor is startStateRef.current.noteStartTime
            let newEnd = Math.max(startStateRef.current.noteStartTime + 0.05, result.time);

            // Collision & Clamp (Duration)
            const track = audioEngine.state.currentTracks[audioEngine.state.melodyTrackIndex];
            const checkAnyPitch = audioEngine.state.isMonophonic;

            // 2. Pitch (Drag Y)
            const offset = audioEngine.state.guideOctaveOffset * 12;
            const visualMidi = result.midi; // Grid-snapped visual midi
            const newRealMidi = visualMidi - offset;

            if (track) {
                const nextNote = track.notes.filter(other => {
                    if (other === n) return false;
                    if (other.time < n.time) return false;
                    if (checkAnyPitch) return true;
                    return Math.abs(other.midi - newRealMidi) < 0.5;
                }).sort((a, b) => a.time - b.time)[0];

                if (nextNote) {
                    newEnd = Math.min(newEnd, nextNote.time);
                }
            }

            n.duration = Math.max(0.05, Math.round((newEnd - n.time) * 20) / 20);

            // Update Pitch
            if (n.midi !== newRealMidi) {
                n.midi = newRealMidi;
                audioEngine.previewNote(visualMidi);
            }

            audioEngine.draw();
        }

    };

    const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (canvas) {
            canvas.releasePointerCapture(e.pointerId);
        }

        // Preview sound on drop/resize end
        if ((modeRef.current === 'resize_note_right' || modeRef.current === 'resize_note_left') && targetNoteRef.current) {
            audioEngine.previewNote(targetNoteRef.current.midi + (audioEngine.state.guideOctaveOffset * 12));
        }

        // UNDO LOGIC: Check if state changed from drag start
        if (dragStartSnapshotRef.current) {
            const currentStr = JSON.stringify(audioEngine.state.currentTracks);
            const oldStr = JSON.stringify(dragStartSnapshotRef.current);

            if (currentStr !== oldStr) {
                // Push the OLD state to history
                audioEngine.history.push(dragStartSnapshotRef.current);
                if (audioEngine.history.length > 50) audioEngine.history.shift();
                audioEngine.redoStack = [];
            }
        }

        if (modeRef.current === 'scrub' || modeRef.current === 'pan') {
            audioEngine.endSeek();
        }

        dragStartSnapshotRef.current = null;
        modeRef.current = 'idle';
        setCursor('default');
        targetNoteRef.current = null;

        // Ensure sorted order if we moved stuff
        if (audioEngine.state.editTool === 'pencil' || audioEngine.state.editTool === 'select') {
            const track = audioEngine.state.currentTracks[audioEngine.state.melodyTrackIndex];
            if (track) {
                track.notes.sort((a, b) => a.time - b.time);
            }
            audioEngine.notify();
        }
    };

    return (
        <div ref={containerRef} className="w-full h-full relative overflow-hidden bg-[#222]">
            <canvas
                ref={canvasRef}
                className="absolute inset-0 block touch-none w-full h-full"
                style={{ cursor: cursor }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onWheel={(e) => {
                    e.preventDefault();
                    // Prevent browser zoom with Ctrl
                    if (e.ctrlKey) {
                        // e.preventDefault() is already called
                    }

                    const { deltaX, deltaY, ctrlKey, shiftKey, altKey, metaKey } = e;
                    const isZoomTime = ctrlKey || metaKey;
                    const isZoomPitch = altKey;
                    const isScrollTime = shiftKey;

                    // Zoom Time (Horizontal) - Ctrl + Wheel
                    if (isZoomTime) {
                        const zoomFactor = deltaY > 0 ? 0.9 : 1.1;
                        const newPxPerSec = Math.max(10, Math.min(1000, audioEngine.state.pxPerSec * zoomFactor));
                        // TODO: Zoom towards cursor position? 
                        // For now simple zoom
                        audioEngine.updateState({ pxPerSec: newPxPerSec });
                        return;
                    }

                    // Zoom Pitch (Vertical) - Alt + Wheel
                    if (isZoomPitch) {
                        const zoomFactor = deltaY > 0 ? 1.1 : 0.9;
                        const newZoom = Math.max(1, Math.min(10, audioEngine.state.verticalZoom * zoomFactor));
                        audioEngine.updateState({ verticalZoom: newZoom });
                        return;
                    }

                    // Scroll Time (Horizontal) - Shift + Wheel OR horizontal scroll
                    if (isScrollTime || Math.abs(deltaX) > Math.abs(deltaY)) {
                        const panX = (deltaX !== 0 ? deltaX : deltaY);
                        // px / pxPerSec = sec
                        // Adjust sensitivity
                        const dt = panX / audioEngine.state.pxPerSec;
                        const newPos = Math.max(0, audioEngine.state.playbackPosition + dt);
                        audioEngine.updateState({ playbackPosition: newPos });
                        return;
                    }

                    // Scroll Pitch (Vertical) - Wheel
                    // deltaY is pixels usually. 
                    // verticalOffset is percentage 0-100? or coordinate?
                    // In AudioEngine state: verticalOffset: 60 (default)
                    // In Visualizer: vmin = 36 + (132-36-total)*(verticalOffset/100)
                    // So verticalOffset is a 0-100 slider value.
                    // Let's say 100px scroll = 10% offset change?
                    const dOffset = (deltaY / 500) * 10; // Sensitivity 
                    const newOffset = Math.max(0, Math.min(100, audioEngine.state.verticalOffset - dOffset)); // Scroll Down -> View Up -> Offset Down? 
                    // Usually Scroll Down (Positive deltaY) -> Move View Down -> Lower Pitch -> Higher Offset?
                    // Let's test direction:
                    // verticalOffset 100 -> High pitch visible? 
                    // vmin = min + range * (100/100) = max. 
                    // So High Offset = Show High Pitches (View is Higher Up)
                    // Scroll Down (User wants to see lower) -> Decrease Offset.
                    // deltaY > 0 -> Decrease Offset.
                    audioEngine.updateState({ verticalOffset: newOffset });

                }}
            />
        </div>
    );
}
