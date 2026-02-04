// MIDI Parser Functions
function parseMidiAllTracks(u8){
    try{
        const dv=new DataView(u8.buffer,u8.byteOffset,u8.byteLength);
        let p=0;
        function readStr(len){ let s=''; for(let i=0;i<len;i++) s+=String.fromCharCode(dv.getUint8(p++)); return s; }
        function readU32(){ const v=dv.getUint32(p); p+=4; return v; }
        function readU16(){ const v=dv.getUint16(p); p+=2; return v; }
        if(readStr(4)!=='MThd') return [];
        const hdrLen=readU32(); const format=readU16(); const ntr=readU16(); const division=readU16();
        p = 8+6;
        const tracks=[];
        for(let t=0;t<ntr;t++){
            const id=readStr(4); const len=readU32();
            if(id!=='MTrk'){ p+=len; continue; }
            const end=p+len; let curTime=0; let runningStatus=0; const events=[];
            function readVar(){ let v=0; while(true){ const b=dv.getUint8(p++); v=(v<<7)|(b&0x7F); if(!(b&0x80)) break; } return v; }
            while(p<end){
                const dt=readVar(); curTime+=dt;
                let st=dv.getUint8(p++);
                if(st<0x80){ p--; st=runningStatus; } else { runningStatus=st; }
                if((st&0xF0)===0x90 || (st&0xF0)===0x80){
                    const note=dv.getUint8(p++); const vel=dv.getUint8(p++);
                    events.push({t:curTime, type:(st&0xF0), note, vel});
                }
                else if(st===0xFF){ const meta=dv.getUint8(p++); const len=readVar(); p+=len; }
                else { const hi=st&0xF0; const cons = (hi===0xC0||hi===0xD0)? 1: 2; p+=cons; }
            }
            const onMap=new Map(); const notes=[];
            events.forEach(ev=>{
                if(ev.type===0x90 && ev.vel>0){ onMap.set(ev.note, ev.t); }
                else if((ev.type===0x80) || (ev.type===0x90 && ev.vel===0)){
                    const st=onMap.get(ev.note);
                    if(st!=null){ notes.push({midi:ev.note, st, en:ev.t}); onMap.delete(ev.note); }
                }
            });
            tracks.push({ index:t, notes });
        }
        return tracks.filter(tr=> tr.notes && tr.notes.length>0).sort((a,b)=> b.notes.length - a.notes.length);
    }catch(_){ return []; }
}

function convertMidiTrackToNotes(midiNotes, octaveShiftSemitones){
    if(!midiNotes || !Array.isArray(midiNotes)) return [];
    const tickToSec = (tick)=> tick / 480.0 * 0.5;
    const notes = midiNotes.map(n=>{
        const midi = n.midi + octaveShiftSemitones;
        const time = tickToSec(n.st);
        const duration = tickToSec(n.en - n.st);
        return {midi, time, duration};
    }).filter(n=> n.midi>=0 && n.midi<=127).sort((a,b)=> a.time - b.time);
    return notes;
}

function showMidiTrackDialog(parsedTracks, partObj, fileName){
    return new Promise((resolve, reject)=>{
        const dialog = document.getElementById('midiTrackDialog');
        const overlay = document.getElementById('midiTrackDialogOverlay');
        const trackSelect = document.getElementById('midiTrackSelect');
        const octaveShift = document.getElementById('midiOctaveShift');
        const octaveShiftVal = document.getElementById('midiOctaveShiftVal');
        const okBtn = document.getElementById('midiTrackOkBtn');
        const cancelBtn = document.getElementById('midiTrackCancelBtn');
        if(!dialog || !overlay || !trackSelect || !octaveShift || !okBtn || !cancelBtn){
            reject(new Error('Dialog elements not found')); return;
        }
        trackSelect.innerHTML='';
        parsedTracks.forEach((tr, i)=>{
            const opt=document.createElement('option');
            opt.value=String(i);
            opt.textContent=`Track ${i+1} (${tr.notes.length} notes)`;
            trackSelect.appendChild(opt);
        });
        trackSelect.selectedIndex=0;
        octaveShift.value='0';
        if(octaveShiftVal) octaveShiftVal.textContent='0';
        const updateOctaveLabel = ()=>{ if(octaveShiftVal) octaveShiftVal.textContent = octaveShift.value; };
        octaveShift.addEventListener('input', updateOctaveLabel);
        dialog.style.display='block';
        overlay.style.display='block';
        const handleOk = async ()=>{
            try{
                const selectedIdx = parseInt(trackSelect.value, 10);
                const octaveShiftSemitones = parseInt(octaveShift.value, 10);
                const selectedTrack = parsedTracks[selectedIdx];
                if(!selectedTrack){ reject(new Error('Invalid track selection')); return; }
                const notes = convertMidiTrackToNotes(selectedTrack.notes, octaveShiftSemitones);
                partObj.notes = notes;
                partObj.duration = notes.length>0 ? Math.max(...notes.map(n=>n.time+n.duration)) : 0;
                partObj.buffer = null;
                autoCenterFrozen = false;
                autoCenterMelodyTrack();
                try{ if(isAssistActive()) stopLatencyAssist(); }catch(_){ }
                try{ if(isCalibrating){ _calibAbort=true; isCalibrating=false; } }catch(_){ }
                midiGhostNotes = null; calibCountdownText=null; calibAnchorActive=false;
                currentTracks=[{name:`Melody P${currentMelodyPart+1}`, notes:(partObj.notes||[])}];
                melodyTrackIndex=0;
                melodyNotesExtracted=true;
                try{
                    if(isPitchOnlyMode){
                        isPitchOnlyMode = false;
                        const btn = document.getElementById('pitchOnlyModeBtn');
                        if(btn){ btn.classList.toggle('active', false); btn.title = 'Pitch-only mode'; }
                    }
                }catch(_){ }
                if(isPlaying){ try{ pausePlayback(); }catch(_){ } }
                stopStage = 0; timelineOffsetSec = 0; scheduledUntil = 0; playbackPosition = 0; playbackStartPos = 0;
                try{ if(typeof resizeCanvas==='function') resizeCanvas(); }catch(_){ }
                scheduleAll();
                updateTimelineScrollRange();
                drawChart();
                try{ if(btCalibStatus) btCalibStatus.textContent='未測�?'; }catch(_){ }
                dialog.style.display='none';
                overlay.style.display='none';
                octaveShift.removeEventListener('input', updateOctaveLabel);
                okBtn.removeEventListener('click', handleOk);
                cancelBtn.removeEventListener('click', handleCancel);
                resolve();
            }catch(err){
                console.warn('MIDI track dialog error:', err);
                dialog.style.display='none';
                overlay.style.display='none';
                octaveShift.removeEventListener('input', updateOctaveLabel);
                okBtn.removeEventListener('click', handleOk);
                cancelBtn.removeEventListener('click', handleCancel);
                reject(err);
            }
        };
        const handleCancel = ()=>{
            dialog.style.display='none';
            overlay.style.display='none';
            octaveShift.removeEventListener('input', updateOctaveLabel);
            okBtn.removeEventListener('click', handleOk);
            cancelBtn.removeEventListener('click', handleCancel);
            reject(new Error('User cancelled'));
        };
        okBtn.addEventListener('click', handleOk);
        cancelBtn.addEventListener('click', handleCancel);
    });
}
