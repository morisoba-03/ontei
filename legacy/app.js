/* =====================================================================
 * app.js  最小安定クリーン版
 * ===================================================================== */
window.onerror=(m,s,l,c,e)=>{ console.error('JSエラー',m,s,l,c,e); /* ダイアログは出さない */ };
// ---- State ----
// 音声ベース運用: currentTracks は [0]=メロディ(単音化), [1]=伴奏(参考描画なし) の想定
let currentMidi=null,currentTracks=[];let melodyTrackIndex=0,accompTrackIndexes=[];
// マルチパート: Part1-4 を保持（各: buffer,duration,notes,元バイト,表示/再生）
let melodyParts = Array.from({length:4},()=>({
    buffer:null, duration:0, notes:[],
    origBytes:null, origName:null, origExt:null,
    showNotes:true, playAudio:true
}));
let currentMelodyPart = 0; // 編集対象パート
let melodySources = [];     // 再生中のメロディBufferSource群
let trackInstrumentAssign = [];
let audioCtx=null,melodyGain=null,accompGain=null,masterGain=null,compressor=null,limiter=null;
let _keepAliveOsc=null,_keepAliveGain=null; // destination直結の微小信号(低周波)
let _keepAliveHiOsc=null,_keepAliveHiGain=null; // destination直結の微小信号(高周波)
let _keepAliveConst=null,_keepAliveConstGain=null; // チェーン内の微小DC
let audioActivated=false; // ユーザー操作でAudioContextを有効化したか
let micStream=null,micSource=null,micAnalyser=null,micData=null,analysisTimer=null;
// 音程モード（音源を鳴らさず、マイクのピッチのみ記録/表示）
let isPitchOnlyMode=false;
// マイク選択: 選択済みの deviceId と一覧キャッシュ
let selectedMicDeviceId = null;
let _micDevicesCache = [];
// ---- Modular YIN tracker integration ----
let USE_YIN_TRACKER = true; // set false to fallback to legacy pipeline
let _yinTracker = null;     // instance of window.__PitchModules.YinPitchTracker
let _pitchSmootherMod = null; // instance of window.__PitchModules.PitchSmoother
let _micVoicedRecently=false; // 直近に有声音を検知
let _micFlatFrames=0;        // 連続フラット(ほぼゼロ)フレーム数
let _micLastReinitAt=0;      // 直近の再初期化時刻(ms)
let _micSilentFrames=0,_micReinitInFlight=false;
let _initMicInFlight=false, _lastPromptAt=0;
let _userExplicitMicInit=false; // ユーザーがボタンで明示的に許可要求したか
let _firstInteractionArmed=false; // 初回操作フックが装着済みか
let _insecureWarned=false; // 不安全コンテキスト警告の再表示抑止
// モバイル向け: 一時的な有声音ホールドと履歴間引き用の状態
let _mobileHoldRemain=0, _mobileHoldFreq=0;
let _mobilePitchPushToggle=false;
let _mobileLowDecim=0; // 低信頼フレームの軽量記録用デシメーションカウンタ（モバイル専用）
let _mobileNoiseDb=-60; // 動的ゲート用のノイズフロア推定 (dB)

async function getMicPermissionState(){
    try{
        if(navigator.permissions && navigator.permissions.query){
            const st = await navigator.permissions.query({name:'microphone'});
            return st.state; // 'granted' | 'denied' | 'prompt'
        }
    }catch(_){ }
    return null; // 不明（Safari等）
}

async function canInitMicWithoutPrompt(){
    const st = await getMicPermissionState();
    if(st==='granted') return true;
    // Permissions API 未対応（null）の場合は、明示ボタン操作済みのみ許可
    if(st===null && _userExplicitMicInit) return true;
    return false;
}
// 初回操作で一度だけ自動的にマイク許可を促す（ユーザー操作必須ブラウザ向けフォールバック）
function armFirstInteractionMicPrompt(){
    try{
        if(_firstInteractionArmed) return; _firstInteractionArmed=true;
        const handler = async()=>{
            try{ await initMic(true).catch(()=>{}); }finally{
                try{ window.removeEventListener('pointerdown', handler, true); }catch(_){ }
                try{ window.removeEventListener('keydown', handler, true); }catch(_){ }
                try{ window.removeEventListener('touchstart', handler, true); }catch(_){ }
            }
        };
        window.addEventListener('pointerdown', handler, {capture:true, once:true, passive:true});
        window.addEventListener('keydown', handler, {capture:true, once:true});
        window.addEventListener('touchstart', handler, {capture:true, once:true, passive:true});
    }catch(_){ }
}

// 明示的なマイク停止（解析とトラックを止め、状態をOFFに）
function stopMic(){
    try{
        if(analysisTimer){ try{ clearInterval(analysisTimer); }catch(_){ } analysisTimer=null; }
        if(micStream){ try{ micStream.getTracks().forEach(t=>{ try{ t.onended=null; t.onmute=null; t.onunmute=null; }catch(_){ } try{ t.stop(); }catch(_){ } }); }catch(_){ } }
        try{ if(micSource) micSource.disconnect(); }catch(_){ }
        try{ if(micHPF) micHPF.disconnect(); }catch(_){ }
        try{ if(micLPF) micLPF.disconnect(); }catch(_){ }
        micStream=null; micSource=null; micAnalyser=null; micHPF=null; micLPF=null; micData=null;
        try{ setMicStatus('OFF'); }catch(_){ }
    }catch(_){ }
}

// 不安全コンテキスト(file:// など)では getUserMedia が使えないため、明示的に警告
function warnIfInsecureContext(){
    try{
        const insecure = (location.protocol==='file:') || (!window.isSecureContext && location.protocol!=='https:');
        if(!insecure || _insecureWarned) return;
        _insecureWarned = true;
        // 表示上の注意文やボタン無効化は行わない（ユーザー要望）。
        // 開発者向けにコンソールへだけ情報を残す。
        try{ console.warn('Insecure context detected (file:// or non-secure). Microphone may not work due to browser policy.'); }catch(_){ }
    }catch(_){ }
}
let micHPF=null, micLPF=null; // マイク前段フィルタ（高域/低域ノイズを除去）
let playbackStartTime=0,playbackStartPos=0,playbackPosition=0,isPlaying=false,tempoFactor=1.0;
let schedTimer=null; // RAFに加えた冗長スケジューラ
let toleranceCents=20,gateThreshold=-40,analysisRate=120,A4Frequency=440,labelNotation='CDE';
// 可視化/記録に用いるピッチ信頼度の下限（0..1）
const PITCH_CONF_MIN = 0.45;
const DRAW_CONF_MIN_MOBILE = 0.42; // モバイル描画用の最低信頼度（履歴の採用よりやや緩く）
// ユーザー要望: モバイルでもPCと同じパイプラインを使えるようにする切替（既定ON）
let USE_PC_PIPELINE_ON_MOBILE = true;
let verticalZoom=2.5,verticalOffset=0,pxPerSec=150,timelineOffsetSec=0,isPanning=false,panStartX=0,panStartOffset=0;
let isAdjustingVOffset=false; // 右側スライダ操作中のガード
let autoCenterFrozen=false; // ノーツ編集以降は自動センタリングを凍結
let pitchHistory=[],markers={A:null,B:null,C:null,D:null,E:null,F:null,G:null},stopStage=0;
let micRenderMode='graph'; // 'line' | 'dot' | 'graph'
// 可視化補正パラメータ（UIで変更可）
let visTimeSnapMs = 180;           // ガイド時間スナップ許容（ms）
let visBridgeGapMs = 150;          // 一般ギャップ連結（ms）
let visBridgeGapInNoteMs = 300;    // 同一ノート内の最大ギャップ連結（ms）
let visChangeTolSemi = 0.65;       // 分割しきい値（半音）
let visEdgePadMs = 160;            // 端吸着の許容（ms）
let guideLineWidth=4; // ガイド線太さ（スライダ反映）
// Live pitch state
let lastMicFreq=0,lastMicMidi=0; const pitchSmoothBuf=[]; const PITCH_SMOOTH_WINDOW=7;
// ライブ用: 短遅延Viterbiで候補系列から最尤のf0を選ぶ（オクターブ跨ぎ安定化）
const LIVE_VIT_LAG = 5;           // フレーム遅延（約0.1〜0.15s）
const LIVE_VIT_MAX = 48;          // バッファ保持上限
let liveVitFrames = [];           // [{cands:number[], costs:number[], time:number}]
// ---- Diagnostics (lightweight, rate-limited) ----
let __diagEnabled = true; // 開発用: 解析/描画の異常検出をコンソールへ出す（本番では false 推奨）
const __diagMarks = Object.create(null);
function __diagLog(kind, data, rateMs=2000){
    if(!__diagEnabled) return;
    try{
        const now = Date.now();
        const last = __diagMarks[kind] || 0;
        if(now - last < rateMs) return;
        __diagMarks[kind] = now;
        // 例: kind='c-only-visual'
        // 出力は控えめに（必要最小限のキーのみ）
        console.warn('[Diag]', kind, data);
    }catch(_){ /* ignore diag logging failures */ }
}
// YINパス専用: f/2, f, 2f の3候補で簡易Viterbi（モバイルのオクターブ安定化）
const YIN_VIT_LAG = 3;            // 遅延をさらに短縮（約25〜45ms相当）
const YIN_VIT_MAX = 64;           // バッファ保持上限
let yinVitFrames = [];
// 視覚化タイミング補正（検出・スムージング遅延を見越して左に寄せる秒数）
const PITCH_TIME_OFFSET_SEC = 0.085; // 基本の前倒し（モバイルの見かけ遅延をわずかに短縮）
function getPitchVisOffsetSec(){
    // 測定された出力遅延の一部を可視化にも反映（行き過ぎないよう上限）
    const extra = btLatencyEnabled? Math.min(0.15, (btLatencySec||0)*0.6) : 0;
    return PITCH_TIME_OFFSET_SEC + extra;
}
// 強制全域探索フラグ（固着判定では設定しない。外部イベントや境界条件で用いる想定）
let _forceGlobalSearch=0;
// 追加状態
let showNoteNames=true;
// 採点表示: 同一音種（C,D,...）をオクターブにまたがって赤点で重ね描きするオーバーレイ
let scorePitchClassOverlay=true; // 要望により既定ON（検出ロジックは変更しない）
// 採点用状態
let scoreSessionId = 0;
let scoreStats = null; // { bins:[{count,sum,sumAbs,inTol,outTol,sharp,flat}], total }
let _pauseAdviceTimer = null; // 停止時のアドバイス遅延表示用
// 音種×オクターブ統計
let scoreDetailByOct = {}; // { [octaveString]: { [pc]: {in:0,out:0,count:0} } }
// キャリブレーション表示用状態
let isCalibrating=false; let _calibRAF=0; let calibPrevPos=0; let calibBasePos=0; let calibMoveStartPerf=0; let calibCountdownText=null; let _calibAbort=false;
// 遅延補正アシスト用フラグ/ループ
let isAssistMode=false; let _assistRAF=0; let _assistAbort=false;

function isAssistActive(){ return !!isAssistMode; }
let calibAnchorActive=false; let calibAnchorTime=0; let calibAnchorMidi=60;

// MIDIアラインの仮ノーツ可視化用
let midiGhostNotes = null; // [{midi,time,duration,role?}] | null
// 練習モード: ユーザが発声すべきターゲット(レスポンス)ノート一覧
// [{midi,time,duration}] を保持し、melody が無い場合の採点参照に使う
let practiceExpectedNotes = null;
let scheduledUntil=0; const SCHEDULE_AHEAD=0.6; // さらに短縮して負荷を軽減
const MAX_DYNAMIC_LOOKAHEAD=30; // 初期ノート探索の最大拡張秒
let tempoSegments=[]; // 精密テンポマップ
// シンセ用状態
let activeVoices=[]; const MAX_POLYPHONY=48; let noiseBuffer=null; function getNoiseBuffer(){ if(noiseBuffer) return noiseBuffer; if(!audioCtx) return null; const len=Math.floor(audioCtx.sampleRate*0.03); const buf=audioCtx.createBuffer(1,len,audioCtx.sampleRate); const d=buf.getChannelData(0); for(let i=0;i<len;i++){ d[i]=(Math.random()*2-1)*Math.pow(1-i/len,2); } noiseBuffer=buf; return noiseBuffer; }
let scheduledCounter=0;
let useSamplePiano=true; // サンプルベースピアノ使用
const PIANO_SAMPLE_MIDIS=[36,40,43,48,52,55,60,64,67,72,76,79];
const pianoSampleBuffers={}; let pianoSamplesLoading=false,pianoSamplesLoaded=false;
// 短時間の同時発音数推定用（アタックの均一スケーリングに利用）
const RECENT_STARTS=[]; const POLY_WINDOW=0.025; // 25ms 窓
async function loadPianoSamples(){
    // file:// で直接開いている場合は fetch が CORS で失敗するためオフ
    if(location.protocol==='file:'){
        // 旧外部サンプルは取得できないが ZIP/ミニパック方式は利用可なので無効化しない。
        console.warn('file:// 環境: 外部 fetch サンプルはスキップ (ZIP / ミニパックは利用可能)');
        return; // ここでは何もしない (ZIPロード待ち)
    }
    if(pianoSamplesLoaded||pianoSamplesLoading||!useSamplePiano) return;
    if(!audioCtx) ensureAudio();
    pianoSamplesLoading=true;
    const root='assets/piano/';
    let errorOnce=false;
    const tasks=PIANO_SAMPLE_MIDIS.map(m=>fetch(root+`m${m}.mp3`).then(r=>{ if(!r.ok) throw 'missing sample '+m; return r.arrayBuffer(); }).then(ab=>new Promise((res,rej)=> audioCtx.decodeAudioData(ab,b=>res({m,b}),e=>rej(e)))).catch(e=>{ if(!errorOnce){ console.warn('sample load error (以降省略) ->',e); errorOnce=true; } return null; }));
    const results=await Promise.all(tasks);
    results.forEach(o=>{ if(o) pianoSampleBuffers[o.m]=o.b; });
    const have=Object.keys(pianoSampleBuffers).length;
    pianoSamplesLoaded=have>0; pianoSamplesLoading=false;
    if(!pianoSamplesLoaded){
        console.warn('ピアノサンプルを1つも取得できませんでした。サンプルピアノ無効化。');
        useSamplePiano=false;
    } else {
        console.log('Piano samples loaded',have,'/'+PIANO_SAMPLE_MIDIS.length);
    }
}
function nearestSampleMidi(m){ let best=PIANO_SAMPLE_MIDIS[0],bd=999; for(const s of PIANO_SAMPLE_MIDIS){ if(!pianoSampleBuffers[s]) continue; const d=Math.abs(s-m); if(d<bd){ bd=d; best=s; } } return best; }
let activeSampleVoices=[]; function cleanupSampleVoices(now){ activeSampleVoices=activeSampleVoices.filter(v=>{ if(v.end<=now){ try{ v.g.disconnect(); }catch(_){ } return false;} return true; }); }
function sampleVoiceStealIfNeeded(){ const limit=Math.max(24, Math.min(64, MAX_POLYPHONY)); if(activeSampleVoices.length<limit) return; activeSampleVoices.sort((a,b)=>a.end-b.end); const v=activeSampleVoices.shift(); try{ if(v && v.g && v.g.gain){ v.g.gain.setTargetAtTime(0, audioCtx.currentTime, 0.02);} }catch(_){ } }
function createSamplePianoVoice(midi,when,dur,outGain){ if(!pianoSamplesLoaded) return false; const base=nearestSampleMidi(midi); const buf=pianoSampleBuffers[base]; if(!buf) return false; cleanupSampleVoices(audioCtx.currentTime); if(activeSampleVoices.length>MAX_POLYPHONY){ activeSampleVoices.sort((a,b)=>a.end-b.end); const v=activeSampleVoices.shift(); try{ v.g.gain.setTargetAtTime(0,audioCtx.currentTime,0.02);}catch(_){ } }
    const src=audioCtx.createBufferSource(); src.buffer=buf; const rate=Math.pow(2,(midi-base)/12); src.playbackRate.setValueAtTime(rate,when);
    const g=audioCtx.createGain(); g.gain.setValueAtTime(0.0001,when); g.gain.exponentialRampToValueAtTime(0.85,when+0.01);
    const raw=buf.duration/rate; const nd=Math.min(dur,10); const playDur=Math.min(raw, nd+0.3); const fadeStart=when+Math.min(nd, raw*0.85); g.gain.setTargetAtTime(0,fadeStart,0.25);
    src.connect(g); g.connect(outGain); src.start(when); src.stop(when+playDur+0.05); activeSampleVoices.push({end:when+playDur+0.4,g}); return true; }
let usePianoSynth=true; // デバッグ用切替: false にすると旧シンプル sine 発音
// 環境ヘルパ
function isIOS(){
    try{
        return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1);
    }catch(_){ return false; }
}
// LRU用の統計と制御
const SAMPLE_USE_STATS={};
let lastLruCheck=0; // performance.now()
const LRU_CHECK_INTERVAL=5000; // ms
const MAX_DECODED_SAMPLES_SOFT=180; // デコード済みサンプルのソフト上限
// ---- DOM ----
const $=id=>document.getElementById(id);
// 旧: MIDI/MusicXML 用のファイル入力は廃止
// const fileInput=$('fileInput'),fileSelectBtn=$('fileSelectBtn'),fileNameLabel=$('fileNameLabel');
const chartCanvas=$('chartCanvas');const ctx=chartCanvas?chartCanvas.getContext('2d'):null;
const playBtn=$('playButton'),pauseBtn=$('pauseButton'),stopBtn=$('stopButton');
const rw5=$('rewind5'),rw10=$('rewind10'),fw5=$('forward5'),fw10=$('forward10');
const tolSlider=$('toleranceSlider'),tolVal=$('toleranceValue');
const gateSlider=$('gateSlider'),gateVal=$('gateValue');
const rateSlider=$('rateSlider'),rateVal=$('rateValue');
const labelSel=$('labelNotationSelect');
// 新規: マイク描画モードセレクト
const micRenderModeSel=document.getElementById('micRenderModeSelect');
const vZoom=$('verticalZoomSlider'),timeScale=$('timeScaleSlider'),timeScaleVal=$('timeScaleValue');
const vOffsetSliderRight=$('verticalOffsetSliderRight');
    if(vOffsetSliderRight){
        // ポインタ操作: スライダー操作中はキャンバスパンを完全ブロック（既定のドラッグは阻害しない）
        vOffsetSliderRight.addEventListener('pointerdown',(e)=>{ isAdjustingVOffset=true; e.stopPropagation(); }, {capture:true});
        vOffsetSliderRight.addEventListener('pointermove',(e)=>{ if(!isAdjustingVOffset) return; e.stopPropagation(); }, {capture:true});
        vOffsetSliderRight.addEventListener('pointerup',(e)=>{ isAdjustingVOffset=false; e.stopPropagation(); }, {capture:true});
        vOffsetSliderRight.addEventListener('pointercancel',(e)=>{ isAdjustingVOffset=false; e.stopPropagation(); }, {capture:true});
        // タッチ操作: スクロール抑止は CSS の touch-action に任せる（既定のスライダ動作は維持）
        vOffsetSliderRight.addEventListener('touchstart',(e)=>{ isAdjustingVOffset=true; e.stopPropagation(); }, {capture:true, passive:false});
        vOffsetSliderRight.addEventListener('touchmove',(e)=>{ if(!isAdjustingVOffset) return; e.stopPropagation(); }, {capture:true, passive:false});
        vOffsetSliderRight.addEventListener('touchend',(e)=>{ isAdjustingVOffset=false; e.stopPropagation(); }, {capture:true});
        vOffsetSliderRight.addEventListener('touchcancel',(e)=>{ isAdjustingVOffset=false; e.stopPropagation(); }, {capture:true});
        // 値変更
        const applyVOffset = ()=>{ verticalOffset=parseInt(vOffsetSliderRight.value); syncVerticalOffsetSliders(); drawChart(); };
        vOffsetSliderRight.addEventListener('input', applyVOffset);
        vOffsetSliderRight.addEventListener('change', applyVOffset);
    }
const editToolbar=document.getElementById('editToolbar');
// セッション保存/読込 UI
const sessionSaveBtn=document.getElementById('sessionSaveBtn');
const sessionLoadBtn=document.getElementById('sessionLoadBtn');
const sessionLoadInput=document.getElementById('sessionLoadInput');
// 追加: トランスポート右側の再生ミュート切替
const melodyPlayToggle=document.getElementById('melodyPlayToggle'); // 互換: HTMLからは削除済み

// ========================
// ビルド時刻トースト表示
// ========================
(function(){
    async function getLastModifiedFrom(url){
        // file:// や未知スキームでは CORS/ポリシーで失敗するため fetch を行わない
        try{
            const proto = (location && location.protocol || '').toLowerCase();
            if(proto !== 'http:' && proto !== 'https:'){
                return null; // サーバ配信時のみ取得にトライ
            }
        }catch(_){ /* location未定義等は無視 */ }
        try{
            // 1) HEAD で Last-Modified を取得（対応サーバ向け）
            const headRes = await fetch(url, { method:'HEAD', cache:'no-store' });
            const lm = headRes.headers.get('last-modified');
            if(lm){ return new Date(lm); }
        }catch(_){/* 次の手段へ */}
        try{
            // 2) GET でヘッダを確認（no-store）。本文は破棄
            const res = await fetch(url, { cache:'no-store' });
            const lm = res.headers.get('last-modified');
            if(lm){ return new Date(lm); }
        }catch(_){/* 次の手段へ */}
        return null;
    }

    function formatYYMMDDHHMM(d){
        if(!d) return '';
        const yy = String(d.getFullYear()).slice(-2);
        const mm = String(d.getMonth()+1).padStart(2,'0');
        const dd = String(d.getDate()).padStart(2,'0');
        const hh = String(d.getHours()).padStart(2,'0');
        const mi = String(d.getMinutes()).padStart(2,'0');
        return `${yy}${mm}${dd}${hh}${mi}`;
    }

    function ensureToastEl(){
        let el = document.getElementById('buildToast');
        if(!el){
            el = document.createElement('div');
            el.id = 'buildToast';
            el.setAttribute('aria-live','polite');
            el.style.position='fixed'; el.style.top='8px'; el.style.right='8px';
            el.style.background='rgba(0,0,0,0.75)'; el.style.color='#e6eaf2';
            el.style.border='1px solid #2b3244'; el.style.padding='6px 10px';
            el.style.borderRadius='8px'; el.style.fontFamily="ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";
            el.style.fontSize='12px'; el.style.zIndex='3000'; el.style.display='none';
            el.style.pointerEvents='none';
            document.body.appendChild(el);
        }
        return el;
    }

    function showToast(text, durationMs=2000){
        const el = ensureToastEl();
        el.textContent = text;
        el.style.display = 'block';
        el.style.opacity = '1';
        el.style.transition = 'opacity 0.35s ease';
        // 少し上に寄せる（重なり回避）
        el.style.top = '8px'; el.style.right = '8px';
        window.setTimeout(()=>{
            try{
                el.style.opacity = '0';
                const onEnd = ()=>{ el.style.display='none'; el.removeEventListener('transitionend', onEnd); };
                el.addEventListener('transitionend', onEnd);
            }catch(_){ el.style.display='none'; }
        }, Math.max(800, durationMs|0));
    }

    async function showBuildStamp(){
        try{
            // app.js の更新時刻を優先採用。同一ファイルのため最も確実。
            let dt = await getLastModifiedFrom('app.js');
            if(!dt){
                // 次点: styles.css
                dt = await getLastModifiedFrom('styles.css');
            }
            if(!dt){
                // 最後のフォールバック: document.lastModified（文字列, ローカルタイム準拠）
                try{ dt = new Date(document.lastModified); }catch(_){ dt = new Date(); }
            }
            const stamp = formatYYMMDDHHMM(dt);
            if(stamp){ showToast(stamp, 2000); }
        }catch(e){
            // 失敗してもアプリ機能に影響させない
            try{ console.warn('build stamp toast failed:', e); }catch(_){ }
        }
    }

    if(document.readyState==='loading'){
        document.addEventListener('DOMContentLoaded', showBuildStamp, { once:true });
    }else{
        // 既に構築済みなら即時
        showBuildStamp();
    }
})();

// ========================
// ツールチップ: .help-text をラベル横の i アイコンに移行
// ========================
(function(){
    function createTipBubble(){
        let tip = document.getElementById('globalTooltipBubble');
        if(!tip){
            tip = document.createElement('div');
            tip.id = 'globalTooltipBubble';
            tip.className = 'tooltip-bubble';
            tip.style.display = 'none';
            document.body.appendChild(tip);
        }
        return tip;
    }
    function showTip(targetEl, text){
        const tip = createTipBubble();
        tip.textContent = text || '';
        if(!text){ tip.style.display='none'; return; }
        const rect = targetEl.getBoundingClientRect();
        const top = rect.top + window.scrollY - 8; // ちょい上
        const left = rect.left + window.scrollX + rect.width + 8; // 右横
        tip.style.top = top + 'px';
        tip.style.left = left + 'px';
        tip.style.display = 'block';
        // 強制reflow後にアニメ
        void tip.offsetHeight; tip.classList.add('show');
        // 自動タイムアウト（モバイルでのタップ表示向け）
        clearTimeout(showTip._to);
        showTip._to = setTimeout(()=>{ hideTip(); }, 3000);
    }
    function hideTip(){
        const tip = document.getElementById('globalTooltipBubble');
        if(!tip) return;
        tip.classList.remove('show');
        // アニメ後に非表示
        setTimeout(()=>{ if(tip && !tip.classList.contains('show')) tip.style.display='none'; }, 150);
    }
    function attachInfoIcon(labelEl, helpText){
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'info-tip';
        btn.textContent = 'i';
        btn.setAttribute('aria-label','説明');
        btn.addEventListener('mouseenter', ()=> showTip(btn, helpText));
        btn.addEventListener('focus', ()=> showTip(btn, helpText));
        btn.addEventListener('mouseleave', hideTip);
        btn.addEventListener('blur', hideTip);
        btn.addEventListener('click', (e)=>{ e.stopPropagation(); showTip(btn, helpText); }); // モバイル: タップで3秒表示
        labelEl.appendChild(btn);
    }
    function initTooltips(){
        try{
            const groups = document.querySelectorAll('#controls .control-group');
            groups.forEach(g=>{
                const help = g.querySelector('.help-text');
                if(!help) return;
                const text = help.textContent.trim();
                if(!text) return;
                // ラベル（または最初の見出し要素）を探す
                let labelEl = g.querySelector('label');
                if(!labelEl){
                    // ラベルが無い場合は先頭にダミーラベルを作成
                    labelEl = document.createElement('label');
                    labelEl.textContent = '設定';
                    g.insertBefore(labelEl, g.firstChild);
                }
                attachInfoIcon(labelEl, text);
            });
            // 画面外押しでツールチップ閉じる（モバイル想定）
            document.addEventListener('touchstart', (e)=>{
                const tip = document.getElementById('globalTooltipBubble');
                if(!tip) return;
                if(e.target.closest('.info-tip')) return;
                hideTip();
            }, {passive:true});
            window.addEventListener('scroll', hideTip, {passive:true});
            window.addEventListener('resize', hideTip);
        }catch(e){ console.warn('initTooltips failed', e); }
    }
    if(document.readyState==='loading'){
        document.addEventListener('DOMContentLoaded', initTooltips, {once:true});
    }else{
        initTooltips();
    }
})();
const accompPlayToggle=document.getElementById('accompPlayToggle'); // 互換: HTMLからは削除済み
// Bluetoothレイテンシ補正（UI連動）
let btLatencyEnabled=false; // 既定OFF
let btLatencySec=0.08;      // 推定で上書き
const engineSelect=null; // 音源選択UIは削除
// BT補正UI（index.html常設）
const btLatencyToggle=$('btLatencyToggle');
const btLatencySlider=$('btLatencySlider');
const btLatencyValue=$('btLatencyValue');
const btLatencyCalibBtn=$('btLatencyCalibBtn');
const btCalibStatus=$('btCalibStatus');
const guideVol=$('guideVolumeSlider'),accompVol=$('accompVolumeSlider');
const guideLineWidthSlider=$('guideLineWidthSlider');
// タイムライン水平スクロール
const timelineScroll = document.getElementById('timelineScroll');
// --- タイムライン高さ 70% 強制 (他UI高さが増えても確保) ---
function enforceTimelineHeight(){
    try{
        const cc=document.getElementById('chartContainer');
        if(!cc) return;
        const vh = window.innerHeight || document.documentElement.clientHeight || 0;
        if(!vh) return;
        const target=Math.round(vh*0.70);
        // ズレが大きい場合のみ再設定
        const curH = cc.getBoundingClientRect().height||0;
        if(Math.abs(curH-target)>4){
            cc.style.height=cc.style.maxHeight=cc.style.minHeight=target+'px';
        }
    }catch(_){ }
}
window.addEventListener('resize', ()=>enforceTimelineHeight());
window.addEventListener('orientationchange', ()=>setTimeout(enforceTimelineHeight,180));
setTimeout(enforceTimelineHeight,120);
const guideToggle=$('guideToggle'),accompToggle=$('accompToggle');
const pedalToggle=null; // ペダルUIは削除
// 楽譜の複数トラックUIは無効化
const trackToggle=null,trackPanel=null;
const melodySel=null,accompSel=null,trackApply=null;
const trackInstrumentGrid=null;
const micBtn=$('micPermissionBtn');
const micDisconnectBtn=$('micDisconnectBtn');
const pitchOnlyModeBtn=$('pitchOnlyModeBtn');
const markerCfg={A:['markerA_set','markerA_play'],B:['markerB_set','markerB_play'],C:['markerC_set','markerC_play'],D:['markerD_set','markerD_play'],E:['markerE_set','markerE_play'],F:['markerF_set','markerF_play'],G:['markerG_set','markerG_play']};
// 追加
const showNoteNamesToggle=$('showNoteNamesToggle');
const micLevelBar=$('micLevelBar'),micDbText=$('micDbText');
const micGateLine=$('micGateLine');
const resonanceMixSlider=$('resonanceMixSlider');
// アドバイスUI
const adviceBtn=$('adviceBtn');
// 基礎練習UI
const practiceModeOn=$('practiceModeOn');
const practiceModeOff=$('practiceModeOff');
const practicePatternSelect=$('practicePatternSelect');
const practicePauseBtn=$('practicePauseBtn');
const practiceStopBtn=$('practiceStopBtn');
const practiceStartBtn=$('practiceStartBtn');
const practiceRangeWrap=$('practiceRangeWrap');
const practiceRootSel=$('practiceRootSel');
const practiceKeyModeSel=$('practiceKeyMode');
const practiceSeventhChk=$('practiceSeventh');
const practiceFromSel=$('practiceFromSel');
const practiceToSel=$('practiceToSel');
const practiceBpmEl=$('practiceBpm');
const practiceVolWrap=$('practiceVolWrap');
const practiceCallVolEl=$('practiceCallVol');
const practiceChordOptsWrap=$('practiceChordOptsWrap');
const practiceSixthChk=$('practiceSixth');
const practiceToolbar=document.getElementById('practiceToolbar');
const practiceCloseBtn=document.getElementById('practiceCloseBtn');
// 元の配置先（トップバー内のグループ）を保持しておく
const practiceTopGroup = practiceModeOn ? practiceModeOn.parentElement : null;
// --- マルチパート UI 初期化 ---
try{
    if(melodyPartSelect){ melodyPartSelect.value=String(currentMelodyPart); melodyPartSelect.addEventListener('change',()=>{
        const v = parseInt(melodyPartSelect.value)||0; currentMelodyPart = Math.max(0, Math.min(3, v));
        const p = melodyParts[currentMelodyPart]||{};
        if(partNotesToggle) partNotesToggle.checked = !!p.showNotes;
        if(partPlaybackToggle) partPlaybackToggle.checked = !!p.playAudio;
        currentTracks = [{name:`Melody P${currentMelodyPart+1}`, notes: (p.notes||[])}]; melodyTrackIndex = 0; melodyNotesExtracted = true;
        autoCenterFrozen=false; autoCenterMelodyTrack(); drawChart();
    }); }
    if(partNotesToggle){ partNotesToggle.checked = !!(melodyParts[currentMelodyPart]?.showNotes); partNotesToggle.addEventListener('change',()=>{ const p=melodyParts[currentMelodyPart]; if(p) p.showNotes=!!partNotesToggle.checked; drawChart(); }); }
    if(partPlaybackToggle){ partPlaybackToggle.checked = !!(melodyParts[currentMelodyPart]?.playAudio); partPlaybackToggle.addEventListener('change',()=>{ const p=melodyParts[currentMelodyPart]; if(p) p.playAudio=!!partPlaybackToggle.checked; }); }
}catch(_){ }
// ---- 基礎練習モード state ----
// パターンによるUI表示切替（ランダムコード時のみキー/7th/6thを表示）
try{
    if(practicePatternSelect){
        practicePatternSelect.addEventListener('change', ()=>{
            const v = practicePatternSelect.value;
            const show = (v==='chordPractice' || v==='chordPracticeRandOrder');
            if(practiceChordOptsWrap){ practiceChordOptsWrap.style.display = show? 'inline-flex': 'none'; }
        });
        // 初期反映
        (function(){ const v=practicePatternSelect.value; const show=(v==='chordPractice' || v==='chordPracticeRandOrder'); if(practiceChordOptsWrap) practiceChordOptsWrap.style.display = show? 'inline-flex':'none'; })();
    }
}catch(_){ }

// マイク許可/停止ボタンの結線
try{
    if(micBtn){
        micBtn.addEventListener('click', async ()=>{
            try{ activateAudioOnce(); }catch(_){ }
            if(IS_MOBILE){
                try{ _micDevicesCache = await enumerateMicInputs(); }catch(_){ }
                openMicPicker();
            } else {
                // PCではそのまま初期化（デバイス選択は不要）
                _userExplicitMicInit=true;
                await initMic(true);
            }
        });
    }
    if(micDisconnectBtn){ micDisconnectBtn.addEventListener('click', ()=>{ try{ stopMic(); }catch(_){ } }); }
    if(pitchOnlyModeBtn){
        pitchOnlyModeBtn.addEventListener('click', async ()=>{
            try{ activateAudioOnce(); }catch(_){ }
            // トグル: ON→OFF→ON ...
            isPitchOnlyMode = !isPitchOnlyMode;
            // UI反映
            try{
                pitchOnlyModeBtn.classList.toggle('active', isPitchOnlyMode);
                pitchOnlyModeBtn.title = isPitchOnlyMode? '音程モード中（クリックで終了）' : '音源を使わず、マイクの音程だけを記録・表示します（再生は無音）';
            }catch(_){ }
            // 編集ツールバーは排他のため隠す
            try{ if(editToolbar){ editToolbar.classList.add('hidden'); editToolbar.style.display='none'; } }catch(_){ }
            // 音程モードON時はゴーストや練習UIは消さない（共存可）
            // 再生状態を合わせる: ONなら自動で再生スタート、OFFなら停止
            if(isPitchOnlyMode){
                // マイクが未初期化ならプロンプトなしで試行（許可済みのときのみ）
                try{ if(!micAnalyser || !micData){ const ok=await canInitMicWithoutPrompt(); if(ok){ await initMic(false).catch(()=>{}); } } }catch(_){ }
                if(!isPlaying){ startPlayback(); }
            } else {
                // 通常モードへ戻す（自動では音声は鳴らさない）
                if(isPlaying){ pausePlayback(); }
                drawChart();
            }
        });
    }
}catch(_){ }
let practiceMode='off'; // 'off' | 'basic'
let isPracticing=false;
// 基礎練習: 赤破線(call)の表示オクターブシフト（見た目のみ、音は変えない）
let practiceCallDisplayOctShift = 0; // 単位: 半音（通常は±12の倍数）
let practiceRAF=0;
let practiceStartPerf=0;
let practiceBaseSongTime=0;
let practiceTempoBpm=80;
let practiceLoopTimer=null;
let practicePaused=false;
let practicePauseAt=0; // song time when paused
let practiceCallGain=null; // dedicated gain for call playback
let practiceScheduledNotes=[]; // {when, stopAt, src?, gain?}
let practicePlan=[]; // [{idx,midi,timeSong,duration,role}]
let practiceEndSongTime=0; // absolute song time of practice end
let practiceBaseAudioTime=0; // AudioContext.currentTime corresponding to practiceBaseSongTime
let practiceCallSchedTimer=null; // interval id for rolling scheduler
const PRACTICE_SCHED_AHEAD=0.6; // seconds ahead to schedule call notes
let practiceScheduledSet=new Set(); // keys of scheduled plan items (idx)
let practiceMutedUntil=0; // audio time until which call gain is held at 0 (for pause masking)

// =============================
// UI: ボタン文字の自動フィット
// - 各ボタンのクライアント幅/高さに収まるようにフォントサイズを縮小
// - リサイズやテキスト変更にも追従
// =============================
(function initAutoFitButtons(){
    try{
    const vw = Math.max(320, Math.min(1200, (window.innerWidth||360)));
    const MIN_PX = vw <= 360 ? 7 : 8; // 超小画面では7pxまで許容
        const MAX_ITER = 9; // 二分探索の繰り返し回数
    const FIT_SELECTOR = 'button:not([data-no-autofit="true"])';
        const buttons = Array.from(document.querySelectorAll(FIT_SELECTOR));

        // 1. 初期スタイルの付与（オーバーフロー抑止）
        for(const btn of buttons){
            // 既存のUIデザインを崩さない範囲で安全に指定
            btn.style.overflow = btn.style.overflow || 'hidden';
            // 高さ固定系のボタンは改行で高さが増えると崩れるため nowrap 優先
            if(!btn.style.whiteSpace) btn.style.whiteSpace = 'nowrap';
            if(!btn.style.textOverflow) btn.style.textOverflow = 'ellipsis';
            if(!btn.style.alignItems) btn.style.alignItems = 'center';
            if(!btn.style.justifyContent) btn.style.justifyContent = 'center';
            if(!btn.style.display){
                // 既存CSSで inline-flex 指定済みの箇所が多いが、未指定時のフォールバック
                btn.style.display = 'inline-flex';
            }
            ensureInnerWrapper(btn);
        }

        function fits(btn, inner){
            // 内側ラッパーの「自然幅(max-content)」とボタン内寸を比較
            const EPS = 0.5;
            const cs = getComputedStyle(btn);
            const padX = parseFloat(cs.paddingLeft||0) + parseFloat(cs.paddingRight||0) + parseFloat(cs.borderLeftWidth||0) + parseFloat(cs.borderRightWidth||0);
            const padY = parseFloat(cs.paddingTop||0) + parseFloat(cs.paddingBottom||0) + parseFloat(cs.borderTopWidth||0) + parseFloat(cs.borderBottomWidth||0);
            const availW = Math.max(1, btn.clientWidth - padX);
            const availH = Math.max(1, btn.clientHeight - padY);
            // max-content で自然幅を得る
            const prevWidth = inner.style.width;
            inner.style.width = 'max-content';
            const needW = inner.scrollWidth;
            const needH = inner.scrollHeight;
            inner.style.width = prevWidth || '';
            return (needW <= availW + EPS) && (needH <= availH + EPS);
        }

        function ensureInnerWrapper(btn){
            // ボタン内容をスケール制御用の内側ラッパーに包む（既存CSSとの互換維持）
            if(btn.__afInner) return btn.__afInner;
            const inner = document.createElement('span');
            inner.className = '__af-inner';
            inner.style.display = 'inline-flex';
            inner.style.alignItems = 'center';
            inner.style.gap = '6px';
            inner.style.whiteSpace = 'nowrap';
            inner.style.lineHeight = 'inherit';
            inner.style.transformOrigin = 'center center';
            inner.style.willChange = 'transform';
            inner.style.width = '100%';
            inner.style.maxWidth = '100%';
            inner.style.overflow = 'visible';
            // 既存の子ノードをすべて移動
            while(btn.firstChild){ inner.appendChild(btn.firstChild); }
            btn.appendChild(inner);
            btn.__afInner = inner;
            return inner;
        }

        function fitOne(btn){
            // 非表示（display:none 等）だと測れないためスキップ
            const cs = getComputedStyle(btn);
            if(cs.display === 'none' || btn.clientWidth === 0 || btn.clientHeight === 0){
                return; // 次回のResizeで再試行
            }
            const inner = ensureInnerWrapper(btn);
            // 元のフォントサイズ（上限）を取得
            const basePx = parseFloat(cs.fontSize) || 12;
            // 端末により初期フォントが過大な場合があるため、現実的な上限をクランプ
            const maxPx = Math.min(basePx, 14);
            let low = MIN_PX, high = Math.max(MIN_PX, Math.min(64, maxPx));

            // 一旦上限へリセット
            btn.style.fontSize = high + 'px';
            inner.style.transform = 'scale(1)'; // スケールもリセット
            // すでに収まる場合は終了（できるだけ大きく）
            if(fits(btn, inner)) return;

            // 二分探索で最大で収まるサイズを探す
            let best = MIN_PX;
            for(let i=0;i<MAX_ITER;i++){
                const mid = Math.floor((low + high) / 2);
                btn.style.fontSize = mid + 'px';
                if(fits(btn, inner)){
                    best = mid;
                    low = mid + 1; // さらに大きくできるか探る
                } else {
                    high = mid - 1; // 小さくする
                }
            }
            btn.style.fontSize = Math.max(MIN_PX, Math.min(best, maxPx)) + 'px';

            // それでも幅/高さが僅かに溢れる場合
            // パディング/ボーダーを考慮して内寸を見積もり
            const padX = parseFloat(cs.paddingLeft||0) + parseFloat(cs.paddingRight||0) + parseFloat(cs.borderLeftWidth||0) + parseFloat(cs.borderRightWidth||0);
            const padY = parseFloat(cs.paddingTop||0) + parseFloat(cs.paddingBottom||0) + parseFloat(cs.borderTopWidth||0) + parseFloat(cs.borderBottomWidth||0);
            // 一旦最大化して実寸を測る
            inner.style.transform = 'scale(1)';
            inner.style.width = 'max-content';
            const availW = Math.max(1, btn.clientWidth - padX);
            const availH = Math.max(1, btn.clientHeight - padY);
            const needW = inner.scrollWidth;
            const needH = inner.scrollHeight;
            const scale = Math.min(1, availW / needW, availH / needH);
            // トップバー内の主要ボタンは可読性優先: scale は使わずフォント縮小の範囲で止める
            const inTopBar = btn.closest('#top-bar') != null;
            if(!inTopBar && scale < 1){
                // 左起点で縮小し、右側のテキストが見切れないように
                inner.style.width = '100%';
                inner.style.transformOrigin = 'left center';
                inner.style.transform = `scale(${Math.max(0.6, scale)})`;
            } else {
                inner.style.width = '100%';
                inner.style.transform = 'scale(1)';
            }
        }

        // 初回フィット
        function fitAll(){
            for(const btn of buttons){
                fitOne(btn);
            }
        }
        fitAll();

        // 2. リサイズで再フィット（デバウンス）
        let resizeTimer = 0;
        window.addEventListener('resize', ()=>{
            if(resizeTimer) cancelAnimationFrame(resizeTimer);
            resizeTimer = requestAnimationFrame(()=>{
                fitAll();
                resizeTimer = 0;
            });
        }, { passive: true });

        // 3. 各ボタンのサイズ変化監視（個別のレイアウト変化にも追従）
        // ResizeObserver: 直接スタイル更新すると再レイアウトを同期誘発し得るため、rAFで遅延実行
        let roPending=false; const roQueue=new Set();
        const ro = new ResizeObserver(entries => {
            for(const entry of entries){
                const btn = entry.target;
                roQueue.add(btn);
            }
            if(!roPending){
                roPending=true;
                requestAnimationFrame(()=>{
                    try{ roQueue.forEach(el=>fitOne(el)); }finally{ roQueue.clear(); roPending=false; }
                });
            }
        });
    for(const btn of buttons){ ro.observe(btn); }

        // 4. ボタン配下のテキストや子DOMの変更を監視して再フィット
        const mo = new MutationObserver(mutations => {
            let need = false;
            for(const m of mutations){
                if(m.type === 'characterData' || m.type === 'childList'){
                    need = true; break;
                }
            }
            if(need){ requestAnimationFrame(fitAll); }
        });
        for(const btn of buttons){
            mo.observe(btn, { subtree: true, characterData: true, childList: true });
        }

        // 5. 遅延で追加されるボタンにも対応（最小限の処理）
        const addMo = new MutationObserver(muts => {
            let added = [];
            for(const m of muts){
                m.addedNodes && m.addedNodes.forEach(node=>{
                    if(node.nodeType !== 1) return; // ELEMENT_NODEのみ
                    if(node.matches && node.matches(FIT_SELECTOR)){
                        added.push(node);
                    }
                    // 子孫も検索
                    const found = node.querySelectorAll ? node.querySelectorAll(FIT_SELECTOR) : [];
                    if(found && found.length){ added.push(...found); }
                });
            }
            if(added.length){
                for(const btn of added){
                    // 初期スタイル
                    btn.style.overflow = btn.style.overflow || 'hidden';
                    if(!btn.style.whiteSpace) btn.style.whiteSpace = 'nowrap';
                    if(!btn.style.alignItems) btn.style.alignItems = 'center';
                    if(!btn.style.justifyContent) btn.style.justifyContent = 'center';
                    if(!btn.style.display) btn.style.display = 'inline-flex';
                    ensureInnerWrapper(btn);
                    ro.observe(btn);
                    mo.observe(btn, { subtree: true, characterData: true, childList: true });
                    fitOne(btn);
                }
            }
        });
        addMo.observe(document.body, { childList: true, subtree: true });
    }catch(e){ console.warn('AutoFitButtons init error', e); }
})();

// =============================
// UI: ボタン以外のラベル/見出しの自動フィット
// - 小画面で summary や label 文言が縦に割れないよう 1 行に収める
// =============================
(function initAutoFitText(){
    try{
        // 対象: トップバー内のラベル文字、トランスポート右側のラベル、設定セクション見出し/ラベル
        const FIT_TEXT_SELECTOR = [
            '#top-bar label .txt',
            '#transportBar .transport-right > div > span',
            '#controls .controls-section > summary',
            '#controls .control-group > label'
        ].join(',');

        const MIN_PX_BASE = 9; // これ以下は可読性低下
        const vw = Math.max(320, Math.min(1200, (window.innerWidth||360)));
        const MIN_PX = vw <= 360 ? 8 : MIN_PX_BASE;
        const MAX_ITER = 9;
        const els = Array.from(document.querySelectorAll(FIT_TEXT_SELECTOR));

        // 初期スタイル（1行固定＆親幅に収める）
        for(const el of els){
            const cs = getComputedStyle(el);
            if(cs.whiteSpace !== 'nowrap') el.style.whiteSpace = 'nowrap';
            if(cs.overflow !== 'hidden') el.style.overflow = 'hidden';
            if(cs.textOverflow !== 'ellipsis') el.style.textOverflow = 'clip';
            // 親幅を測れるようにインライン要素はインラインブロック化
            if(cs.display === 'inline') el.style.display = 'inline-block';
            // 100% までの幅に制限（過剰拡張防止）
            if(!el.style.maxWidth) el.style.maxWidth = '100%';
        }

        function fits(el){
            // 1px 余白で判定のブレを抑制
            const EPS = 0.5;
            return (el.scrollWidth <= el.clientWidth + EPS);
        }

        function fitOne(el){
            const cs = getComputedStyle(el);
            // 非表示や無寸法はスキップ
            if(cs.display === 'none' || el.clientWidth === 0){ return; }
            const basePx = parseFloat(cs.fontSize) || 13;
            let low = MIN_PX, high = Math.max(MIN_PX, Math.min(64, basePx));
            // まず上限に戻す
            el.style.fontSize = high + 'px';
            if(fits(el)) return;
            let best = MIN_PX;
            for(let i=0;i<MAX_ITER;i++){
                const mid = Math.floor((low + high)/2);
                el.style.fontSize = mid + 'px';
                if(fits(el)){ best = mid; low = mid + 1; }
                else { high = mid - 1; }
            }
            el.style.fontSize = Math.max(MIN_PX, Math.min(best, high)) + 'px';
        }

        function fitAll(){ els.forEach(fitOne); }
        fitAll();

        // リサイズで再フィット
        let resizeId=0; window.addEventListener('resize',()=>{
            if(resizeId) cancelAnimationFrame(resizeId);
            resizeId = requestAnimationFrame(()=>{ fitAll(); resizeId=0; });
        }, {passive:true});

        // 親や自身のサイズ変化を監視
        const ro = new ResizeObserver(()=>{ requestAnimationFrame(fitAll); });
        els.forEach(el=>{ ro.observe(el); if(el.parentElement) ro.observe(el.parentElement); });

        // 文字変更にも追従
        const mo = new MutationObserver(()=>{ requestAnimationFrame(fitAll); });
        els.forEach(el=> mo.observe(el, {characterData:true, childList:true, subtree:true}));

        // 後から追加される対象にも適用
        const addMo = new MutationObserver(muts=>{
            let added=[];
            for(const m of muts){
                m.addedNodes && m.addedNodes.forEach(node=>{
                    if(node.nodeType!==1) return;
                    const q = node.matches && node.matches(FIT_TEXT_SELECTOR) ? [node] : [];
                    const found = node.querySelectorAll ? node.querySelectorAll(FIT_TEXT_SELECTOR) : [];
                    if(q.length) added.push(...q);
                    if(found && found.length) added.push(...found);
                });
            }
            if(added.length){
                for(const el of added){
                    const cs = getComputedStyle(el);
                    if(cs.whiteSpace !== 'nowrap') el.style.whiteSpace = 'nowrap';
                    if(cs.overflow !== 'hidden') el.style.overflow = 'hidden';
                    if(cs.textOverflow !== 'ellipsis') el.style.textOverflow = 'clip';
                    if(cs.display === 'inline') el.style.display = 'inline-block';
                    if(!el.style.maxWidth) el.style.maxWidth = '100%';
                    ro.observe(el); if(el.parentElement) ro.observe(el.parentElement);
                    mo.observe(el, {characterData:true, childList:true, subtree:true});
                    fitOne(el);
                }
            }
        });
        addMo.observe(document.body, {childList:true, subtree:true});
    }catch(e){ console.warn('AutoFitText init error', e); }
})();

function parseNoteNameToMidi(s){
    try{
        if(typeof s==='number') return Math.max(0,Math.min(127, s|0));
        const m=String(s||'').trim().match(/^([A-Ga-g])([#bB]?)(-?\d+)$/);
        if(!m) return 60;
        const step=m[1].toUpperCase(); const base={C:0,D:2,E:4,F:5,G:7,A:9,B:11}[step];
        const acc=m[2]==='#'?1: (m[2]==='b'||m[2]==='B'?-1:0);
        const oct=parseInt(m[3]); return Math.max(0,Math.min(127,(oct+1)*12+base+acc));
    }catch(_){ return 60; }
}

function makePracticePattern(pattern, rootMidi, span){
    const notes=[];
    const push=(m)=>notes.push(m);
    if(pattern==='ascMajor'){
        // メジャースケール: 0,2,4,5,7,9,11,12 ... を必要数だけ
        const deg=[0,2,4,5,7,9,11,12];
        for(let i=0;i<span;i++){
            const off = deg[i%deg.length] + 12*Math.floor(i/deg.length);
            push(rootMidi + off);
        }
    } else if(pattern==='descMajor'){
        // メジャースケール下降: 12,11,9,7,5,4,2,0 ... を必要数だけ
        const deg=[12,11,9,7,5,4,2,0];
        for(let i=0;i<span;i++){
            const off = deg[i%deg.length] - 12*Math.floor(i/deg.length);
            push(rootMidi + off);
        }
    } else if(pattern==='chromaticAsc'){
        for(let i=0;i<span;i++){ push(rootMidi + i); }
    } else if(pattern==='chromaticDesc'){
        for(let i=span-1;i>=0;i--){ push(rootMidi + i); }
    } else if(pattern==='majorTriadBroken'){
        const third=4, fifth=7; [0,third,fifth].forEach(d=>push(rootMidi+d));
    } else if(pattern==='majorArpAsc'){
        // 基準オクターブの一つ上で練習（root+12）
        const base=rootMidi+12; const third=4, fifth=7, oct=12; [0,third,fifth,oct].forEach(d=>push(base+d));
    } else if(pattern==='majorArpDesc'){
        // 基準オクターブの一つ上で練習（root+12）
        const base=rootMidi+12; const third=4, fifth=7; [0,fifth,third,0].forEach(d=>push(base+d));
    } else if(pattern==='chordPractice'){
        // コード練習はここでは空配列を返す（実際の生成は startBasicPractice 内で行う）
        // 呼び出し側で特別扱いするためのプレースホルダ
        return [];
    } else {
        for(let i=0;i<8;i++) push(rootMidi+i);
    }
    return notes;
}

function parseFromTo(){
    try{ const a=practiceFromSel?.value||'C5'; const b=practiceToSel?.value||'B5';
        let low = parseNoteNameToMidi(a), high = parseNoteNameToMidi(b);
        if(high<low){ const t=low; low=high; high=t; }
        return [low, high];
    }catch(_){ return [parseNoteNameToMidi('C5'), parseNoteNameToMidi('C6')]; }
}

function startBasicPractice(){
    if(isPracticing) return;
    ensureAudio();
    // 表示用: 赤破線(call)を1オクターブ上に見せる（音はそのまま）
    practiceCallDisplayOctShift = 12;
    // 採点開始: 練習モードでも統計をリセットし、集計を有効化
    try{
        scoreSessionId++;
        scoreStats = { total:0, bins: Array.from({length:12},()=>({count:0,sum:0,sumAbs:0,inTol:0,outTol:0,sharp:0,flat:0})) };
        scoreDetailByOct = {};
    }catch(_){ scoreStats=null; scoreDetailByOct={}; }
    const bpm = Math.max(40, Math.min(200, parseInt(practiceBpmEl?.value||practiceTempoBpm)));
    practiceTempoBpm=bpm; const beatSec = 60 / bpm; const noteDur = beatSec;
    const rootMidi = parseNoteNameToMidi(practiceRootSel?.value||'C5');
    let keyMode = (practiceKeyModeSel?.value||'major'); // 'major' | 'minor' | 'random'
    const use7th = !!(practiceSeventhChk && practiceSeventhChk.checked);
    const use6th = !!(practiceSixthChk && practiceSixthChk.checked);
    const [low, high] = parseFromTo();
    const span = Math.max(3, Math.min(48, (high - low + 1)));
    const pat = (practicePatternSelect?.value)||'ascMajor';
    // 約1分を目安：コール＆レスポンス（アプリ→ユーザー）を繰り返し
    const targetSeconds = 60; const cycleBeats = 8; // 8音=2小節（4拍子想定）
    const cycles = Math.max(1, Math.floor(targetSeconds / (cycleBeats*beatSec*2))); // コール+レスポンスで×2
    const sequences=[]; let startDegree=0; // 段階的に開始音をずらす
    for(let c=0;c<cycles;c++){
        // コール: アプリが演奏
    if(pat==='chordPractice' || pat==='chordPracticeRandOrder' || pat==='chordAllMajor' || pat==='chordAllMinor'){
            // キー（メジャー/マイナー/ランダム）と7th/6th有無に応じたダイアトニック進行（絶対表記）
            const keyRootPC = (rootMidi%12+12)%12;
            const namesCDE=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
            // 度数→和音（PC配列）と表記関数
            function chordForDegree(deg){
                // deg: 0..6
                const scaleMaj=[0,2,4,5,7,9,11];
                const scaleMin=[0,2,3,5,7,8,10];
                const modeEff = (keyMode==='random') ? (Math.random()<0.5? 'major':'minor') : keyMode;
                const scale = modeEff==='minor'? scaleMin: scaleMaj;
                const rootPc = (keyRootPC + scale[deg]) % 12;
                let third = (modeEff==='minor' && (deg===0||deg===3||deg===4))? 3 : // i, iv, v in natural minor
                             (modeEff==='minor' && (deg===2||deg===5))? 4 :
                             (modeEff==='minor' && deg===6)? 3 :
                             // major key
                             (deg===1||deg===2||deg===5)? 3 : 4; // ii, iii, vi minor triads in major
                let fifth = 7;
                let quality = '';
                // diminished in major: vii°; in minor: ii° (natural)
                if((modeEff==='major' && deg===6) || (modeEff==='minor' && deg===1)){
                    fifth = 6; quality = 'dim';
                } else if((modeEff==='major' && (deg===1||deg===2||deg===5)) || (modeEff==='minor' && (deg===0||deg===3||deg===4||deg===6))){
                    quality = 'm';
                } else {
                    quality = '';
                }
                // seventh
                let seventh = null; let extLabel='';
                // 7th / 6th 拡張
                if(use7th){
                    let seventhInt = (quality==='dim')? 10 : // diminished triad + m7 => m7b5 label
                                      (quality==='m')? 10 : // minor triad + m7 => m7
                                      (deg===4 && modeEff==='major')? 10 : // V7 in major
                                      (modeEff==='minor' && deg===4)? 10 : // v7 (natural minor)
                                      11; // maj7 default
                    seventh = seventhInt;
                    if(quality==='dim') extLabel = 'm7b5';
                    else if(quality==='m') extLabel = 'm7';
                    else if(seventhInt===10) extLabel = '7';
                    else extLabel = 'maj7';
                } else if(use6th){
                    // 6th: メジャーは6、マイナーはm6。dimには付与しない
                    if(quality!=='dim'){
                        const sixthInt = 9; // +9 semitones from root
                        seventh = null; // 7th より 6th を優先
                        extLabel = (quality==='m') ? 'm6' : '6';
                        // pcs に later で sixth を入れるため、seventh を使わず6thを push する
                    }
                }
                const pcs = [rootPc, (rootPc+third)%12, (rootPc+fifth)%12];
                if(use6th && extLabel.endsWith('6')){ pcs.push((rootPc+9)%12); }
                else if(seventh!=null) pcs.push((rootPc+seventh)%12);
                // ラベル（絶対表記）
                let label = namesCDE[rootPc] + (extLabel|| (quality==='m'? 'm': (quality==='dim'? '°': '')));
                if(use7th && quality==='dim') label = namesCDE[rootPc] + 'm7b5';
                return { pcs, label };
            }
                                    let degreeSequences=[];
                                    if(pat==='chordAllMajor' || pat==='chordAllMinor'){
                                            // 12キー全対応: 基準キーから半音ずつ上へ移動し、各キーで I–IV–V–I（または i–iv–v–i）を1セット
                                            const allPC=[0,1,2,3,4,5,6,7,8,9,10,11];
                                            const startIndex = keyRootPC; // 基準キーから開始
                                            const order=[]; for(let i=0;i<12;i++){ order.push(allPC[(startIndex+i)%12]); }
                                            for(const pcRoot of order){
                                                    // 一時的にキーのルートを上書きして各キーで進行を組む
                                                    const saveRoot = keyRootPC; // 参照
                                                    const degSeq = [0,3,4,0]; // I/ i, IV/iv, V/v, I/i
                                                    // chordForDegree は keyRootPC を参照しているため、ダミーの関数化でPC差分を適用
                                                    // ここでは degreeSequences に (pcRoot, degSeq) を蓄積し、後段で pcs を作る際に pcRoot を使う
                                                    degreeSequences.push({ pcRoot, degSeq });
                                            }
                                    } else {
                                            // 進行テンプレート（度数）: メジャー/マイナーで拡充
                                            const templates = keyMode==='major'
                                                    ? [
                                                            [0,5,1,4], [0,3,4,0], [2,5,1,4], [0,2,5,1], [5,4,3,2],
                                                            [0,6,5,4], [3,0,4,5], [1,4,0,5], [6,2,5,1], [4,3,2,1]
                                                        ]
                                                    : [
                                                            [0,5,1,4], [0,3,4,0], [2,5,1,4], [0,2,5,1], [5,4,3,2],
                                                            [6,0,5,4], [3,0,4,5], [1,4,0,5], [6,2,5,1], [4,3,2,1]
                                                        ];
                                            degreeSequences.push({ pcRoot: keyRootPC, degSeq: templates[c % templates.length] });
                                    }
            // PC→MIDI 変換（範囲内で参照に近い候補を厳密選択）
            function nearestMidiFromPc(pc, low, high, ref){
                const center = (typeof ref==='number' && isFinite(ref)) ? ref : ((low+high)/2);
                // 範囲内のそのPCを全列挙して最も center に近いものを選ぶ
                const list=[];
                // 開始点: low 以上で指定PCになる最初のMIDI
                let first = low + ((pc - (low%12) + 12) % 12);
                for(let m=first; m<=high; m+=12){ list.push(m); }
                if(!list.length){
                    // 安全策: center 近傍から±数オクターブ探索
                    const base=Math.round(center);
                    for(let k=-8;k<=8;k++){
                        const m=base+12*k; if(m<low-24||m>high+24) continue; if(((m%12)+12)%12===pc) list.push(m);
                    }
                }
                if(!list.length){ return Math.max(low, Math.min(high, Math.round(center))); }
                let best=list[0], bd=1e9; for(const m of list){ const d=Math.abs(m-center); if(d<bd){ bd=d; best=m; } }
                return best;
            }
            // 指定PCの音を「前音以上」で最も近い位置にとる（上行アルペジオ用）
            function midiAtOrAbove(pc, minM, low, high){
                let m = minM + ((pc - (minM%12) + 12) % 12); // minM以上でそのPCとなる最初
                // 範囲に入るまで+12
                while(m<low) m+=12;
                if(m>high) return null;
                return m;
            }
            function chordForDegreeWithPcRoot(deg, pcRootOverride){
                // chordForDegree を pcRootOverride に基づいて再計算
                const scaleMaj=[0,2,4,5,7,9,11];
                const scaleMin=[0,2,3,5,7,8,10];
                const modeEff = (keyMode==='random') ? (Math.random()<0.5? 'major':'minor') : keyMode;
                const scale = modeEff==='minor'? scaleMin: scaleMaj;
                const rootPc = (pcRootOverride + scale[deg]) % 12;
                // 以下は chordForDegree と同様
                let third = (modeEff==='minor' && (deg===0||deg===3||deg===4))? 3 :
                             (modeEff==='minor' && (deg===2||deg===5))? 4 :
                             (modeEff==='minor' && deg===6)? 3 :
                             (deg===1||deg===2||deg===5)? 3 : 4;
                let fifth = 7; let quality='';
                if((modeEff==='major' && deg===6) || (modeEff==='minor' && deg===1)){ fifth=6; quality='dim'; }
                else if((modeEff==='major' && (deg===1||deg===2||deg===5)) || (modeEff==='minor' && (deg===0||deg===3||deg===4||deg===6))){ quality='m'; }
                let seventh=null, extLabel='';
                if(use7th){
                    let seventhInt = (quality==='dim')? 10 : (quality==='m')? 10 : (deg===4? 10: 11);
                    seventh = seventhInt;
                    if(quality==='dim') extLabel='m7b5'; else if(quality==='m') extLabel='m7'; else if(seventhInt===10) extLabel='7'; else extLabel='maj7';
                } else if(use6th){
                    if(quality!=='dim'){
                        extLabel = (quality==='m')? 'm6' : '6';
                    }
                }
                const pcs=[rootPc,(rootPc+third)%12,(rootPc+fifth)%12];
                if(use6th && extLabel.endsWith('6')){ pcs.push((rootPc+9)%12); }
                else if(seventh!=null) pcs.push((rootPc+seventh)%12);
                let label = namesCDE[rootPc] + (extLabel|| (quality==='m'? 'm': (quality==='dim'? '°': '')));
                if(use7th && quality==='dim') label = namesCDE[rootPc] + 'm7b5';
                return { pcs, label };
            }
            // ユーティリティ: 配列シャッフル
            function shuffleInPlace(arr){ for(let i=arr.length-1;i>0;i--){ const j=(Math.random()* (i+1))|0; const t=arr[i]; arr[i]=arr[j]; arr[j]=t; } return arr; }
            for(const entry of degreeSequences){
                const { pcRoot, degSeq } = entry;
                for(const deg of degSeq){
                    const ch = chordForDegreeWithPcRoot(deg, pcRoot);
                // 近接クローズド・ボイシング（範囲中心付近）から開始し、上行に分散（root→3→5→(7)）
                const center = (low+high)/2;
                const rootM = nearestMidiFromPc(ch.pcs[0], low, high, center);
                const mids=[rootM];
                for(let i=1;i<ch.pcs.length;i++){
                    const m = midiAtOrAbove(ch.pcs[i], mids[mids.length-1]+1, low, high);
                    if(m==null){
                        // 収まらない場合は root を1オクターブ下げてリトライ（極狭レンジ対策）
                        const altRoot = nearestMidiFromPc(ch.pcs[0], low, high, rootM-12);
                        mids.length=0; mids.push(altRoot);
                        for(let j=1;j<ch.pcs.length;j++){
                            const mm = midiAtOrAbove(ch.pcs[j], mids[mids.length-1]+1, low, high);
                            if(mm==null) break; mids.push(mm);
                        }
                        break;
                    } else {
                        mids.push(m);
                    }
                }
                // 最低3音（ルート・3度・5度）は保証
                while(mids.length<3){
                    const last = mids[mids.length-1]||rootM; const pc = ch.pcs[Math.min(mids.length, ch.pcs.length-1)];
                    const mm = midiAtOrAbove(pc, last+1, low, high); if(mm==null) break; mids.push(mm);
                }
                let seq = mids.slice(0, use7th? 4: 3); // 7th ONなら4音
                // 新モード: ランダム並び
                if(pat==='chordPracticeRandOrder'){
                    // 先頭音（ルート）を必ず含む前提で、ルートを含めたまま順序をシャッフル
                    // ただし、音域の連続性をなるべく保つため、クローズド・ボイシング内での並べ替えのみ
                    // ここでは単純な全体シャッフルとし、演奏感の変化を狙う
                    seq = shuffleInPlace(seq.slice());
                }
                sequences.push({ type:'call', seq, labelName: ch.label });
                sequences.push({ type:'resp', seq });
                }
            }
        } else if(pat==='scaleUp' || pat==='scaleDown' || pat==='scaleUpDown'){
            // スケール練習（サイトの一般的な運指練習に準拠する基本版）
            // モード: メジャー/ナチュラルマイナー（random時は都度抽選）
            const scaleMaj=[0,2,4,5,7,9,11,12];
            const scaleMinNat=[0,2,3,5,7,8,10,12];
            const modeEff = (keyMode==='random') ? (Math.random()<0.5? 'major':'minor') : keyMode;
            const scale = (modeEff==='minor')? scaleMinNat: scaleMaj;
            // 基準キー（rootMidi）からスケールトーンを範囲いっぱいへ展開
            const tones=[];
            // 低域側へ展開
            for(let k=0;k>=-8;k--){ for(const d of scale){ const m=rootMidi + d + 12*k; if(m<low) continue; if(m>high) continue; tones.push(m); } }
            // 基準オクターブ以上も展開
            for(let k=1;k<=8;k++){ for(const d of scale){ const m=rootMidi + d + 12*k; if(m<low) continue; if(m>high) continue; tones.push(m); } }
            // 重複・順序を整える
            const uniq = Array.from(new Set(tones)).sort((a,b)=>a-b);
            function mkCallSeq(){
                if(!uniq.length) return [rootMidi];
                if(pat==='scaleUp'){ return uniq.slice(); }
                if(pat==='scaleDown'){ return uniq.slice().reverse(); }
                // 往復: 端を重ねない [上行] + [下行(端カット)]
                const up = uniq.slice();
                const dn = uniq.slice(0, -1).reverse();
                return up.concat(dn);
            }
            const callSeq = mkCallSeq();
            sequences.push({type:'call', seq:callSeq});
            sequences.push({type:'resp', seq:callSeq.slice()});
        } else {
            let callSeq = makePracticePattern(pat, rootMidi + startDegree, Math.min(span, cycleBeats));
            // 範囲へ寄せる。ただしメジャースケールの最終ド(root+12)は下へ畳み込まずに残す。
            callSeq = callSeq.map((n, i, arr)=>{
                let v = n;
                const isTopDo = (pat==='ascMajor' && i===arr.length-1 && Math.abs(n - (rootMidi + 12))<=0.001);
                if(!isTopDo){ while(v < low) v += 12; while(v > high) v -= 12; }
                return v;
            });
            sequences.push({type:'call', seq:callSeq});
            const respSeq = callSeq.slice();
            sequences.push({type:'resp', seq:respSeq});
            startDegree = (startDegree+1) % Math.min(span, 12);
        }
    }
    const startSong = (playbackPosition||0) + 1.0;
    const ghost=[]; const now=audioCtx.currentTime; let tCursorSong=startSong; let tCursorAudio=now+0.1;
    practicePlan.length=0; practiceScheduledSet.clear();
    // お手本用の専用ゲイン（全体音量と独立）
    if(!practiceCallGain){ try{ practiceCallGain = audioCtx.createGain(); practiceCallGain.gain.value = Math.max(0, Math.min(1, parseFloat(practiceCallVolEl?.value||'0.85'))); (masterGain||audioCtx.destination)&&practiceCallGain.connect(masterGain||audioCtx.destination); }catch(_){ } }
    let planIdx=0;
    const isScalePat = (pat==='scaleUp' || pat==='scaleDown' || pat==='scaleUpDown');
    for(const block of sequences){
        const isCall = (block.type==='call');
        // コードラベル（コール時のみ）。chordPractice の場合は block.labelName を優先
        const blockLabels = (isCall && block.labels)? block.labels : [];
        for(let i=0;i<block.seq.length;i++){
            const m=block.seq[i];
            // 表示は実際のMIDIを使用（強制的なC5..C6への折畳みを廃止）
            let dispM = m;
            let label = null;
            // コール中はブロック全体で同一ラベルを表示（先頭音だけで切れないように）
            if(isCall && block.labelName){ label = { name: block.labelName }; }
            else if(blockLabels && blockLabels.length){ label = blockLabels.find(lb=> Math.abs((lb.at||0) - tCursorSong) < 1e-6); }
            // スケール練習: お手本は2倍速（半分の長さ）、レスポンスは等速
            const durLocal = isScalePat ? (isCall ? (beatSec*0.5) : beatSec) : noteDur;
            const stepLocal = durLocal; // ノート間隔
            const g = {midi:dispM, time:tCursorSong, duration: durLocal, role: isCall? 'call':'resp'};
            if(label){ g.label = label.name; }
            ghost.push(g);
            practicePlan.push({ idx: planIdx++, midi:m, timeSong:tCursorSong, duration:durLocal, role: isCall? 'call':'resp' });
            tCursorSong += stepLocal; tCursorAudio += stepLocal;
        }
        // 各ブロックのあとに1拍休符
        tCursorSong += beatSec*1.0; tCursorAudio += beatSec*1.0;
    }
    midiGhostNotes = ghost; drawChart();
    // ユーザが歌うべきレスポンス(role==='resp')ノートのみ抽出し採点用に保持
    try{
        practiceExpectedNotes = ghost.filter(g=> g.role==='resp').map(g=>({midi:g.midi,time:g.time,duration:g.duration||beatSec}));
    }catch(_){ practiceExpectedNotes=null; }
    practiceEndSongTime = ghost.length? Math.max(...ghost.map(n=> n.time + n.duration)) : (startSong + 60);
    practiceBaseSongTime = startSong; practiceBaseAudioTime = now + 0.1;
    // 視覚位置も音声マッピングと同じ基準に合わせて同期
    playbackPosition = practiceBaseSongTime;
    // 練習開始時に現在のゴースト（またはFROM/TO）範囲が見えるように自動縦オフセット調整
    try{
        if(Array.isArray(midiGhostNotes) && midiGhostNotes.length){
            let gMin=Infinity, gMax=-Infinity;
            for(const n of midiGhostNotes){
                // 表示時は call のみ視覚シフトを考慮
                const mm = (n.role==='call') ? (n.midi + (practiceCallDisplayOctShift|0)) : n.midi;
                if(mm<gMin) gMin=mm; if(mm>gMax) gMax=mm;
            }
            if(isFinite(gMin) && isFinite(gMax)) setVerticalOffsetToRange(gMin, gMax);
        } else {
            setVerticalOffsetToRange(low + (practiceCallDisplayOctShift|0), high + (practiceCallDisplayOctShift|0));
        }
    }catch(_){ }
    startPracticeScheduler();
    isPracticing=true; practicePaused=false;
    const step=()=>{
        if(!isPracticing) return;
        try{
            const songNow = practiceBaseSongTime + ((audioCtx?.currentTime||0) - practiceBaseAudioTime);
            playbackPosition = songNow;
        }catch(_){ }
        drawChart(); practiceRAF = requestAnimationFrame(step);
    };
    if(practiceRAF) cancelAnimationFrame(practiceRAF); practiceRAF=requestAnimationFrame(step);
    const totalDur = (practiceEndSongTime - startSong) + 0.5; if(practiceLoopTimer) clearTimeout(practiceLoopTimer);
    practiceLoopTimer = setTimeout(()=>{ stopBasicPractice(true); openAdvice(); }, Math.ceil(totalDur*1000));
}

function stopBasicPractice(clearGhost){
    isPracticing=false; if(practiceRAF){ try{ cancelAnimationFrame(practiceRAF); }catch(_){ } practiceRAF=0; }
    if(practiceLoopTimer){ clearTimeout(practiceLoopTimer); practiceLoopTimer=null; }
    if(practiceCallSchedTimer){ try{ clearInterval(practiceCallSchedTimer); }catch(_){ } practiceCallSchedTimer=null; }
    // スケジュール済みノートの停止とクリーンアップ
    try{
        practiceScheduledNotes.forEach(n=>{ try{ if(n.gain){ n.gain.gain.cancelScheduledValues(0); n.gain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.03); } if(n.src){ try{ n.src.stop(); }catch(_){ } } }catch(_){ } });
    }catch(_){ }
    practiceScheduledNotes.length=0;
    practiceScheduledSet && practiceScheduledSet.clear && practiceScheduledSet.clear();
    practicePlan.length=0;
    // 練習モードでは停止時に赤点をクリア
    try{ if(pitchHistory && pitchHistory.length){ pitchHistory.length=0; } }catch(_){ }
    if(clearGhost){ midiGhostNotes=null; drawChart(); }
    practiceExpectedNotes = null;
    try{ seekTo(0); }catch(_){ playbackPosition=0; playbackStartPos=0; drawChart(); }
}

// ---- 基礎練習: コール音スケジューリングと一時停止/再開 ----
// スケジュール: 練習用のコールノートを専用ゲイン経由で再生（停止追従）
function schedulePracticeNote(midi, when, dur){
    try{
        ensureAudio();
        if(!practiceCallGain){
            practiceCallGain = audioCtx.createGain();
            practiceCallGain.gain.value = Math.max(0, Math.min(1, parseFloat(practiceCallVolEl?.value||'0.85')));
            try{ (masterGain||audioCtx.destination) && practiceCallGain.connect(masterGain||audioCtx.destination); }catch(_){ practiceCallGain.connect(audioCtx.destination); }
        }
        let at = when;
        // 出力レイテンシを常に見越して前倒し（BT有効時は測定値、無効時は推定値）
        const outLat = btLatencyEnabled ? (btLatencySec||0) : (estimateOutputLatency()||0);
        if(outLat>0) at = at - outLat;
        const ok = simplePlaySfz(midi, at, dur, practiceCallGain);
        if(!ok){
            // フォールバック: 簡易オシレータ
            const osc = audioCtx.createOscillator();
            const g = audioCtx.createGain();
            const f = 440 * Math.pow(2, (midi-69)/12);
            osc.type='sine'; osc.frequency.setValueAtTime(f, Math.max(audioCtx.currentTime+0.002, at));
            const startAt = Math.max(audioCtx.currentTime+0.002, at);
            const stopAt = startAt + Math.max(0.05, dur||0.2);
            g.gain.setValueAtTime(0.0001, startAt); g.gain.exponentialRampToValueAtTime(0.5, startAt+0.01);
            g.gain.setTargetAtTime(0.0001, stopAt, 0.2);
            osc.connect(g); g.connect(practiceCallGain);
            osc.start(startAt); osc.stop(stopAt+0.05);
        }
        practiceScheduledNotes.push({ when: at, stopAt: at + (dur||0.2) });
    }catch(_){ }
}

function startPracticeScheduler(){
    try{ ensureAudio(); }catch(_){ }
    // clear existing
    if(practiceCallSchedTimer){ try{ clearInterval(practiceCallSchedTimer); }catch(_){ } practiceCallSchedTimer=null; }
    // ensure gain
    try{
        if(!practiceCallGain){
            practiceCallGain = audioCtx.createGain();
            practiceCallGain.gain.value = Math.max(0, Math.min(1, parseFloat(practiceCallVolEl?.value||'0.85')));
            try{ (masterGain||audioCtx.destination) && practiceCallGain.connect(masterGain||audioCtx.destination); }catch(_){ practiceCallGain.connect(audioCtx.destination); }
        }
        // 解除（再開時のミュートを解除）
        if(practiceMutedUntil>0){ practiceCallGain.gain.setTargetAtTime(Math.max(0, Math.min(1, parseFloat(practiceCallVolEl?.value||'0.85'))), Math.max(audioCtx.currentTime, practiceMutedUntil+0.02), 0.02); }
    }catch(_){ }
    practiceCallSchedTimer = setInterval(()=>{
        try{
            if(!audioCtx) return;
            const songNow = practiceBaseSongTime + (audioCtx.currentTime - practiceBaseAudioTime);
            const songEnd = songNow + PRACTICE_SCHED_AHEAD;
            for(const it of practicePlan){
                if(it.role!=='call') continue;
                if(it.timeSong < songNow - 1e-3 || it.timeSong > songEnd + 1e-3) continue;
                const key = it.idx;
                if(practiceScheduledSet.has(key)) continue;
                const whenAudio = audioCtx.currentTime + Math.max(0.001, (it.timeSong - songNow));
                schedulePracticeNote(it.midi, whenAudio, it.duration);
                practiceScheduledSet.add(key);
            }
        }catch(_){ }
    }, 60);
}

function pauseBasicPractice(){
    if(!isPracticing || practicePaused) return; practicePaused=true; practicePauseAt = playbackPosition;
    if(practiceRAF){ try{ cancelAnimationFrame(practiceRAF); }catch(_){ } practiceRAF=0; }
    if(practiceLoopTimer){ clearTimeout(practiceLoopTimer); practiceLoopTimer=null; }
    // 進行中の音は止める
    try{ practiceScheduledNotes.forEach(n=>{ if(n.stopAt > (audioCtx?.currentTime||0)){ try{ /* cannot unschedule, but gate */ if(practiceCallGain){ practiceCallGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.03); practiceMutedUntil = (audioCtx?.currentTime||0) + 0.05; } }catch(_){ } } }); }catch(_){ }
    if(practiceCallSchedTimer){ try{ clearInterval(practiceCallSchedTimer); }catch(_){ } practiceCallSchedTimer=null; }
}

function resumeBasicPractice(){
    if(!practicePaused) return; ensureAudio();
    // マッピングを更新してローリングスケジューラ再開
    practiceBaseSongTime = practicePauseAt;
    practiceBaseAudioTime = audioCtx.currentTime + 0.06;
    // 直後の誤発音を避けるため瞬間ミュートを解除予定
    if(practiceCallGain){ try{ practiceCallGain.gain.setTargetAtTime(Math.max(0, Math.min(1, parseFloat(practiceCallVolEl?.value||'0.85'))), practiceBaseAudioTime+0.02, 0.02); }catch(_){ } }
    // 既存スケジュール済みマークをクリア（以降の範囲のみ再スケジュール）
    practiceScheduledSet && practiceScheduledSet.clear && practiceScheduledSet.clear();
    startPracticeScheduler();
    // アニメ再開（音声時間→曲時間のマッピングで同期）
    isPracticing=true; practicePaused=false;
    const step=()=>{
        if(!isPracticing) return;
        try{
            const songNow = practiceBaseSongTime + ((audioCtx?.currentTime||0) - practiceBaseAudioTime);
            playbackPosition = songNow;
        }catch(_){ }
        drawChart(); practiceRAF = requestAnimationFrame(step);
    };
    if(practiceRAF) cancelAnimationFrame(practiceRAF); practiceRAF=requestAnimationFrame(step);
    // 残り時間で終了タイマー
    const remaining = Math.max(0, practiceEndSongTime - practicePauseAt) + 0.5;
    if(practiceLoopTimer) clearTimeout(practiceLoopTimer);
    practiceLoopTimer = setTimeout(()=>{ stopBasicPractice(true); openAdvice(); }, Math.ceil(remaining*1000));
    // 再開時も見える位置に自動調整（ゴースト範囲優先）
    try{
        if(Array.isArray(midiGhostNotes) && midiGhostNotes.length){
            let gMin=Infinity, gMax=-Infinity; for(const n of midiGhostNotes){ if(n.midi<gMin) gMin=n.midi; if(n.midi>gMax) gMax=n.midi; }
            if(isFinite(gMin) && isFinite(gMax)) setVerticalOffsetToRange(gMin, gMax);
        }
    }catch(_){ }
}
const advicePanel=document.getElementById('advicePanel');
const adviceTextEl=document.getElementById('adviceText');
const adviceCloseBtn=$('adviceClose');
const adviceCanvas=/** @type {HTMLCanvasElement|null} */(document.getElementById('adviceCanvas'));
let _adviceCtx = adviceCanvas? adviceCanvas.getContext('2d') : null;
// 再生線のX位置（キャンバス幅の約1/3）
function getPlayX(width){
    try{
        const w = Math.max(0, width|0);
        // 左端と真ん中の間くらい（~33%）。極端な小画面では最低60pxを確保。
        return Math.round(Math.max(60, Math.min(w - 80, w * 0.33)));
    }catch(_){ return 70; }
}
// 編集UI要素取得
const rangeSelectToggle=document.getElementById('rangeSelectToggle');
const clearSelectionBtn=document.getElementById('clearSelectionBtn');
const octDownBtn=document.getElementById('octDownBtn');
const octUpBtn=document.getElementById('octUpBtn');
const applyForwardToggle=document.getElementById('applyForwardToggle');
const undoBtn=document.getElementById('undoBtn');
const redoBtn=document.getElementById('redoBtn');
// 編集ツールバー内の保存/復元は機能重複のため削除（UIも削除済み）
const midiRefBtn=document.getElementById('midiRefSelectBtn');
// const midiAlignInfo 重複宣言を回避（上で取得済み）
// ノート状態の一時保存/復帰（セーブポイント）
const noteSnapSaveBtn=document.getElementById('noteSnapSaveBtn');
const noteSnapRestoreBtn=document.getElementById('noteSnapRestoreBtn');
let _noteSnapshot=null;
// 厳密オクターブ補正（試験）フラグ（UIトグルで更新）
let strictOctaveMode=false;
const strictOctaveToggle=null; // UI削除
const midiRefInput=document.getElementById('midiRefInput');
const midiTrackSelect=document.getElementById('midiTrackSelect');
const midiApplyBtn=document.getElementById('midiApplyBtn');
const midiGenerateBtn=document.getElementById('midiGenerateBtn');
// 対応調整UI
const midiAlignPanel=document.getElementById('midiAlignPanel');
const midiAlignDetStart=document.getElementById('midiAlignDetStart');
const midiAlignRefStart=document.getElementById('midiAlignRefStart');
const midiAlignScale=document.getElementById('midiAlignScale');
const midiAlignFitEnds=document.getElementById('midiAlignFitEnds');
const midiAlignInfo=document.getElementById('midiAlignInfo');

// 新: メロディ/伴奏の音声入力 UI（index.html に合わせたID）
const melodyAudioBtn=$('melodyAudioSelectBtn');
const melodyAudioInput=$('melodyAudioInput');
const melodyAudioLabel=$('melodyAudioLabel');
const accompAudioBtn=$('accompAudioSelectBtn');
const accompAudioInput=$('accompAudioInput');
const accompAudioLabel=$('accompAudioLabel');

// Stopボタンの意図しない発火（プログラム起因）を防ぐガード
let STOP_TRUSTED_ONLY = true; // 既定: ユーザー操作のみ許可
window.protectStop = function(on=true){ STOP_TRUSTED_ONLY = !!on; console.warn('STOP_TRUSTED_ONLY=', STOP_TRUSTED_ONLY); };
// (ZIPピアノ) 追加UI要素取得（後で index.html にボタン追加想定）
const pianoZipInput=document.getElementById('pianoZipInput');
const pianoZipBtn=document.getElementById('pianoZipLoadBtn');
const pianoZipStatus=document.getElementById('pianoZipStatus');
const sfzDirBtn=document.getElementById('sfzDirLoadBtn');
const sfzDirInput=document.getElementById('sfzDirInput');
const sfzStatus=document.getElementById('sfzStatus');
// 生成ボタンは削除済み
let pianoZipManifest=null; // 読み込んだ manifest
let pianoZipFiles=null;    // { filename: Uint8Array }
let pianoZipDecodeQueue=[]; // デコード優先キュー
let pianoZipDecoding=false;
let pianoZipDecodePaused=false; // 再生中は一時停止
let pianoIRBuffer=null; // インパルス応答
let pianoIRConvolver=null; // ConvolverNode
let resonanceWetGain=null; // IRウェット用
let preOutMergeGain=null; // ドライ/ウェット合流
let resonanceMix=0.15; // 共鳴ミックス(0..0.6)
let pianoSampleMap={};// key: midi -> { layers:{pp:AudioBuffer,...}, release:AudioBuffer|null, gains:{pp:db,...} }
// 複数楽器対応: Piano / Flute 用マップ
const instrumentMaps={ Piano:null, Flute:null };

// グローバル: サステイン・ペダル状態（UIで更新）
let sustainPedal=false; // ペダル機能は固定OFF

// シンプルSFZモード（原因切り分け用の最小経路）
let SIMPLE_SFZ_MODE=false; // 既定OFF
window.setSimpleSfzMode=function(on=true){ SIMPLE_SFZ_MODE=!!on; console.warn('SIMPLE_SFZ_MODE=',SIMPLE_SFZ_MODE); };

// ==============================
// UI: 厳密オクターブ補正/セーブポイント配線
// ==============================
(function wireDevToggles(){
    try{
        // strictOctaveToggle は UI削除のため未配線
        if(noteSnapSaveBtn){
            noteSnapSaveBtn.addEventListener('click', ()=>{
                try{ _noteSnapshot = snapshotNotes(); if(noteSnapRestoreBtn) noteSnapRestoreBtn.disabled = !_noteSnapshot; }catch(_){ _noteSnapshot=null; }
            });
        }
        if(noteSnapRestoreBtn){
            noteSnapRestoreBtn.addEventListener('click', ()=>{
                if(_noteSnapshot){ restoreFromSnap(_noteSnapshot); }
            });
        }
    }catch(e){ console.warn('wireDevToggles failed', e); }
})();

// サンプル拡張子の優先順管理（UIのフォーマット選択と端末のデコード可否を考慮）
let PREFERRED_SAMPLE_EXTS = null; // 明示指定があればここに配列で入る
let SELECTED_SAMPLE_PRIMARY = null; // 実際に選ばれた第一候補（表示用）
function getAltSampleExts(){
    try{
        // 明示の優先順が指定されていればそれを採用
        if(Array.isArray(PREFERRED_SAMPLE_EXTS) && PREFERRED_SAMPLE_EXTS.length){
            SELECTED_SAMPLE_PRIMARY = PREFERRED_SAMPLE_EXTS[0]||null;
            return PREFERRED_SAMPLE_EXTS.slice();
        }
        // ブラウザのサポート能力を検出
        const a=document.createElement('audio');
        const support={
            wav: true, // PCM WAV はほぼ常に可
            ogg: !!a.canPlayType && (a.canPlayType('audio/ogg; codecs=vorbis')||'').length>0,
            mp3: !!a.canPlayType && (a.canPlayType('audio/mpeg')||'').length>0,
            m4a: !!a.canPlayType && ((a.canPlayType('audio/mp4')||a.canPlayType('audio/aac'))||'').length>0
        };
        // UIの選択を参照（あれば）: auto | wav | ogg | mp3 | m4a
        const pref = (typeof formatSelect!=="undefined" && formatSelect && formatSelect.value)? String(formatSelect.value): 'auto';
        const all=['wav','ogg','m4a','mp3'];
        let order=[];
        if(pref && pref!=='auto'){
            // 指定フォーマットを先頭に、残りはサポート状況順
            if(all.includes(pref)) order.push(pref);
        }
        // 残りをサポート順で並べる（簡易: wav > ogg > m4a > mp3）
        const byPrio=['wav','ogg','m4a','mp3'];
        for(const ext of byPrio){ if(!order.includes(ext) && support[ext]) order.push(ext); }
        // 最低でも全候補を含める（将来の拡張用に）
        for(const ext of all){ if(!order.includes(ext)) order.push(ext); }
        SELECTED_SAMPLE_PRIMARY = order[0]||null;
        return order;
    }catch(_){ SELECTED_SAMPLE_PRIMARY=null; return ['wav','ogg','m4a','mp3']; }
}

// 残響(Convolver)とドライ/ウェット合流ノードの初期化と配線
function ensureConvolver(){
    if(!audioCtx || !masterGain) return;
    try{
        // 合流ノード
        if(!preOutMergeGain){ preOutMergeGain = audioCtx.createGain(); preOutMergeGain.gain.value = 1; }
        // 既存の masterGain -> compressor 直結を外し、dry を preOutMergeGain へ
        try{ masterGain.disconnect(); }catch(_){ }
        try{ masterGain.connect(preOutMergeGain); }catch(_){ }
        // 下流へ接続
        try{ preOutMergeGain.disconnect(); }catch(_){ }
        if(compressor){
            try{ preOutMergeGain.connect(compressor); }catch(_){ }
        }else if(limiter){
            try{ preOutMergeGain.connect(limiter); }catch(_){ }
        }else{
            try{ preOutMergeGain.connect(audioCtx.destination); }catch(_){ }
        }
        // IR センド
        if(pianoIRBuffer){
            if(!pianoIRConvolver) pianoIRConvolver = audioCtx.createConvolver();
            try{ pianoIRConvolver.buffer = pianoIRBuffer; }catch(_){ }
            if(!resonanceWetGain) resonanceWetGain = audioCtx.createGain();
            try{ resonanceWetGain.gain.setValueAtTime(resonanceMix, audioCtx.currentTime); }catch(_){ resonanceWetGain.gain.value = resonanceMix; }
            try{ pianoIRConvolver.disconnect(); }catch(_){ }
            try{ masterGain.connect(pianoIRConvolver); }catch(_){ }
            try{ pianoIRConvolver.connect(resonanceWetGain); }catch(_){ }
            try{ resonanceWetGain.connect(preOutMergeGain); }catch(_){ }
        } else {
            try{ if(pianoIRConvolver) pianoIRConvolver.disconnect(); }catch(_){ }
        }
    }catch(e){ console.warn('ensureConvolver failed', e); }
}

// AudioContextが無音で自動suspendされるのを避けるための微小信号を常時流す

// AudioContextが無音で自動suspendされるのを避けるための微小信号を常時流す
function ensureKeepAlive(){
    if(!audioCtx) return;
    // destination直結の微小サイン（低周波）
    if(!_keepAliveOsc) try{
        const osc=audioCtx.createOscillator(); const g=audioCtx.createGain();
        osc.type='sine'; osc.frequency.setValueAtTime(25, audioCtx.currentTime);
        g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
        osc.connect(g); g.connect(audioCtx.destination);
        osc.start(); _keepAliveOsc=osc; _keepAliveGain=g;
    }catch(_){ }
    // 補助: ごく高域の微小サインも流してデバイスの自動サスペンドを避ける
    if(!_keepAliveHiOsc) try{
        const osc=audioCtx.createOscillator(); const g=audioCtx.createGain();
        osc.type='sine'; osc.frequency.setValueAtTime(12000, audioCtx.currentTime);
        g.gain.setValueAtTime(0.00003, audioCtx.currentTime);
        osc.connect(g); g.connect(audioCtx.destination);
        osc.start(); _keepAliveHiOsc=osc; _keepAliveHiGain=g;
    }catch(_){ }
    // チェーン内の DC 微小信号（無音時のsuspend回避）
    if(!_keepAliveConst) try{
        const cs=audioCtx.createConstantSource(); const g=audioCtx.createGain();
        cs.offset.setValueAtTime(0.00001, audioCtx.currentTime);
        g.gain.setValueAtTime(1, audioCtx.currentTime);
        cs.connect(g); g.connect(masterGain||audioCtx.destination);
        cs.start(); _keepAliveConst=cs; _keepAliveConstGain=g;
    }catch(_){ }
}
// コンプレッサ設定微調整（多重発音での飽和抑制）
function tuneCompressor(){ if(!compressor) return; try{ compressor.threshold.value=-28; compressor.knee.value=12; compressor.ratio.value=4.5; compressor.attack.value=0.004; compressor.release.value=0.12; }catch(_){ } }
// シンプル・リミッタ（最終段）
function tuneLimiter(){ if(!limiter) return; try{ limiter.threshold.value=-6; limiter.knee.value=1; limiter.ratio.value=20; limiter.attack.value=0.003; limiter.release.value=0.08; }catch(_){ } }
// もう少し強めのピーク抑制（必要に応じ切替）。初期化時に別途呼び出し可。
function tuneLimiterStrong(){ if(!limiter) return; try{ limiter.threshold.value=-8; limiter.knee.value=1; limiter.ratio.value=20; limiter.attack.value=0.003; limiter.release.value=0.12; }catch(_){ } }

// オーディオ初期化（存在しない場合のみ生成・配線し、必要な場合は再配線）
function ensureAudio(){
    try{
        if(!audioCtx){
            const Ctx = window.AudioContext || window.webkitAudioContext;
            audioCtx = new Ctx({ latencyHint: 'interactive' });
        }
        // 主要ノードの生成
        if(!masterGain) masterGain = audioCtx.createGain();
        if(!melodyGain) melodyGain = audioCtx.createGain();
        if(!accompGain) accompGain = audioCtx.createGain();
        if(!compressor) compressor = audioCtx.createDynamicsCompressor();
        if(!limiter) limiter = audioCtx.createDynamicsCompressor();
        // 初期値
        try{ masterGain.gain.setValueAtTime(1, audioCtx.currentTime); }catch(_){ masterGain.gain.value=1; }
        try{ melodyGain.gain.setValueAtTime(1, audioCtx.currentTime); }catch(_){ melodyGain.gain.value=1; }
        try{ accompGain.gain.setValueAtTime(1, audioCtx.currentTime); }catch(_){ accompGain.gain.value=1; }
        // 既存配線をクリアしてから配線
        try{ melodyGain.disconnect(); }catch(_){ }
        try{ accompGain.disconnect(); }catch(_){ }
        try{ masterGain.disconnect(); }catch(_){ }
        try{ compressor.disconnect(); }catch(_){ }
        try{ limiter.disconnect(); }catch(_){ }
        // melody/accomp -> master -> compressor -> limiter -> destination
        try{ melodyGain.connect(masterGain); }catch(_){ }
        try{ accompGain.connect(masterGain); }catch(_){ }
        try{ masterGain.connect(compressor); }catch(_){ }
        try{ compressor.connect(limiter); }catch(_){ }
        try{ limiter.connect(audioCtx.destination); }catch(_){ }
        // 各種チューニング
        try{ tuneCompressor(); }catch(_){ }
        try{ tuneLimiter(); }catch(_){ }
        // 残響等の合流再配線（preOutMergeGain経由）
        try{ ensureConvolver(); }catch(_){ }
        // UIに合わせたゲイン設定（存在すれば）
        try{
            if(guideVol){ const v=Math.max(0, Math.min(1, parseFloat(guideVol.value)||1)); melodyGain.gain.setValueAtTime(v, audioCtx.currentTime); }
            if(accompVol){ const v=Math.max(0, Math.min(1, parseFloat(accompVol.value)||1)); accompGain.gain.setValueAtTime(v, audioCtx.currentTime); }
        }catch(_){ }
        // 自動サスペンド回避（ユーザー操作後のみ）
        if(audioActivated){ try{ ensureKeepAlive(); }catch(_){ }
            // 再開
            try{ if(audioCtx.state==='suspended'){ audioCtx.resume().catch(()=>{}); } }catch(_){ }
        }
        return audioCtx;
    }catch(e){ console.warn('ensureAudio failed', e); return null; }
}
// 初回ユーザー操作でオーディオをアクティブ化
function activateAudioOnce(){
    try{
        ensureAudio(); audioActivated=true;
        try{ if(audioCtx && audioCtx.state==='suspended'){ audioCtx.resume().catch(()=>{}); } }catch(_){ }
        try{ ensureKeepAlive(); }catch(_){ }
    }catch(_){ }
}

// マイク入力の初期化（解析チェーンのみ。スピーカへは出さない）
async function initMic(allowPrompt=false){
    ensureAudio();
    // ---- 多重/頻発初期化ガード (簡易フロント) ----
    if(typeof window.__micInitInFlight==='undefined') window.__micInitInFlight=false;
    if(typeof window.__lastMicInitAt==='undefined') window.__lastMicInitAt=0;
    const _guardNow = performance.now? performance.now(): Date.now();
    if(window.__micInitInFlight){ return false; }
    if(!allowPrompt && (_guardNow - window.__lastMicInitAt) < 2000){ return false; }
    window.__micInitInFlight = true;
    try{
        if(_initMicInFlight) return false;
        _initMicInFlight = true;
        // 権限状態によりサイレント初期化を判定。明示クリック時は常に getUserMedia を実行し、
        // ブラウザ標準の権限プロンプトを許す（クールダウンでブロックしない）。
        let state = await getMicPermissionState();
        const nowMs = (performance.now? performance.now(): Date.now());
        if(!allowPrompt){
            const canProceedSilently = (state==='granted') || (state===null && _userExplicitMicInit);
            if(!canProceedSilently){
                // 自動/サイレント呼び出しではプロンプトを出さない
                return false;
            }
        } else {
            // 明示操作時はプロンプト許可（連打対策として時刻だけ記録）
            _lastPromptAt = nowMs;
        }
        // 念のため AudioContext を再開（ユーザー操作由来の呼び出しで成功しやすい）
        try{ if(audioCtx && audioCtx.state==='suspended'){ await audioCtx.resume().catch(()=>{}); } }catch(_){ }
        if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){ throw new Error('getUserMedia not available'); }
        // 既存の停止
        try{ if(micStream){ micStream.getTracks().forEach(t=>t.stop()); } }catch(_){ }
        // 可能な限り“生”のマイクを取得（各OS/ブラウザのVAD/NS/AGCを抑止）
        const rawAudio = {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            voiceIsolation: false,
            channelCount: { ideal: 1 },
            sampleRate: { ideal: 48000 },
            latency: { ideal: 0 },
            // Chromium系向けの拡張プロパティ（将来削除されても無害）
            advanced: [
                { googEchoCancellation: false },
                { googExperimentalEchoCancellation: false },
                { googNoiseSuppression: false },
                { googNoiseSuppression2: false },
                { googAutoGainControl: false },
                { googAutoGainControl2: false },
                { googHighpassFilter: false },
                { googAudioMirroring: false }
            ]
        };
        // deviceId指定を付与（選択がある場合）
        const withDevice = Object.assign({}, rawAudio);
        if(selectedMicDeviceId){
            try{ withDevice.deviceId = { exact: selectedMicDeviceId }; }catch(_){ }
        }
        let stream = null;
        try{
            // まずは選択デバイスで試行
            stream = await navigator.mediaDevices.getUserMedia({ audio: withDevice, video:false });
        }catch(e1){
            // 互換性フォールバック（単純指定）
            try{ stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation:false, noiseSuppression:false, autoGainControl:false }, video:false }); }
            catch(e2){
                // 最終フォールバック（ブラウザ任せ）
                stream = await navigator.mediaDevices.getUserMedia({ audio: true, video:false });
            }
        }
        micStream = stream;
        // 実際に使用されたデバイスIDを保存（許される環境のみ）
        try{
            const tr = (stream.getAudioTracks && stream.getAudioTracks()[0]) || null;
            const st = tr && tr.getSettings ? tr.getSettings() : null;
            if(st && st.deviceId){ selectedMicDeviceId = st.deviceId; }
        }catch(_){ }
        micSource = audioCtx.createMediaStreamSource(stream);
        // 前段フィルタ
        micHPF = audioCtx.createBiquadFilter(); micHPF.type='highpass'; micHPF.frequency.setValueAtTime(70, audioCtx.currentTime);
        micLPF = audioCtx.createBiquadFilter(); micLPF.type='lowpass';
        // 高域まで検出できるようにローパスを緩める（D8≈4699Hz を確実に通す）
        try{
            const sr = audioCtx.sampleRate || 48000;
            const cutoff = Math.min(14000, Math.max(6000, sr * 0.45)); // 6k〜14kHzの範囲で自動設定
            micLPF.frequency.setValueAtTime(cutoff, audioCtx.currentTime);
        }catch(_){ micLPF.frequency.value = 8000; }
        // アナライザ（モバイルでもPC同等の分解能へ戻す）
        micAnalyser = audioCtx.createAnalyser();
        micAnalyser.fftSize = 2048;
        micAnalyser.smoothingTimeConstant = 0.0;
        micData = new Float32Array(micAnalyser.fftSize);
        // 配線: mic -> HPF -> LPF -> analyser （destination へは繋がない）
        try{ micSource.disconnect(); }catch(_){ }
        micSource.connect(micHPF); micHPF.connect(micLPF); micLPF.connect(micAnalyser);
        // YIN/CMNDF tracker modules (if available)
        try{
            const M = window.__PitchModules;
            if(M){
                _yinTracker = new M.YinPitchTracker({ sampleRate: audioCtx.sampleRate, frameSize: micAnalyser.fftSize, fmin: 55, fmax: 2000, threshold: 0.12 });
                // hop = frame/2 に近い解析レートへ（目安）。UIの値より低すぎる場合に引き上げ。
                try{
                    const sr = audioCtx.sampleRate || 48000;
                    const hop = Math.max(1, Math.floor(micAnalyser.fftSize/2));
                    // モバイルの上限を引き上げ（応答性）: 90 → 110。PCは従来通り最大120。
                    const hopRate = Math.max(10, Math.min(IS_MOBILE? 110: 120, Math.round(sr / hop)));
                    analysisRate = Math.max(analysisRate||0, hopRate);
                }catch(_){ }
                // モバイルはわずかに強めのスムージング（微細な揺れを抑制）。PCは従来値。
                _pitchSmootherMod = new M.PitchSmoother(
                    IS_MOBILE
                        ? { windowSize: 7, deadbandCents: 6, riseCents: 30, fallCents: 38 }
                        : { windowSize: 7, deadbandCents: 8, riseCents: 35, fallCents: 45 }
                );
            }
        }catch(_){ /* ignore */ }
        // 解析タイマー（モバイルは再設定で cadence を揃える）
        if(analysisTimer){ try{ clearInterval(analysisTimer); }catch(_){ } analysisTimer=null; }
        analysisTimer = setInterval(analyzePitch, 1000/analysisRate);
        // MIC ステータス表示
        try{ setMicStatus('ON'); }catch(_){ }
        // 許可後は一覧のラベルが取得できるため更新
        try{
            if(navigator.mediaDevices && navigator.mediaDevices.enumerateDevices){
                const devs = await navigator.mediaDevices.enumerateDevices();
                _micDevicesCache = devs.filter(d=>d.kind==='audioinput');
                refreshMicPickerList();
            }
        }catch(_){ }
        try{
            const tracks = (micStream.getAudioTracks? micStream.getAudioTracks(): micStream.getTracks());
            tracks.forEach(async t=>{
                if(!t) return;
                // 可能ならトラック側にも“生”設定を適用
                try{ await t.applyConstraints({ echoCancellation:false, noiseSuppression:false, autoGainControl:false, advanced:[{ echoCancellation:false, noiseSuppression:false, autoGainControl:false }] }).catch(()=>{}); }catch(_){ }
                if(!t._onteiBound){
                    t._onteiBound=true;
                    t.onended = ()=>{ try{ setMicStatus('OFF'); }catch(_){} };
                    t.onmute = ()=>{ // 一時的ミュート検出
                        const now=performance.now?performance.now():Date.now();
                        if(now - _micLastReinitAt > 1500){ _micLastReinitAt=now; setTimeout(()=>{ try{ initMic(false).catch(()=>{}); }catch(_){ } }, 50); }
                    };
                    t.onunmute = ()=>{ try{ setMicStatus('ON'); }catch(_){} };
                }
            });
        }catch(_){ }
        _micVoicedRecently=false; _micFlatFrames=0;
        window.__lastMicInitAt = performance.now? performance.now(): Date.now();
        return true;
    }catch(e){ console.warn('initMic failed', e); try{ setMicStatus('OFF'); }catch(_){ } return false; }
    finally{ _initMicInFlight = false; window.__micInitInFlight=false; }
}

// マイク一覧の取得
async function enumerateMicInputs(){
    try{
        if(!(navigator.mediaDevices && navigator.mediaDevices.enumerateDevices)) return [];
        const list = await navigator.mediaDevices.enumerateDevices();
        return list.filter(d=>d.kind==='audioinput');
    }catch(_){ return []; }
}

// マイク選択UI
function openMicPicker(){
    try{
        let ov = document.getElementById('micPickerOverlay');
        if(!ov){
            ov = document.createElement('div'); ov.id='micPickerOverlay';
            ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;z-index:5000;';
            const card = document.createElement('div'); card.id='micPickerCard';
            card.style.cssText='min-width:260px;max-width:92vw;background:#222;color:#eee;border:1px solid #4e8cff;border-radius:8px;padding:14px;font-family:sans-serif;box-shadow:0 8px 28px rgba(0,0,0,0.4);';
            card.innerHTML = `
                <div style="font-size:16px;font-weight:600;margin-bottom:8px;">マイクの選択</div>
                <div id="micPickerInfo" style="font-size:12px;opacity:0.85;margin-bottom:8px;">許可後に一覧が表示されます。まずは「権限を許可」を押してください。</div>
                <select id="micDeviceSelect" style="width:100%;margin-bottom:10px;padding:6px;border-radius:4px;border:1px solid #555;background:#111;color:#eee"></select>
                <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
                    <button id="micPickerPermBtn" style="padding:6px 10px;border:1px solid #777;background:#333;color:#eee;border-radius:4px">権限を許可</button>
                    <button id="micPickerStartBtn" style="padding:6px 10px;border:1px solid #4e8cff;background:#2a4d8f;color:#fff;border-radius:4px">このマイクで開始</button>
                    <button id="micPickerCancelBtn" style="padding:6px 10px;border:1px solid #777;background:#444;color:#eee;border-radius:4px">キャンセル</button>
                </div>`;
            ov.appendChild(card); document.body.appendChild(ov);
            // events
            card.querySelector('#micPickerCancelBtn').onclick = ()=> closeMicPicker();
            card.querySelector('#micPickerPermBtn').onclick = async()=>{
                _userExplicitMicInit=true; await initMic(true);
                const list = await enumerateMicInputs(); _micDevicesCache = list; refreshMicPickerList();
            };
            card.querySelector('#micPickerStartBtn').onclick = async()=>{
                const sel = card.querySelector('#micDeviceSelect'); const val = sel && sel.value;
                selectedMicDeviceId = (val && val!=='default') ? val : null;
                _userExplicitMicInit=true; await initMic(true); closeMicPicker();
            };
        }
        refreshMicPickerList(); ov.style.display='flex';
    }catch(e){ console.warn('openMicPicker failed',e); }
}
function refreshMicPickerList(){
    const ov = document.getElementById('micPickerOverlay');
    const sel = ov && ov.querySelector('#micDeviceSelect');
    const info = ov && ov.querySelector('#micPickerInfo');
    const startBtn = ov && ov.querySelector('#micPickerStartBtn');
    if(!sel || !info || !startBtn) return;
    sel.innerHTML='';
    const list = _micDevicesCache||[]; const hasList = Array.isArray(list) && list.length>0;
    if(!hasList){
        const opt=document.createElement('option'); opt.value='default'; opt.textContent='(一覧は権限許可後に表示)'; sel.appendChild(opt);
        info.textContent='「権限を許可」を押すとマイク一覧が表示されます。'; startBtn.disabled=false; return;
    }
    const mk=(id,label)=>{ const o=document.createElement('option'); o.value=id||'default'; o.textContent=label||id||'default'; return o; };
    sel.appendChild(mk('default','(デフォルト)'));
    list.forEach((d,i)=>{ sel.appendChild(mk(d.deviceId, (d.label&&d.label.trim())?d.label:(`マイク${i+1}`))); });
    sel.value = selectedMicDeviceId || 'default';
    info.textContent='使用するマイクを選んで「このマイクで開始」を押してください。'; startBtn.disabled=false;
}
function closeMicPicker(){ const ov=document.getElementById('micPickerOverlay'); if(ov) ov.style.display='none'; }


// 出力レイテンシ推定（端末依存）
function estimateOutputLatency(){
    let est=0;
    try{
        if(audioCtx){
            if(typeof audioCtx.outputLatency==='number') est+=audioCtx.outputLatency||0;
            if(typeof audioCtx.baseLatency==='number') est+=audioCtx.baseLatency||0;
        }
    }catch(_){ }
    if(!est || !isFinite(est) || est<0.005){
        // おおまかな既定値: iOS はやや大きめ
        est = isIOS()? 0.12 : 0.08;
    }
    return Math.max(0.03, Math.min(0.3, est));
}

// ---- 自動レイテンシキャリブレーション ----
async function runLatencyCalibration(){
    try{
        ensureAudio();
        // 既に初期化済みなら再要求しない（許可ダイアログを二度出さない）
        if(!micAnalyser){
            await initMic(false).catch(()=>{});
        }
        // 再生中なら一時停止（計測の邪魔を避ける）
        if(isPlaying){ try{ pausePlayback(); }catch(_){ } }
    // 表示用のゴーストノーツを4個生成（タイムライン上: 現在位置の少し右から開始）
        const startLeadSec = 0.0; // カウントダウン0時点で動かす
        const spacingSec = 0.9;   // ノーツ間隔を広げる
        const noteDurSec = 0.45;  // ノーツ長
    const count = 4;
        const baseMidi = 60; // C4 をデフォルト
        const startSong = (playbackPosition||0) + 0.8; // 画面上でより右側から開始
        const ghost=[]; const targetTimes=[];
        for(let i=0;i<count;i++){
            ghost.push({midi:baseMidi, time:startSong + i*spacingSec, duration:noteDurSec, role:'calib'});
        }
    // カウントダウン前にゴーストを表示（静止）し、アンカーを設定してノーツ近傍にカウントを描く
    _calibAbort = false; // 中断フラグ初期化
        isCalibrating = true;
        midiGhostNotes = ghost; calibPrevPos = playbackPosition; calibBasePos = startSong;
        calibAnchorActive = true; calibAnchorTime = ghost[0].time; calibAnchorMidi = ghost[0].midi; drawChart();
        // 3,2,1 をキャンバスに大きく表示（ゼロでノーツ開始）
    calibCountdownText='3'; drawChart(); setTimeout(()=>drawChart(), 0); if(btCalibStatus) btCalibStatus.textContent='準備… 3';
    await new Promise(r=>setTimeout(r,600)); calibCountdownText='2'; drawChart(); setTimeout(()=>drawChart(), 0); if(btCalibStatus) btCalibStatus.textContent='準備… 2';
    await new Promise(r=>setTimeout(r,600)); calibCountdownText='1'; drawChart(); setTimeout(()=>drawChart(), 0); if(btCalibStatus) btCalibStatus.textContent='準備… 1';
    await new Promise(r=>setTimeout(r,500)); calibCountdownText=null; drawChart(); if(btCalibStatus) btCalibStatus.textContent='測定中…（表示された4つのノーツに合わせて発声）';
        // 簡易アニメーションループ（再生状態を使わずに timelineOffsetSec 相当を動かす）
        // カウントゼロ時点を基準に動かす（事前にstartPerfを設定しない）
        calibMoveStartPerf = performance.now()/1000;
        calibPrevPos = playbackPosition;
        const animate = ()=>{
            if(!isCalibrating || _calibAbort) return;
            try{
                const nowP = performance.now()/1000;
                const dt = Math.max(0, nowP - calibMoveStartPerf);
                // 見かけ上、再生線に向かってノーツが右→左へ動くように見せる
                // 再生中ロジックを使わないため、eff を増やすために playbackPosition を進める
                playbackPosition = calibPrevPos + dt; // 1x で進行
                drawChart();
                _calibRAF = requestAnimationFrame(animate);
            }catch(_){ _calibRAF = requestAnimationFrame(animate); }
        };
        if(_calibRAF) cancelAnimationFrame(_calibRAF); _calibRAF = requestAnimationFrame(animate);
        // 音は鳴らさない（可視ゴーストのみ）。開始時刻列を作成。
        const t0 = (audioCtx?.currentTime||0) + startLeadSec + 0.02;
        for(let i=0;i<count;i++){ const when = t0 + i*spacingSec; targetTimes.push(when); }
        const sr = audioCtx.sampleRate||48000; const win=2048; const tmp=new Float32Array(win);
        const onsetTimes=[];
        const deadline = t0 + count*spacingSec + 1.2; // AudioContext 時間ベース
        const wallDeadline = (performance.now()/1000) + (count*spacingSec + 2.0); // 壁時計ベースの保険
        // ループして閾値超えを時刻化
        let lastDb=-120; const threshUp=8; // dB 上昇量で検出
        while(true){
            if(_calibAbort) break;
            const nowCtx = (audioCtx?.currentTime)||0;
            const nowPerf = performance.now()/1000;
            if(nowCtx >= deadline || nowPerf >= wallDeadline) break;
            if(!micAnalyser){ await new Promise(r=>setTimeout(r,10)); continue; }
            micAnalyser.getFloatTimeDomainData(tmp);
            // 簡易RMS->dB
            let rms=0; for(let i=0;i<tmp.length;i++){ rms+=tmp[i]*tmp[i]; } rms=Math.sqrt(rms/tmp.length); const db=20*Math.log10(Math.max(1e-9,rms));
            // 上昇検出
            if(db - lastDb > threshUp && db>-50){
                // 解析フレームの中心遅延とポーリングジッタを控除してオンセットを前倒し補正
                const srLoc = (audioCtx?.sampleRate)||48000;
                const frameCenter = ((micAnalyser?.fftSize)||2048) / (2*srLoc); // 約21ms@48k
                const pollJitter = 0.005; // 5ms 仮定
                const onset = Math.max(0, audioCtx.currentTime - frameCenter - pollJitter);
                onsetTimes.push(onset);
            }
            lastDb = db*0.8 + lastDb*0.2; // 少しスムージング
            await new Promise(r=>setTimeout(r, 10));
        }
        if(_calibAbort){
            // ユーザー中断: 後片付けして終了
            try{ if(_calibRAF) cancelAnimationFrame(_calibRAF); }catch(_){ }
            _calibRAF = 0; isCalibrating=false; calibAnchorActive=false; midiGhostNotes=null; drawChart();
            if(btCalibStatus) btCalibStatus.textContent='測定は中断されました';
            try{ seekTo(0); }catch(_){ playbackPosition=0; playbackStartPos=0; drawChart(); }
            return;
        }
        // マッチング: それぞれ最も近い onset と対応付け
        const deltas=[];
        for(const tt of targetTimes){
            let best=null,bd=1e9; for(const ot of onsetTimes){ const d=Math.abs(ot-tt); if(d<bd){ bd=d; best=ot; } }
            if(best!=null) deltas.push(best-tt);
        }
    // ゴーストノーツとアニメーションの後始末
    isCalibrating=false; if(_calibRAF){ try{ cancelAnimationFrame(_calibRAF); }catch(_){ } _calibRAF=0; }
    calibAnchorActive=false;
    midiGhostNotes = null; drawChart(); // メロディ表示を復帰
        if(deltas.length>=4){
            // 外れ値除去の中央値
            deltas.sort((a,b)=>a-b); const med=deltas[Math.floor(deltas.length/2)];
            // 入力側の系統遅延（解析窓中心＋ポーリング＋検出バイアス ~ 数ms）を控除し、出力遅延に近づける
            const srLoc = (audioCtx?.sampleRate)||48000;
            const frameCenter = ((micAnalyser?.fftSize)||2048) / (2*srLoc);
            const detectBias = 0.015; // 閾値・包絡立上り等のバイアス推定(15ms)
            const inputBiasSec = frameCenter + 0.005 + detectBias; // ≈ 21ms + 5ms + 15ms = ~41ms @48k
            const medOut = Math.max(0, med - inputBiasSec);
            const ms=Math.round(Math.max(0, Math.min(0.5, medOut))*1000);
            const oldMs = Math.round((btLatencySec||0)*1000);
            btLatencySec = ms/1000;
            btLatencyEnabled = true;
            if(btLatencyToggle) btLatencyToggle.checked=true;
            if(btLatencySlider){ btLatencySlider.value=String(ms); btLatencySlider.disabled=false; }
            if(btLatencyValue) btLatencyValue.textContent = `${ms} ms`;
            if(btCalibStatus) btCalibStatus.textContent = `測定結果: 約 ${ms} ms（自動適用）`;
            try{
                // 測定結果のダイアログを表示（ユーザー要望により復活）
                setTimeout(()=>{ try{ alert(`自動遅延補正の結果を適用しました:\n\n推定出力遅延: 約 ${ms} ms\n(以前: ${oldMs} ms)`); }catch(_){ } }, 0);
            }catch(_){ }
            // UI反映後に再描画（適用結果とメロディを表示）
            drawChart();
        }else{
            if(btCalibStatus) btCalibStatus.textContent = '測定できませんでした。ノーツに合わせてもう一度お試しください。';
            try{ setTimeout(()=>{ try{ alert('自動遅延補正: 測定できませんでした。\n\n周囲のノイズを減らし、ノーツに合わせて短く発声してください。'); }catch(_){ } }, 0); }catch(_){ }
            // 失敗時もダイアログは出さない（UI上の表示に委ねる）
        }
        // キャリブレーション終了後は頭に戻る
        try{ seekTo(0); }catch(_){ playbackPosition=0; playbackStartPos=0; drawChart(); }
    }catch(e){
        console.warn('calibration failed',e);
        if(btCalibStatus) btCalibStatus.textContent='測定エラー';
    } finally {
        // どんな経路でもリソースを確実に解放し、表示を復帰
        try{ if(_calibRAF) cancelAnimationFrame(_calibRAF); }catch(_){ }
        _calibRAF = 0;
        if(isCalibrating || midiGhostNotes){
            isCalibrating=false; calibAnchorActive=false; midiGhostNotes=null;
            drawChart();
        }
    }
}

// ---- 遅延補正アシスト（無限ループ） ----
async function runLatencyAssist(){
    try{
        ensureAudio();
        if(!micAnalyser){ await initMic(false).catch(()=>{}); }
        if(isPlaying){ try{ pausePlayback(); }catch(_){ } }
        // 既存のキャリブレーション表示変数を流用
        _assistAbort = false; isAssistMode = true; isCalibrating = true; // カウントダウン表示のため calibrating フラグも使う
        // ノーツ生成: 現在位置の少し右から開始し、一定間隔で流し続ける
        const baseMidi = 60; // C4
        const spacingSec = 0.8; // 一定間隔
        const noteDurSec = 0.45;
        const startSong = (playbackPosition||0) + 0.8;
        midiGhostNotes = [];
        calibPrevPos = playbackPosition; calibBasePos = startSong;
        calibAnchorActive = true; calibAnchorTime = startSong; calibAnchorMidi = baseMidi;
        // カウントダウン
        calibCountdownText='3'; drawChart(); setTimeout(()=>drawChart(), 0); if(btCalibStatus) btCalibStatus.textContent='準備… 3';
        await new Promise(r=>setTimeout(r,600)); calibCountdownText='2'; drawChart(); setTimeout(()=>drawChart(), 0); if(btCalibStatus) btCalibStatus.textContent='準備… 2';
        await new Promise(r=>setTimeout(r,600)); calibCountdownText='1'; drawChart(); setTimeout(()=>drawChart(), 0); if(btCalibStatus) btCalibStatus.textContent='準備… 1';
    await new Promise(r=>setTimeout(r,500)); calibCountdownText=null; drawChart(); if(btCalibStatus) btCalibStatus.textContent='アシスト中… 停止ボタンで終了できます';
    // 遅延補正を有効化（即時反映用）
    btLatencyEnabled = true; if(btLatencyToggle){ btLatencyToggle.checked = true; }
    if(btLatencySlider){ btLatencySlider.disabled = false; }
    // 以降は記録を許可するため calibrating は解除
    isCalibrating = false;
    // 解析タイマーを起動
    if(!analysisTimer){ analysisTimer = setInterval(analyzePitch, 1000/analysisRate); }
    // 既存の赤点履歴はクリア（調整を見やすく）
    pitchHistory = []; scoreSessionId++;
    // アニメーション開始
        calibMoveStartPerf = performance.now()/1000; calibPrevPos = playbackPosition;
        const animate = ()=>{
            if(!isAssistMode || _assistAbort) return;
            try{
                const nowP = performance.now()/1000; const dt = Math.max(0, nowP - calibMoveStartPerf);
                playbackPosition = calibPrevPos + dt; // 1x速度
                // ゴーストノーツを必要分だけ補充
                const tNow = playbackPosition;
                const wantAhead = 8; // 先読みノーツ数
                let lastTime = (midiGhostNotes.length? (midiGhostNotes[midiGhostNotes.length-1].time + midiGhostNotes[midiGhostNotes.length-1].duration) : startSong - spacingSec);
                // 可視領域からだいぶ左の古いゴーストは間引く
                const keepAfter = tNow - 5;
                if(Array.isArray(midiGhostNotes) && midiGhostNotes.length){
                    while(midiGhostNotes.length && (midiGhostNotes[0].time + midiGhostNotes[0].duration) < keepAfter){ midiGhostNotes.shift(); }
                }
                // 未来側を埋める
                while(true){
                    const futureCount = midiGhostNotes.filter(n=> n.time >= tNow - 0.1).length;
                    if(futureCount >= wantAhead) break;
                    const nextStart = (midiGhostNotes.length? (midiGhostNotes[midiGhostNotes.length-1].time + spacingSec) : (startSong));
                    midiGhostNotes.push({midi:baseMidi, time: nextStart, duration: noteDurSec, role:'calib'});
                }
                drawChart();
                _assistRAF = requestAnimationFrame(animate);
            }catch(_){ _assistRAF = requestAnimationFrame(animate); }
        };
        if(_assistRAF) cancelAnimationFrame(_assistRAF); _assistRAF = requestAnimationFrame(animate);
    }catch(e){
        console.warn('assist start failed', e);
        // 失敗時はクリーンアップ
        try{ if(_assistRAF) cancelAnimationFrame(_assistRAF); }catch(_){ }
        _assistRAF=0; isAssistMode=false; isCalibrating=false; calibAnchorActive=false; midiGhostNotes=null; drawChart();
        if(btCalibStatus) btCalibStatus.textContent='アシスト開始に失敗しました';
    }
}

function stopLatencyAssist(){
    try{ _assistAbort = true; if(_assistRAF){ cancelAnimationFrame(_assistRAF); } }catch(_){ }
    _assistRAF = 0; isAssistMode=false; isCalibrating=false; calibAnchorActive=false; midiGhostNotes=null; drawChart();
    if(btCalibStatus) btCalibStatus.textContent='アシスト終了';
}
// 旧・下部固定バッジは廃止（index.htmlのコントロールに集約）

// バッファ先頭のゼロクロス近傍を検索（最大 maxMs 内）。見つからなければ 0 を返す。
function findZeroCrossOffsetSec(buf, maxMs){
    try{
        const sr = buf.sampleRate||48000;
        const chL = buf.numberOfChannels>0? buf.getChannelData(0): null;
        const chR = buf.numberOfChannels>1? buf.getChannelData(1): null;
        if(!chL) return 0;
        const maxS = Math.min(chL.length, Math.floor(sr * (maxMs||0.005)));
        // 1) 真のゼロクロス（符号反転）を優先。左右の平均で判定。
        let prev = (chL[0] + (chR? chR[0]: 0)) * (chR? 0.5: 1);
        for(let i=1;i<maxS;i++){
            const cur = (chL[i] + (chR? chR[i]: 0)) * (chR? 0.5: 1);
            if((prev<=0 && cur>0) || (prev>=0 && cur<0)){
                // 線形補間で正確なゼロ交差点を推定
                const frac = Math.abs(cur - prev) > 1e-12 ? (Math.abs(prev) / Math.abs(cur - prev)) : 0;
                const pos = (i-1) + frac; // サンプル精度
                return pos / sr;
            }
            prev = cur;
        }
        // 2) 符号反転が無ければ、絶対値最小点を選ぶ（左右平均）
        let bestI=0; let bestAbs=1e9;
        for(let i=0;i<maxS;i++){
            const vL = Math.abs(chL[i]); const vR = chR? Math.abs(chR[i]) : vL; const v = (vL + vR) * (chR? 0.5: 1);
            if(v<bestAbs){ bestAbs=v; bestI=i; if(v<1e-5) break; }
        }
        return bestI / sr;
    }catch(_){ return 0; }
}

// WAVメタデータ解析（sampleRate と smpl ループポイントの抽出）
function readWavMeta(arrayBuffer){
    // RIFF/WAVE の "fmt " と "smpl" を読み、sampleRate とループポイント(サンプル単位)を返す
    const dv=new DataView(arrayBuffer);
    function readStr(off,len){ let s=''; for(let i=0;i<len;i++){ s+=String.fromCharCode(dv.getUint8(off+i)); } return s; }
    let meta={ sampleRate:0, loopStart:null, loopEnd:null };
    try{
        if(readStr(0,4)!=='RIFF' || readStr(8,4)!=='WAVE') return meta;
        let p=12; // chunk start
        const len=dv.byteLength;
        while(p+8<=len){
            const id=readStr(p,4); const size=dv.getUint32(p+4,true); const body=p+8; const next=body+size + (size%2);
            if(id==='fmt '){
                if(size>=16){ meta.sampleRate = dv.getUint32(body+4,true); }
            } else if(id==='smpl'){
                // https://sites.google.com/site/musicgapi/technical-documents/wav-file-format#smpl
                if(size>=36){
                    const numLoops = dv.getUint32(body+28,true);
                    let lpOff = body+36;
                    for(let i=0;i<numLoops;i++){
                        if(lpOff+24>len) break;
                        const start = dv.getUint32(lpOff+8,true);
                        const end   = dv.getUint32(lpOff+12,true);
                        // 最初のループを採用
                        meta.loopStart = start; meta.loopEnd = end; break;
                    }
                }
            }
            p = next;
        }
    }catch(_){ }
    return meta;
}
// ---- Audio file loader (melody/accompaniment) ----
let melodyBuffer=null, accompBuffer=null;
let melodySource=null, accompSource=null;
let melodyDuration=0, accompDuration=0;
let melodyNotesExtracted=false;
// セッション保存用に元の音声バイトも保持
let melodyOrigBytes=null, melodyOrigName=null, melodyOrigExt=null;
let accompOrigBytes=null, accompOrigName=null, accompOrigExt=null;

async function decodeAudioFile(file){
    ensureAudio();
    const ab=await file.arrayBuffer();
    return await new Promise((res,rej)=> audioCtx.decodeAudioData(ab, b=>res(b), e=>rej(e)));
}

function stopAllSources(){
    try{ if(melodySource){ melodySource.stop(); melodySource.disconnect(); } }catch(_){ }
    try{ if(accompSource){ accompSource.stop(); accompSource.disconnect(); } }catch(_){ }
    try{ melodySources.forEach(s=>{ try{s.stop(0);}catch(_){ } try{s.disconnect();}catch(_){ } }); }catch(_){ }
    melodySources=[];
    melodySource=null; accompSource=null;
}

function createAndStartSource(buf, when, offset, destGain){
    const src=audioCtx.createBufferSource(); src.buffer=buf; src.connect(destGain);
    try{ src.start(when, Math.max(0, offset)); }catch(_){ src.start(); }
    return src;
}

// メロディ波形から単音列を高精度抽出
// 手法: 正規化自己相関(NACF) + パラボリック補間 + 連続性制約(±2半音) + ヒステリシス分節 + 短音マージ
async function extractMelodyNotesFromBuffer(buf){
    // 解析中オーバーレイ
    const overlay=document.getElementById('analyzingOverlay');
    if(overlay){ overlay.classList.remove('hidden'); }
    const sr = buf.sampleRate;
    const ch0 = buf.getChannelData(0);
    // ステレオは簡易平均でモノラル化
    const ch1 = buf.numberOfChannels>1 ? buf.getChannelData(1) : null;
    const mono = new Float32Array(ch0.length);
    for(let i=0;i<mono.length;i++) mono[i] = ch0[i] * (ch1? 0.5: 1) + (ch1? ch1[i]*0.5 : 0);
    // プリエンファシス（フォルマント影響の軽減） y[n]=x[n]-a*x[n-1]
    try{
        const a = 0.97;
        let prev = 0;
        for(let i=0;i<mono.length;i++){
            const x = mono[i];
            mono[i] = x - a*prev;
            prev = x;
        }
    }catch(_){ }

    // パフォーマンス改善: 粗リサンプル（~11.025kHz）して計算量を大幅に削減
    const targetSR = 11025;
    const dsFactor = Math.max(1, Math.floor(sr/targetSR));
    const srd = sr / dsFactor; // 実際のダウンサンプルSR
    const dsLen = Math.floor(mono.length / dsFactor);
    const ds = new Float32Array(dsLen);
    // 簡易ブロック平均でダウンサンプリング
    for(let i=0, j=0; i<dsLen; i++, j+=dsFactor){
        let sum=0; let cnt=0; for(let k=0;k<dsFactor && (j+k)<mono.length; k++){ sum+=mono[j+k]; cnt++; }
        ds[i] = sum/Math.max(1,cnt);
    }

    // 解析設定（ダウンサンプル後の帯域に合わせる）
    const fmin = 65;   // Hz
    const fmax = 1200; // Hz
    const desiredRate = Math.max(28, Math.min(60, (analysisRate||20)+25)); // 高頻度化（~60fps上限）
    // 窓長は ~90ms 目安、[1024,2048]の2冪で丸め
    const targetWinSec = 0.09; const targetW = Math.floor(srd*targetWinSec);
    const pow2 = (x)=> 1<<Math.round(Math.log2(Math.max(1,x)));
    const W = Math.max(1024, Math.min(2048, pow2(targetW)));
    const H = Math.max(1, Math.floor(srd/Math.max(28, desiredRate))); // 解析fpsを引き上げ
    const tauMin = Math.max(2, Math.floor(srd / fmax));
    const tauMax = Math.max(tauMin+2, Math.min(Math.floor(srd / fmin), Math.floor(W*0.9)));
    // 窓関数（Hann）
    const hann = new Float32Array(W);
    for(let n=0;n<W;n++) hann[n] = 0.5*(1-Math.cos(2*Math.PI*n/(W-1)));

    // 連続性制約: 前回推定を利用して探索範囲を±2半音に絞る（初回は全域）
    const SEMI_NARROW = Math.pow(2, 2/12); // 約±2半音
    let prevFreq = 0; let prevTau = 0;

    // YIN (CMND) による候補推定: リアルタイムと同一エンジンに統一
    // ここでは frameArr を YinPitchTracker に投入し、tau と conf を返す
    const yinTrackerOffline = (function(){
        try{
            const M = (window && window.__PitchModules) ? window.__PitchModules : null;
            if(M && M.YinPitchTracker){
                const yt = new M.YinPitchTracker({ sampleRate: srd, frameSize: W, fmin, fmax, threshold: 0.15 });
                return yt;
            }
        }catch(_){ }
        return null;
    })();
    function yinBestTauCMND(frameArr){
        try{
            if(yinTrackerOffline){
                const r = yinTrackerOffline.process(frameArr);
                // process は {freq, tau, conf}
                if(r && r.tau && isFinite(r.tau)){
                    return { tau: r.tau, conf: Math.max(0, Math.min(1, r.conf||0)) };
                }
                return { tau: -1, conf: 0 };
            }
        }catch(_){ }
        // フォールバック: 失敗時は無効値
        return { tau: -1, conf: 0 };
    }

    // Goertzel: 任意周波数のパワーを高速算出（FFT不要）
    function goertzelPower(frameArr, sr, freq){
        if(!(freq>0) || freq>=sr*0.5) return 0;
        const w = 2*Math.PI*freq/sr;
        const c = Math.cos(w);
        const coeff = 2*c;
        let s0=0, s1=0, s2=0;
        for(let n=0;n<frameArr.length;n++){
            s0 = frameArr[n] + coeff*s1 - s2;
            s2 = s1; s1 = s0;
        }
        const power = s1*s1 + s2*s2 - coeff*s1*s2; // magnitude^2
        return Math.max(0, power);
    }
    // SHS: f0 の整数倍(1..K)のパワーを減衰重みで合算
    function shsScore(frameArr, sr, f0, K){
        if(!(f0>0)) return 0;
        const maxH = Math.max(1, K|0);
        let sum=0; let used=0;
        for(let k=1;k<=maxH;k++){
            const fk = f0*k; if(fk>=sr*0.5) break;
            const p = goertzelPower(frameArr, sr, fk);
            // 重み 1/k（高次は弱め）
            sum += (p>0? Math.sqrt(p): 0) * (1/k);
            used++;
        }
        return used? sum/used : 0;
    }

    // フレーム毎の推定 -> 周波数列
    const freqs = [];
    const octHints = []; // true: このフレーム推定はオクターブ近傍（tau0/2 or tau0*2）から選ばれた
    const amps = [];
    const frame = new Float32Array(W);
    const NACF_BASE = 0.28; // ベース値（RMSで動的に変化させる）
    const NACF_HOLD   = 1;    // 有声/無声音のヒステリシス用フレーム保持
    let voicedHold = 0;
    let yieldCounter=0;
    const candFreqsPerFrame=[]; // Viterbi用: 各フレームの候補周波数
    const candCostsPerFrame=[]; // Viterbi用: 各フレームの候補コスト（低いほど良い）
    // 自動キャリブレーション: 冒頭約1.5秒で f/2 が f より強い傾向かを推定
    let preferLowerOct=false; let calLowSum=0, calCurSum=0, calFrames=0; const CAL_FRAMES=Math.max(8, Math.min(64, Math.round(1.5*srd/H)));
    for(let i=0;i+W<=ds.length; i+=H){
        // フレーム抽出 + DC除去 + 窓掛け
        let mean=0; for(let k=0;k<W;k++){ mean+=ds[i+k]; }
        mean/=W;
        let energy=0; for(let k=0;k<W;k++){ const v=(ds[i+k]-mean)*hann[k]; frame[k]=v; energy+=v*v; }
        const rms=Math.sqrt(energy/W);
        if(rms<1e-4){
            // 無音フレーム: 時間圧縮を避けるため Viterbi 候補にも無声音を入れて帆走
            freqs.push(0); octHints.push(false); amps.push(rms);
            candFreqsPerFrame.push([0]);
            candCostsPerFrame.push([0.05]); // 深い無音はほぼ無声音
            if((++yieldCounter % 200)===0){ await new Promise(r=>setTimeout(r,0)); }
            continue;
        }

        // 探索範囲の決定（直近tau0を最優先、必要時のみ±1オクターブも検討）
        let searchRanges;
        if(prevFreq>0){
            const tau0 = srd/prevFreq;
            const pad=2;
            const mkRange=(center,type)=>{
                if(!(center>tauMin && center<tauMax)) return null;
                const mn=Math.max(tauMin, Math.floor(center/SEMI_NARROW) - pad);
                const mx=Math.min(tauMax, Math.ceil(center*SEMI_NARROW) + pad);
                if(mx>mn) return {min:mn, max:mx, type};
                return null;
            };
            // ローカル→上オク→下オクの順でスキャン（バイアス付与）
            searchRanges = [
                mkRange(tau0, 'local'),
                mkRange(tau0*0.5, 'oct0_5'),
                mkRange(tau0*2, 'oct2')
            ].filter(Boolean);
        } else {
            searchRanges = [{min:tauMin, max:tauMax, type:'local'}];
        }

        // 正規化自己相関: R(τ)/sqrt(E0*Eτ)
    let bestTau=-1, bestR=-1, bestType='local';
    let bestScore=-1; // バイアス込みの比較用スコア
        // E0（先頭区間エネルギー）とEτはローリングで更新
        // ただし簡素化のため毎回計算（Wが中程度なので十分高速）
        // まず粗探索（step=2）: 検索レンジのユニオンをなめる
        const coarseStep=2;
        for(const rng of searchRanges){
            const bias = (rng.type==='local')? 1.0 : 0.94; // オクターブ候補はわずかに減点
            for(let tau=rng.min; tau<=rng.max; tau+=coarseStep){
                let r=0, e0=0, e1=0;
                const N=W-tau;
                for(let n=0;n<N;n++){
                    const a=frame[n];
                    const b=frame[n+tau];
                    r += a*b; e0 += a*a; e1 += b*b;
                }
                const den = Math.sqrt(e0*e1) + 1e-12;
                const nacf = r/den;
                const score = nacf * bias;
                if(score>bestScore){ bestScore=score; bestR=nacf; bestTau=tau; bestType=rng.type; }
            }
        }
        // 粗探索結果の近傍を微探索（±3 まで広げる: 早いパッセージの変動に追従）
        if(bestTau>0){
            const t0=Math.max(tauMin, bestTau-3), t1=Math.min(tauMax, bestTau+3);
            for(let tau=t0; tau<=t1; tau++){
                let r=0,e0=0,e1=0; const N=W-tau;
                for(let n=0;n<N;n++){ const a=frame[n], b=frame[n+tau]; r+=a*b; e0+=a*a; e1+=b*b; }
                const den=Math.sqrt(e0*e1)+1e-12; const nacf=r/den; if(nacf>bestR){ bestR=nacf; bestTau=tau; }
            }
        }

        // パラボリック補間（隣接点で補正）
        let estTau=bestTau;
        if(bestTau>tauMin && bestTau<tauMax){
            // f(tau-1), f(tau), f(tau+1)
            const fAt = (t)=>{
                let r=0,e0=0,e1=0; const N=W-t;
                for(let n=0;n<N;n++){ const a=frame[n]; const b=frame[n+t]; r+=a*b; e0+=a*a; e1+=b*b; }
                return r/(Math.sqrt(e0*e1)+1e-12);
            };
            const ym1=fAt(bestTau-1), y0=bestR, yp1=fAt(bestTau+1);
            const denom = (ym1 - 2*y0 + yp1);
            if(Math.abs(denom)>1e-9){
                const delta = 0.5*(ym1 - yp1)/denom; // 頂点のずれ（-1..+1）
                if(Math.abs(delta)<=1) estTau = bestTau + delta;
            }
        }

        const estR = bestR;
        // 動的しきい値: 弱音時はしきい値を上げ、強音時は少し下げる
        let nacfThresh = NACF_BASE;
        if(rms<0.008){
            nacfThresh = 0.34;
        } else if(rms>0.06){
            nacfThresh = 0.24;
        } else {
            // 0.008..0.06 の間で線形補間（0.34→0.24）
            const t=(rms-0.008)/(0.06-0.008);
            nacfThresh = 0.34*(1-t) + 0.24*t;
        }
        let freq = (estR>=nacfThresh && estTau>0)? (srd/estTau) : 0;
        if(freq>0){ voicedHold = NACF_HOLD; }
        else if(voicedHold>0){ voicedHold--; freq = (prevFreq>0? prevFreq: 0); } // 短い途切れを補完
        const fOK = (freq>0 && isFinite(freq))? freq: 0;
        freqs.push(fOK);
        octHints.push(bestType!=='local');
        amps.push(rms);
        if(fOK>0) { prevFreq=fOK; prevTau=estTau; } else { /* 保持しない */ }
        // 冒頭キャリブレーション: f と f/2 のSHS比較
        if(calFrames<CAL_FRAMES){
            const fC=fOK; if(fC>0){
                // 既に窓掛け済み frame を利用
                const shF = shsScore(frame, srd, fC, 8);
                const shL = shsScore(frame, srd, fC*0.5, 8);
                calCurSum += shF; calLowSum += shL; calFrames++;
            }
        }

        // 候補生成（NACF + オクターブ派生 + YIN + 無声音）
        const cFreqs=[]; const cCosts=[];
        if(fOK>0){
            const tauBase = Math.max(tauMin, Math.min(tauMax, estTau));
            const bRound=Math.round(tauBase);
            const tauCand = [];
            const pushTau=(t)=>{ const ti=Math.round(t); if(ti>=tauMin && ti<=tauMax) tauCand.push(ti); };
            pushTau(bRound); pushTau(bRound-1); pushTau(bRound+1);
            pushTau(tauBase/2); pushTau(tauBase*2);
            // 候補ごとに NACF と SHS を評価し、後で正規化して合成コストへ
            const tmpCand=[]; // {f, nacf, shs, isOct, shsNorm}
            for(const t of tauCand){
                let r=0,e0=0,e1=0; const N=W-t;
                for(let n=0;n<N;n++){ const a=frame[n], b=frame[n+t]; r+=a*b; e0+=a*a; e1+=b*b; }
                const den=Math.sqrt(e0*e1)+1e-12; const nacf=Math.max(0, Math.min(1, r/den));
                const f = srd/Math.max(1, t);
                const shs = shsScore(frame, srd, f, 8);
                const isOct = (Math.abs(t - Math.round(tauBase/2))<=1) || (Math.abs(t - Math.round(tauBase*2))<=1);
                tmpCand.push({f, nacf, shs, isOct, shsNorm:0});
            }
            // SHS のフレーム内正規化
            let maxShs=0; for(const c of tmpCand) if(c.shs>maxShs) maxShs=c.shs;
            const a=0.75, b=0.25; // NACFをさらに重視（オクターブ誤認を抑制）
            const tmpCost=new Array(tmpCand.length).fill(0);
            for(let i=0;i<tmpCand.length;i++){
                const ci=tmpCand[i]; ci.shsNorm = maxShs>0? (ci.shs/maxShs) : 0;
                let cost = a*(1-ci.nacf) + b*(1-ci.shsNorm);
                if(ci.isOct) cost += 0.06;
                tmpCost[i]=cost;
            }
            // f と 2f のペア比較（lower≒upper/2 を検出）。lowerが同等以上なら upper を強く減点、lowerを微優遇
            for(let i=0;i<tmpCand.length;i++){
                for(let j=0;j<tmpCand.length;j++){
                    if(i===j) continue;
                    const fi=tmpCand[i].f, fj=tmpCand[j].f;
                    // i を upper, j を lower 候補としてチェック
                    if(fi>fj){
                        const rel = Math.abs(fi - 2*fj) / Math.max(1,fi);
                        const tol = preferLowerOct? 0.03 : 0.025;
                        if(rel<tol){
                            const confLower = 0.5*(tmpCand[j].nacf + tmpCand[j].shsNorm);
                            const confUpper = 0.5*(tmpCand[i].nacf + tmpCand[i].shsNorm);
                            const gap = preferLowerOct? 0.2 : 0.15;
                            const penalty = preferLowerOct? 0.32 : 0.25;
                            const reward = preferLowerOct? 0.03 : 0.02;
                            if(confLower >= confUpper - gap){ tmpCost[i]+=penalty; tmpCost[j]=Math.max(0, tmpCost[j]-reward); }
                        }
                    }
                }
            }
            for(let i=0;i<tmpCand.length;i++){ cFreqs.push(tmpCand[i].f); cCosts.push(tmpCost[i]); }
            // YIN 候補
            const yb = yinBestTauCMND(frame);
            if(yb && yb.tau && isFinite(yb.tau)){
                const fy = srd/Math.max(1, yb.tau);
                // YINもSHSで補強（正規化してから合成）
                const yShsRaw = shsScore(frame, srd, fy, 8);
                const yShs = (maxShs>0)? Math.max(0, Math.min(1, yShsRaw/maxShs)) : 0;
                const yNacf = Math.max(0, Math.min(1, yb.conf));
                const cy = a*(1 - yNacf) + b*(1 - yShs);
                cFreqs.push(fy); cCosts.push(cy);
            }
            // フレーム内の候補間で 2f ≒ f の関係がある場合、上側(2f)を強く減点・下側(f)を微優遇
            for(let i=0;i<cFreqs.length;i++){
                for(let j=0;j<cFreqs.length;j++){
                    if(i===j) continue; const fi=cFreqs[i], fj=cFreqs[j];
                    if(fi>fj){ const rel=Math.abs(fi - 2*fj)/Math.max(1,fi); if(rel<0.03){ cCosts[i]+=0.12; cCosts[j]=Math.max(0, cCosts[j]-0.02); } }
                }
            }
        }
        // 無声音候補は常に用意（エネルギに応じてコスト変化）
        const uCost = rms<0.002? 0.05 : (rms<0.01? 0.18 : 0.35);
        cFreqs.push(0); cCosts.push(uCost);
        candFreqsPerFrame.push(cFreqs);
        candCostsPerFrame.push(cCosts);
        // 200フレームごとにUIへ制御を返してフリーズ見えを回避
        if((++yieldCounter % 200)===0){ await new Promise(r=>setTimeout(r,0)); }
    }

    // キャリブ結果を反映
    if(calFrames>=8 && calLowSum > calCurSum*1.18){ preferLowerOct=true; }

    // Viterbi によるフレーム系列の最尤パス
    const M=candFreqsPerFrame.length; const dp=new Array(M); const prv=new Array(M);
    for(let i=0;i<M;i++){ dp[i]=new Array(candFreqsPerFrame[i].length).fill(Infinity); prv[i]=new Array(candFreqsPerFrame[i].length).fill(-1); }
    for(let j=0;j<dp[0].length;j++){ dp[0][j]=candCostsPerFrame[0][j]; }
    const beta=0.12; // 半音距離をやや強く（微増して跳躍抑制）
    const octPenalty=1.25; // ±12近傍の抑制を更に強化
    for(let i=1;i<M;i++){
        const cf=candFreqsPerFrame[i], cc=candCostsPerFrame[i];
        for(let j=0;j<cf.length;j++){
            const f2=cf[j]; let best=Infinity, bestp=-1;
            for(let k=0;k<candFreqsPerFrame[i-1].length;k++){
                const f1=candFreqsPerFrame[i-1][k];
                let trans=0;
                if(f1===0 || f2===0){
                    // 無声↔有声の遷移罰をRMS依存に（弱音は遷移しやすく、強音は遷移しにくい）
                    const aPrev = (amps[i-1]||0), aCur=(amps[i]||0);
                    const aMax = Math.max(aPrev, aCur);
                    const aMin = Math.min(aPrev, aCur);
                    if(aMax<0.008){ trans=0.08; }
                    else if(aMin<0.006){ trans=0.14; }
                    else { trans=0.28; }
                }
                else{
                    const dSemi = Math.abs(12*Math.log2(f2/f1));
                    const nearOct = Math.min(Math.abs(dSemi-12), Math.abs(dSemi-24));
                    trans = beta*dSemi + (nearOct<0.7? octPenalty: 0);
                    // 同一オクターブ群（±6半音内）は微優遇、越える場合は微減点
                    if(dSemi<=6) trans -= 0.03; else if(dSemi<12) trans += 0.03;
                }
                const cost = dp[i-1][k] + cc[j] + trans;
                if(cost<best){ best=cost; bestp=k; }
            }
            dp[i][j]=best; prv[i][j]=bestp;
        }
    }
    // 復元
    let last=0; { let minv=Infinity; for(let j=0;j<dp[M-1].length;j++){ if(dp[M-1][j]<minv){ minv=dp[M-1][j]; last=j; } } }
    const vF=new Array(M).fill(0); for(let i=M-1;i>=0;i--){ vF[i]=candFreqsPerFrame[i][last]; last=prv[i][last]>=0? prv[i][last]: 0; }
    let ftrack = vF;
    // フレームレベル・オクターブデグリッチ（短い±12跳躍を基音側へ畳み込む）
    (function(){
        const L=ftrack.length; if(L<3) return;
        const midis=new Array(L).fill(null);
        for(let i=0;i<L;i++){ const f=ftrack[i]; midis[i]=(f>0&&isFinite(f))? 69+12*Math.log2(f/A4Frequency) : null; }
        const base=new Array(L).fill(null);
        const win=2; // 5点中央値
        for(let i=0;i<L;i++){
            const vals=[]; for(let k=-win;k<=win;k++){ const j=i+k; if(j>=0&&j<L){ const m=midis[j]; if(m!=null) vals.push(m); } }
            if(vals.length){ vals.sort((a,b)=>a-b); base[i]=vals[(vals.length-1)>>1]; }
        }
    const maxRun=4; // フレーム数（短めにして16分を潰さない）
        let s=0; while(s<L){
            // 逸脱判定: 基準から±9半音以上
            while(s<L){ const b=base[s]; const m=midis[s]; if(b!=null&&m!=null&&Math.abs(m-b)>=9) break; s++; }
            if(s>=L) break; let e=s; while(e<L){ const b=base[e]; const m=midis[e]; if(!(b!=null&&m!=null&&Math.abs(m-b)>=9)) break; e++; }
            const runLen=e-s; if(runLen>1 && runLen<=maxRun){
                // 端の基準に合わせて±12を選択
                const ref = base[s>0? s-1: (e<L? e: s)];
                if(ref!=null){
                    for(let i=s;i<e;i++){
                        if(midis[i]==null) continue; let mi=midis[i];
                        while(mi - ref > 6) mi -= 12; while(ref - mi > 6) mi += 12; midis[i]=mi;
                    }
                }
            }
            s=e+1;
        }
        // 反映
        for(let i=0;i<L;i++){ const m=midis[i]; if(m!=null){ ftrack[i]=A4Frequency*Math.pow(2,(m-69)/12); } }
    })();

    // SHS によるスライディング窓のオクターブ補正（f/2 が f より一貫して強い場合は下げる）
    (function(){
        const L=ftrack.length; if(L<4) return;
        const winMs = preferLowerOct? 300 : 260;
        const winFrames=Math.max(4, Math.min(28, Math.round((winMs/1000)*srd/H)));
        const threshRatio = preferLowerOct? 1.15 : 1.25; // フルート的素材は下側優勢判定をやや緩め
        const minRun = preferLowerOct? 4 : 5; // 連続フレーム数
        const indicesDown=new Array(L).fill(false);
        let lowSum=0, curSum=0; const bufFrame=new Float32Array(W);
        const getFrame=(idx)=>{
            const start = idx*H; if(start+W>ds.length) return null;
            // DC除去 + 窓
            let mean=0; for(let k=0;k<W;k++){ mean+=ds[start+k]; }
            mean/=W; let e=0; for(let k=0;k<W;k++){ const v=(ds[start+k]-mean)*hann[k]; bufFrame[k]=v; e+=v*v; }
            return Math.sqrt(e/W);
        };
        const shsAt=(idx, f)=>{ if(!(f>0)&&isFinite(f)) return 0; const rms=getFrame(idx); if(!rms || rms<1e-5) return 0; return shsScore(bufFrame, srd, f, 8); };
        // 先行ウィンドウ初期化
        for(let i=0;i<Math.min(L,winFrames);i++){ const f=ftrack[i]; if(f>0){ curSum += shsAt(i, f); if(f*0.5>0) lowSum += shsAt(i, f*0.5); } }
        let run=0; const mark=(i)=>{ indicesDown[i]=true; };
        for(let i=0;i<L;i++){
            // 判定
            if(curSum>0 && lowSum > curSum*threshRatio){ run++; if(run>=minRun) mark(i); } else { run=0; }
            // スライド
            const outIdx=i; const inIdx=i+winFrames; // out=去る, in=来る
            if(outIdx<L){ const f=ftrack[outIdx]; if(f>0){ const sCur=shsAt(outIdx,f); const sLow=shsAt(outIdx,f*0.5); curSum-=sCur; lowSum-=sLow; } }
            if(inIdx<L){ const f=ftrack[inIdx]; if(f>0){ const sCur=shsAt(inIdx,f); const sLow=shsAt(inIdx,f*0.5); curSum+=sCur; lowSum+=sLow; } }
        }
        // 適用（短い孤立は無視）
        let s=0; while(s<L){ while(s<L && !indicesDown[s]) s++; if(s>=L) break; let e=s; while(e<L && indicesDown[e]) e++; if(e-s>=minRun){ for(let i=s;i<e;i++){ ftrack[i]/=2; } } s=e; }
    })();

    // 最終: オクターブ帯域スムーサ（±12だけを調整して、ゆっくり動く基準帯から±7半音に収める）
    (function(){
        const L=ftrack.length; if(L<3) return;
        const midi = new Array(L).fill(null);
        for(let i=0;i<L;i++){ const f=ftrack[i]; midi[i]=(f>0&&isFinite(f))? 69+12*Math.log2(f/A4Frequency) : null; }
        const base=new Array(L).fill(null);
        const win = Math.max(6, Math.min(14, Math.round((0.22*srd)/H))); // ~220ms 近傍中央値
        const getMed=(arr)=>{ const v=arr.slice().sort((a,b)=>a-b); const n=v.length; return n? v[(n-1)>>1]: null; };
        for(let i=0;i<L;i++){
            const vals=[]; for(let k=-win;k<=win;k++){ const j=i+k; if(j>=0&&j<L){ const m=midi[j]; if(m!=null) vals.push(m); } }
            base[i]=vals.length? getMed(vals): null;
        }
        for(let i=0;i<L;i++){
            if(midi[i]==null || base[i]==null) continue; let m=midi[i], b=base[i];
            while(m - b > 7.0) m-=12; while(b - m > 7.0) m+=12; midi[i]=m;
        }
        for(let i=0;i<L;i++){ const m=midi[i]; if(m!=null){ ftrack[i]=A4Frequency*Math.pow(2,(m-69)/12); } }
    })();

    // 仕上げ: ランニング基準（EMA）によるオクターブ固定（真の大跳躍は許容）
    (function(){
        const L=ftrack.length; if(L<3) return;
        let mRef=null; const alpha=0.12; // 追従速度
        const allowJump=8.5; // 半音。これを超える場合は±12調整を許す
        for(let i=0;i<L;i++){
            const f=ftrack[i]; if(!(f>0)&&isFinite(f)) continue;
            let m = 69+12*Math.log2(f/A4Frequency);
            if(mRef==null){ mRef=m; continue; }
            // まず±12で mRef に最も近いオクターブへ寄せる
            while(m - mRef > 6) m -= 12; while(mRef - m > 6) m += 12;
            // それでも差が大きい場合（真の跳躍）には±12でもう一段調整して許容
            if(Math.abs(m - mRef) > allowJump){ if(m > mRef) m -= 12; else m += 12; }
            // 反映
            ftrack[i] = A4Frequency*Math.pow(2,(m-69)/12);
            // EMA 更新（有声音のみ）
            mRef = (1-alpha)*mRef + alpha*m;
        }
    })();

    // ポストViterbi: 小さなジッタを抑える5点中央値（大跳躍は保持）
    (function(){
        const L=ftrack.length; if(L<5) return;
        const midi=new Array(L).fill(null);
        for(let i=0;i<L;i++){ const f=ftrack[i]; midi[i]=(f>0&&isFinite(f))? 69+12*Math.log2(f/A4Frequency) : null; }
        const out=midi.slice();
        for(let i=2;i<L-2;i++){
            if(midi[i]==null) continue;
            const win=[]; for(let k=-2;k<=2;k++){ const v=midi[i+k]; if(v!=null) win.push(v); }
            if(win.length<3) continue;
            win.sort((a,b)=>a-b);
            const med = win[(win.length-1)>>1];
            if(Math.abs(med - midi[i]) <= 1.2){ out[i]=med; }
        }
        for(let i=0;i<L;i++){ const m=out[i]; if(m!=null){ ftrack[i]=A4Frequency*Math.pow(2,(m-69)/12); } }
    })();

    // セグメンテーション: ヒステリシスと持続時間でノート確定
    const notes=[];
    const idxToTime = (idx)=> idx*H/srd;
    const MIN_NOTE_SEC = 0.07; // 64分音符相当のスパイクを抑制（実テンポに依るが約70ms）
    const HOLD_FRAMES = 2;     // 2フレーム連続で変化して初めて切替（グリッチ抑制）
    let curMidi=null, curStart=0; let changeStreak=0; let lastMidiRounded=null;
    for(let i=0;i<ftrack.length;i++){
        const f=ftrack[i]; const t=idxToTime(i);
        if(f<=0){
            // 無声音: 現ノート確定
            if(curMidi!=null){ const dur=t-curStart; if(dur>0){ notes.push({midi:curMidi, time:curStart, duration:dur}); } curMidi=null; }
            changeStreak=0; lastMidiRounded=null; continue;
        }
        // MIDI連続性（±6半音でオクターブ補正）
        let midiFloat=69+12*Math.log2(f/A4Frequency);
        if(curMidi!=null){
            while(midiFloat - curMidi > 6) midiFloat -= 12;
            while(curMidi - midiFloat > 6) midiFloat += 12;
        }
        const rounded = Math.round(midiFloat);
        if(curMidi==null){
            curMidi=rounded; curStart=t; changeStreak=0; lastMidiRounded=rounded;
        } else {
            if(rounded!==curMidi){
                if(lastMidiRounded===rounded){ changeStreak++; } else { changeStreak=1; lastMidiRounded=rounded; }
                if(changeStreak>=HOLD_FRAMES){
                    // ノート切替確定
                    const dur=t-curStart; if(dur>0){ notes.push({midi:curMidi, time:curStart, duration:dur}); }
                    curMidi=rounded; curStart=t; changeStreak=0;
                }
            } else {
                changeStreak=0; lastMidiRounded=rounded;
            }
        }
    }
    // 終端ノート確定
    if(curMidi!=null){ const endT = idxToTime(ftrack.length); const dur=endT-curStart; if(dur>0){ notes.push({midi:curMidi, time:curStart, duration:dur}); } }

    // 短音マージ（隣接し音程が同じ、または隣ノートと近接かつ短すぎる場合）
    const merged=[];
    for(const n of notes){
        if(!merged.length){ merged.push(n); continue; }
        const prev=merged[merged.length-1];
        if(n.midi===prev.midi && (n.time - (prev.time+prev.duration))<0.02){
            // ほぼ連続なら結合
            prev.duration = (n.time + n.duration) - prev.time;
        } else if(n.duration<MIN_NOTE_SEC && Math.abs(n.midi - prev.midi)<=1 && (n.time - (prev.time+prev.duration))<0.03){
            // 極短を前に吸収
            prev.duration = (n.time + n.duration) - prev.time;
        } else {
            merged.push(n);
        }
    }

    // サンドイッチ短音（A-短いB-A）を吸収して連結
    const cleaned=[];
    for(let i=0;i<merged.length;i++){
        if(i>0 && i<merged.length-1){
            const a=merged[i-1], b=merged[i], c=merged[i+1];
            const gapAB = b.time - (a.time + a.duration);
            const gapBC = c.time - (b.time + b.duration);
            if(b.duration < Math.min(0.06, MIN_NOTE_SEC) && a.midi===c.midi && Math.abs(b.midi - a.midi) <= 1 && gapAB < 0.03 && gapBC < 0.03){
                // a を c まで延長し、b と c をスキップ
                a.duration = (c.time + c.duration) - a.time;
                i++; // c を飛ばす
                continue; // b は追加しない
            }
        }
        cleaned.push(merged[i]);
    }

    // ---- ノート単位のオクターブ安定化（堅牢・高速な貪欲法） ----
    // 各ノート区間の周波数中央値を取り、MIDI化してから前ノートと±6半音に収まるように±12を貪欲に調整。
    // ただし隣接区間の中央値比が明確にオクターブ比（>1.8 or <0.55）なら真の跳躍としてそのまま許容。
    const clampMidiMin=36, clampMidiMax=127;
    const timeToIdx=(t)=> Math.max(0, Math.min(ftrack.length-1, Math.round(t*srd/H)));
    const safeMidi=(m)=> Math.max(clampMidiMin, Math.min(clampMidiMax, m));
    const med = (arr)=>{ const v=arr.slice().sort((a,b)=>a-b); const L=v.length; if(!L) return 0; return (L%2)? v[(L-1)>>1] : 0.5*(v[L/2-1]+v[L/2]); };
    const noteMedFreq=[]; const noteMedMidi=[];
    for(const n of cleaned){
        const i0=timeToIdx(n.time), i1=timeToIdx(n.time+n.duration);
        const vals=[]; for(let i=i0;i<=i1;i++){ const f=ftrack[i]; if(f>0&&isFinite(f)) vals.push(f); }
        const mf = vals.length? med(vals): (A4Frequency*Math.pow(2,(n.midi-69)/12));
        noteMedFreq.push(mf);
        noteMedMidi.push(69+12*Math.log2(mf/A4Frequency));
    }
    // ---- ノート単位：SHSによるオクターブ選択（f/2, f, 2f の中から総SHS最大を選ぶ）----
    (function(){
        const bufFrame=new Float32Array(W);
        const buildFrame=(fi)=>{
            const start=fi*H; if(start+W>ds.length) return null;
            let mean=0; for(let k=0;k<W;k++){ mean+=ds[start+k]; }
            mean/=W; let e=0; for(let k=0;k<W;k++){ const v=(ds[start+k]-mean)*hann[k]; bufFrame[k]=v; e+=v*v; }
            return Math.sqrt(e/W);
        };
        const shsAt=(fi, f0)=>{ if(!(f0>0)&&isFinite(f0)) return 0; const rms = buildFrame(fi); if(!rms || rms<1e-5) return 0; return shsScore(bufFrame, srd, f0, 8); };
        for(let ni=0; ni<cleaned.length; ni++){
            const m0 = noteMedMidi[ni]; const f0 = noteMedFreq[ni]; if(!(f0>0)&&isFinite(f0)) continue;
            const i0=timeToIdx(cleaned[ni].time), i1=timeToIdx(cleaned[ni].time+cleaned[ni].duration);
            // 間引き（計算負荷対策）
            let sHalf=0, sBase=0, sDouble=0; const step=Math.max(1, Math.floor((i1-i0+1)/24));
            for(let fi=i0; fi<=i1; fi+=step){ sBase += shsAt(fi, f0); sHalf += shsAt(fi, f0*0.5); sDouble += shsAt(fi, f0*2); }
            const best = (sHalf>=sBase && sHalf>=sDouble)? -12 : ((sDouble>=sBase && sDouble>=sHalf)? +12 : 0);
            if(best!==0){ noteMedMidi[ni] = m0 + best; }
        }
    })();

    // 音級（pitch class）の優勢度に基づく丸めバイアス
    (function(){
        const hist=new Array(12).fill(0);
        for(const m of noteMedMidi){ if(isFinite(m)){ const pc=((Math.round(m)%12)+12)%12; hist[pc]++; } }
        const order=[...hist.keys()].sort((a,b)=>hist[b]-hist[a]);
        const topPCs=order.slice(0,3);
        // 候補 {floor, round, ceil} の中から、|m-cand| - bias を最小に
        function pickWithBias(m){
            const cands=[Math.floor(m), Math.round(m), Math.ceil(m)];
            let best=cands[0], bestScore=1e9;
            for(const c of cands){
                const pc=((c%12)+12)%12;
                let bias=0; // 正のバイアスで優遇
                if(pc===topPCs[0]) bias=0.10; else if(pc===topPCs[1]) bias=0.06; else if(pc===topPCs[2]) bias=0.03;
                const score=Math.abs(m - c) - bias;
                if(score<bestScore){ bestScore=score; best=c; }
            }
            return best;
        }
        for(let i=0;i<noteMedMidi.length;i++){ noteMedMidi[i]=pickWithBias(noteMedMidi[i]); }
    })();
    const outM=[]; for(let i=0;i<cleaned.length;i++){ outM.push(Math.round(noteMedMidi[i])); }
    // 厳密オクターブ補正（試験）: ノート列に対してオクターブオフセットDPを適用
    if(strictOctaveMode && outM.length>=2){
        // 候補集合 K ∈ {-24, -12, 0, +12, +24}
        const Kcands=[-24,-12,0,12,24];
        const N=outM.length; const M=Kcands.length;
        // ローカルコスト: 近傍ノートの中央値比から跳躍必然度を推定し、オクターブずれに罰を与える
        // 遷移コスト: 半音差に比例 + ±12近傍の追加ペナルティ。ただし真のオクターブ跳躍っぽいときは緩和
        const dp=new Array(N); const prv=new Array(N);
        for(let i=0;i<N;i++){ dp[i]=new Array(M).fill(Infinity); prv[i]=new Array(M).fill(-1); }
        // 前処理: 隣接ノートの周波数比
        const ratios=new Array(N).fill(1);
        for(let i=1;i<N;i++){
            const r = (noteMedFreq[i-1]>0 && noteMedFreq[i]>0)? (noteMedFreq[i]/noteMedFreq[i-1]) : 1;
            ratios[i] = r;
        }
        // ローカルコスト関数
        function localCost(i, kIdx){
            const K = Kcands[kIdx];
            // 近傍のf/2 or 2f優勢が強い場合は、その方向へ寄せる。弱い場合は0優先。
            // noteMedFreq[i] 自体は中域の中央値なので、単純に K≠0 に軽い罰。
            let cost = 0;
            if(K!==0) cost += 0.12; // オフセット使用の基本罰
            return cost;
        }
        // 遷移コスト関数
        function transCost(i, kFrom, kTo){
            const K1=Kcands[kFrom], K2=Kcands[kTo];
            const m1=outM[i-1]+K1, m2=outM[i]+K2;
            const dSemi = Math.abs(m2 - m1);
            // 周波数比から真のオクターブ跳躍らしさ
            const r = ratios[i]; const allowOct = (r>1.8 || r<0.55);
            let cost = 0.10 * dSemi; // 基本: 半音差に比例
            // ±12近傍はやや減点、ただし allowOct のとき緩和
            const nearOct = Math.min(Math.abs(dSemi-12), Math.abs(dSemi-24));
            if(nearOct<0.6){ cost += allowOct? 0.05 : 1.1; }
            // 小さな遷移を微優遇
            if(dSemi<=6) cost -= 0.03;
            return cost;
        }
        // 初期化
        for(let k=0;k<M;k++){ dp[0][k] = localCost(0,k); prv[0][k]=-1; }
        // 漸化式
        for(let i=1;i<N;i++){
            for(let k2=0;k2<M;k2++){
                let best=Infinity, bestp=-1; const lc=localCost(i,k2);
                for(let k1=0;k1<M;k1++){
                    const tc=transCost(i,k1,k2);
                    const c = dp[i-1][k1] + lc + tc;
                    if(c<best){ best=c; bestp=k1; }
                }
                dp[i][k2]=best; prv[i][k2]=bestp;
            }
        }
        // 復元
        let last=0; { let minv=Infinity; for(let k=0;k<M;k++){ if(dp[N-1][k]<minv){ minv=dp[N-1][k]; last=k; } } }
        const Ksel=new Array(N).fill(0);
        for(let i=N-1;i>=0;i--){ Ksel[i]=Kcands[last]; last = (prv[i][last]>=0)? prv[i][last] : 0; }
        // 適用
        for(let i=0;i<N;i++){ outM[i] = safeMidi(outM[i] + Ksel[i]); }
    } else {
        // 既存の近傍連続性ベースの±12調整（従来挙動）
        for(let i=1;i<outM.length;i++){
            const r = noteMedFreq[i-1]>0? (noteMedFreq[i]/noteMedFreq[i-1]) : 1;
            const allowOct = (r>1.8 || r<0.55);
            if(!allowOct){
                // ±6 半音内に収めるため±12で調整
                while(outM[i] - outM[i-1] > 6) outM[i]-=12;
                while(outM[i-1] - outM[i] > 6) outM[i]+=12;
            }
            outM[i]=safeMidi(outM[i]);
        }
    }
    // フレーズ跨ぎ整合: 休符ギャップでフレーズを切り、前フレーズに対して ±12 で最も連続的になるよう整列
    (function(){
        if(cleaned.length<=1) return;
        const PHRASE_GAP_SEC = 0.26; // この無音以上でフレーズ境界
        const phrases=[]; let sIdx=0;
        for(let i=1;i<cleaned.length;i++){
            const prev=cleaned[i-1]; const cur=cleaned[i];
            const gap = cur.time - (prev.time + prev.duration);
            if(gap >= PHRASE_GAP_SEC){ phrases.push({s:sIdx, e:i-1}); sIdx=i; }
        }
        phrases.push({s:sIdx, e:cleaned.length-1});
        if(phrases.length<=1) return;
        const medInt=(arr)=>{ const v=arr.slice().sort((a,b)=>a-b); const n=v.length; return n? v[(n-1)>>1] : 0; };
        const Kcands=[-24,-12,0,12,24];
        const p0=phrases[0]; let prevAnchor=medInt(outM.slice(p0.s,p0.e+1)); let prevLast=outM[p0.e];
        for(let pi=1; pi<phrases.length; pi++){
            const ph=phrases[pi]; const seg=outM.slice(ph.s, ph.e+1); if(!seg.length) continue;
            const mFirst=seg[0]; const mMed=medInt(seg);
            let bestK=0, bestCost=1e9;
            for(const K of Kcands){
                const d1=Math.abs((mFirst+K) - prevLast);
                const d2=Math.abs((mMed+K) - prevAnchor);
                const cost=1.2*d1 + 1.0*d2; // 入口連続性を微優先
                if(cost<bestCost){ bestCost=cost; bestK=K; }
            }
            if(bestK!==0){ for(let i=ph.s;i<=ph.e;i++){ outM[i]=safeMidi(outM[i]+bestK); } }
            prevAnchor=medInt(outM.slice(ph.s, ph.e+1)); prevLast=outM[ph.e];
        }
    })();
    for(let i=0;i<cleaned.length;i++){ cleaned[i].midi = outM[i]; }
    // 同音連結の最終マージ
    const finalNotes=[]; for(const n of cleaned){ if(!finalNotes.length){ finalNotes.push(n); continue; } const p=finalNotes[finalNotes.length-1]; if(n.midi===p.midi && n.time <= p.time+p.duration+0.03){ p.duration = Math.max(p.duration, (n.time+n.duration) - p.time); } else { finalNotes.push(n); } }

    currentTracks=[{name:'Melody', notes: finalNotes}];
    melodyTrackIndex=0; accompTrackIndexes=[]; melodyNotesExtracted=true;
    // ノーツを全置換したため自動センタリングを再有効化して実行
    autoCenterFrozen = false;
    autoCenterMelodyTrack();
    drawChart();
    if(overlay){ overlay.classList.add('hidden'); }
}

// ノート状況デバッグ / 切替ユーティリティをグローバル公開
window.dumpFirstNotes=function(track=0,count=20){ if(!currentTracks[track]){ console.log('no track',track); return; } const arr=currentTracks[track].notes.slice(0,count).map(n=>({midi:n.midi,time:n.time,dur:n.duration,_t:n._timeSec,_d:n._durSec,ticks:n.ticks,durTicks:n.durationTicks})); console.table(arr); };
window.toggleSynth=function(flag){ usePianoSynth=flag; console.log('usePianoSynth=',usePianoSynth); };
window.toggleSamplePiano=function(flag){ useSamplePiano=flag; console.log('useSamplePiano=',useSamplePiano); if(useSamplePiano) loadPianoSamples(); };
// スケジュール後に全くノートが無い場合のフォールバック (初回のみ)
// デフォルトでは誤解を招くため無効化できるフォールバックテストトーン
window.ENABLE_FALLBACK_TONE = false;
function ensureAtLeastOneTestTone(){
    if(!audioCtx) return;
    if(scheduledCounter>0) return;
    if(!window.ENABLE_FALLBACK_TONE) return; // 既定は鳴らさない
    try{
        const osc=audioCtx.createOscillator();
        const g=audioCtx.createGain();
        osc.type='sine';
        osc.frequency.value=440;
        g.gain.setValueAtTime(0.001,audioCtx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.3,audioCtx.currentTime+0.01);
        g.gain.exponentialRampToValueAtTime(0.0001,audioCtx.currentTime+0.6);
        osc.connect(g);
        g.connect(masterGain||audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime+0.62);
        console.warn('Fallback test tone scheduled (no notes were queued).');
    }catch(e){ console.warn('Fallback tone failed',e); }
}
function midiToFreq(m){ return A4Frequency*Math.pow(2,(m-69)/12); }
function seekTo(sec){
    sec=Math.max(0,Math.min(sec,getSongDuration()));
    playbackPosition=sec; playbackStartPos=sec;
    scheduleAll();
    if(isPlaying){ resyncAfterSeek('seekTo'); } else { drawChart(); }
}
function seekRelative(d){ seekTo(playbackPosition+d); }
function getSongDuration(){
    // NaN混入や未定義を無視して最終ノート時刻を堅牢に取得
    let max=0; let any=false;
    try{
        (currentTracks||[]).forEach(t=>{
            const notes=(t&&t.notes)||[]; if(!notes.length) return;
            // 時間順を仮定するが、堅牢性のため全走査
            for(const n of notes){
                const st=Number(n?.time); const du=Number(n?.duration);
                if(isFinite(st) && isFinite(du)){
                    any=true; const end=st+du; if(end>max) max=end;
                }
            }
        });
        // 音声バッファ長も考慮（マルチパート含む）
        if(melodyBuffer){ max=Math.max(max, melodyBuffer.duration||0); any=true; }
        try{
            if(Array.isArray(melodyParts)){
                for(const p of melodyParts){ if(p && p.buffer){ max=Math.max(max, p.buffer.duration||0); any=true; } }
            }
        }catch(_){ }
        if(accompBuffer){ max=Math.max(max, accompBuffer.duration||0); any=true; }
    }catch(_){ }
    return any? max: 0;
}
// 入出力デバイスの変更を監視して、許可済ならサイレント再初期化
try{
    if(navigator.mediaDevices && navigator.mediaDevices.addEventListener){
        navigator.mediaDevices.addEventListener('devicechange', ()=>{
            try{ canInitMicWithoutPrompt().then(ok=>{ if(ok){ initMic(false).catch(()=>{}); } }); }catch(_){ }
        });
    }
}catch(_){ }
// ---- Pan ----
if(chartCanvas){ chartCanvas.onmousedown=e=>{ isPanning=true; panStartX=e.clientX; panStartOffset=timelineOffsetSec; }; }
window.onmousemove=e=>{ if(isPanning && !isAdjustingVOffset){ const dx=e.clientX-panStartX; timelineOffsetSec=panStartOffset-dx/pxPerSec; drawChart(); }};
window.onmouseup=()=>{ if(isPanning){ applyPanCommit(); isPanning=false; }};
function applyPanCommit(){
    if(timelineOffsetSec===0) return;
    playbackPosition+=timelineOffsetSec; if(playbackPosition<0) playbackPosition=0;
    playbackStartPos=playbackPosition; timelineOffsetSec=0; scheduleAll();
    if(isPlaying){
        // 既存の再起動方式 + 再同期
        pausePlayback(); startPlayback();
        try{ if(typeof resyncAfterSeek==='function') resyncAfterSeek('pan-commit'); }catch(_){ }
    } else {
        drawChart();
    }
}
// 水平スクロールバーの範囲更新
function updateTimelineScrollRange(){
    if(!timelineScroll) return;
    const dur = getSongDuration();
    const viewSec = (chartCanvas && chartCanvas.width)? (chartCanvas.width/pxPerSec) : 0;
    const max = Math.max(0, dur - viewSec);
    timelineScroll.min = '0';
    timelineScroll.max = String(max.toFixed(2));
    timelineScroll.step = '0.01';
    const playXS = (chartCanvas && chartCanvas.width)? getPlayX(chartCanvas.width) : 70;
    const left = Math.max(0, Math.min(max, (playbackPosition + timelineOffsetSec) - (playXS/pxPerSec)));
    timelineScroll.value = String(left.toFixed(2));
}
// スクロール操作
timelineScroll && (timelineScroll.oninput = () => {
    const x = parseFloat(timelineScroll.value)||0;
    const playXS = (chartCanvas && chartCanvas.width)? getPlayX(chartCanvas.width) : 70;
    const playXSec = playXS/pxPerSec; // 再生線の左オフセット(秒)
    const newEff = x + playXSec; // eff = playbackPosition + timelineOffsetSec
    const delta = newEff - (playbackPosition + timelineOffsetSec);
    timelineOffsetSec += delta;
    drawChart();
    if(isPlaying) resyncAfterSeek('scrollbar');
});
// ---- Markers ----
Object.keys(markerCfg).forEach(k=>{ const [s,p]=markerCfg[k]; const sb=$(s),pb=$(p); if(sb) sb.onclick=()=> markers[k]=playbackPosition; if(pb) pb.onclick=()=>{ if(markers[k]!=null) seekTo(markers[k]); }; });
// ---- Pitch ----
function analyzePitch(){
    const nowMs = (typeof performance!=='undefined' && performance.now)? performance.now() : Date.now();
    try{ if(audioCtx && audioCtx.state==='suspended'){ audioCtx.resume().catch(()=>{}); } }catch(_){ }
    if(!micAnalyser||!micData) return;
    try{ micAnalyser.getFloatTimeDomainData(micData); }catch(_){ return; }
    // ゲート用RMSとUIメータ
    let rms=0; for(let i=0;i<micData.length;i++) rms+=micData[i]*micData[i]; rms=Math.sqrt(rms/Math.max(1,micData.length));
    const db=20*Math.log10(Math.max(1e-9,rms));
    if(micLevelBar){ const norm=Math.min(1,Math.max(0,(db+60)/60)); micLevelBar.style.width=(norm*100)+'%'; }
    if(micDbText){ micDbText.textContent=db.toFixed(1)+' dB'; }
    // モバイル: ノイズフロア追従型のゲート（環境に応じて自動チューニング）
    let gateDbEff = gateThreshold;
    if(IS_MOBILE && !IS_MOBILE_PCPIPE){
        try{
            const alpha = 0.02; // ノイズフロアのEMA係数（遅め）
            // 修正: フロアは「静かな時のみ」更新して、歌声に追随して上がらないようにする
            // 条件: 現在dBがフロア+3dB以下（明らかに無音〜小音量域）
            if(db <= _mobileNoiseDb + 3){
                _mobileNoiseDb = (1-alpha)*_mobileNoiseDb + alpha*db;
            }
            // フロア過小評価を避けるためのクランプ（最低-80dB、最高-20dB程度）
            if(!Number.isFinite(_mobileNoiseDb)) _mobileNoiseDb = -60;
            _mobileNoiseDb = Math.max(-80, Math.min(-20, _mobileNoiseDb));
            const margin = 8; // フロア+8dB 以上のみ有声扱い（やや緩め）
            gateDbEff = Math.max(gateThreshold, _mobileNoiseDb + margin);
        }catch(_){ gateDbEff = gateThreshold; }
    }
    // 入力が極端に小さい状態が続く場合は自己回復を試みる（デバイス切替/一時無効化対策）
    try{
        if(db < -55){ _micSilentFrames++; } else { _micSilentFrames=0; }
        const thresholdFrames = Math.max(analysisRate*2, 60); // 約2秒
        if(_micSilentFrames>thresholdFrames && !_micReinitInFlight){
            _micReinitInFlight=true; _micSilentFrames=0;
            setTimeout(async()=>{ try{ await initMic(false).catch(()=>{}); }finally{ _micReinitInFlight=false; } }, 0);
        }
    }catch(_){ }
    // ヒステリシス: 一度開いたら少し下がるまで閉めない（オンセットのバタつき抑制）
    if(typeof analyzePitch._gateOpen==='undefined') analyzePitch._gateOpen=false;
    if(typeof analyzePitch._gateOpenedAt==='undefined') analyzePitch._gateOpenedAt=0;
    let gateToUse = gateDbEff;
    if(IS_MOBILE && !IS_MOBILE_PCPIPE){ if(analyzePitch._gateOpen){ gateToUse = gateDbEff - 3; } }
    if(db<gateToUse) {
        // 完全フラットが続く場合はデバイス不具合の可能性 → 再初期化を早めに仕掛ける
        let flat=true; for(let i=0;i<micData.length;i++){ if(micData[i]!==0){ flat=false; break; } }
        if(flat){
            _micFlatFrames++;
            const now=performance.now?performance.now():Date.now();
            if(_micFlatFrames>30 && now - _micLastReinitAt > 1500){ // 約0.6秒
                _micLastReinitAt=now; _micFlatFrames=0; setTimeout(()=>{ try{ initMic(false).catch(()=>{}); }catch(_){ } }, 0);
            }
        } else { _micFlatFrames=0; }
        analyzePitch._gateOpen=false;
        return;
    }
    if(!analyzePitch._gateOpen){
        // ゲートが今開いた（オンセット）
        analyzePitch._gateOpenedAt = nowMs;
    }
    analyzePitch._gateOpen=true;
    const onsetActive = (IS_MOBILE && !IS_MOBILE_PCPIPE) && (nowMs - (analyzePitch._gateOpenedAt||0) <= 180);

    // --- New YIN pipeline (optional) ---
    try{
        if(USE_YIN_TRACKER && _yinTracker && micData){
            const r = _yinTracker.process(micData);
            let rawFreq = (r && r.freq) || 0;
            let rawConf = (r && r.conf) || 0;
            // モバイル向け: 低信頼点は強めに抑制し、短時間のドロップアウトは補完
            const confMin = (IS_MOBILE && !IS_MOBILE_PCPIPE) ? Math.max(0.50, PITCH_CONF_MIN) : PITCH_CONF_MIN;
            // 追加: 軽量SHSで f/2, f, 2f を評価しオクターブ誤認を抑止（rawFreq>0 のとき）
            if(rawFreq>0){
                // モバイル: 極端なオクターブ飛び（±3oct=36半音以上）は短時間拒否（瞬発ノイズ対策）
                if(typeof analyzePitch._lastAcceptedFreqDisp==='undefined') analyzePitch._lastAcceptedFreqDisp=0;
                if(typeof analyzePitch._lastAcceptedRawHist==='undefined') analyzePitch._lastAcceptedRawHist=0;
                if(typeof analyzePitch._extremeFramesDisp==='undefined') analyzePitch._extremeFramesDisp=0;
                if(typeof analyzePitch._extremeFramesHist==='undefined') analyzePitch._extremeFramesHist=0;
                const isExtremeJump = (fNew, fRef)=>{
                    try{ if(!(fNew>0 && fRef>0)) return false; const dSemi=Math.abs(12*Math.log2(fNew/fRef)); return dSemi>=36; }catch(_){ return false; }
                };
                try{
                    const sr = audioCtx? audioCtx.sampleRate: 44100;
                    // 直接 micData を使用（既に getFloatTimeDomainData 済み）
                    const frame = micData;
                    function goertzelPower(arr, sr, f){ if(!(f>0) || f>=sr*0.5) return 0; const w=2*Math.PI*f/sr; const c=Math.cos(w); const coeff=2*c; let s0=0,s1=0,s2=0; for(let n=0;n<arr.length;n++){ s0 = arr[n] + coeff*s1 - s2; s2=s1; s1=s0; } return Math.max(0, s1*s1 + s2*s2 - coeff*s1*s2); }
                    function shsScore(arr, sr, f0, K){ if(!(f0>0)) return 0; const kMax=Math.max(1, K|0); let sum=0, used=0; for(let k=1;k<=kMax;k++){ const fk=f0*k; if(fk>=sr*0.5) break; const p=goertzelPower(arr, sr, fk); sum += (p>0? Math.sqrt(p):0) * (1/k); used++; } return used? sum/used: 0; }
                    const base = rawFreq; const half=base*0.5; const dbl=base*2;
                    let sBase = shsScore(frame, sr, base, 5);
                    let sHalf = shsScore(frame, sr, half, 5);
                    let sDbl  = shsScore(frame, sr, Math.min(dbl, sr*0.49), 5);
                    // モバイル: 再生線上のガイドMIDIに近いオクターブを微優遇（音程モードやゴーストにも対応）
                    if(IS_MOBILE && !IS_MOBILE_PCPIPE){
                        try{
                            let guideMidiAtPlayhead = null;
                            const tRef = playbackPosition - getPitchVisOffsetSec();
                            if(!isPitchOnlyMode){
                                const tr=currentTracks[melodyTrackIndex];
                                if(tr&&tr.notes&&tr.notes.length){ const nn=tr.notes.find(n=> tRef>=n.time && tRef<=n.time+n.duration) || tr.notes.find(n=> n.time>tRef) || tr.notes[tr.notes.length-1]; if(nn) guideMidiAtPlayhead = nn.midi|0; }
                            }
                            if(guideMidiAtPlayhead==null && Array.isArray(midiGhostNotes) && midiGhostNotes.length){
                                const g = midiGhostNotes.find(n=> tRef>=n.time && tRef<=n.time+n.duration) || null; if(g) guideMidiAtPlayhead = g.midi|0;
                            }
                            if(guideMidiAtPlayhead!=null){
                                const mGuide = guideMidiAtPlayhead;
                                function octaveBias(f, score){ if(!(f>0) || score<=0) return score; const m = 69+12*Math.log2(f/ A4Frequency); let mAdj=m; while(mAdj - mGuide > 6) mAdj -= 12; while(mGuide - mAdj > 6) mAdj += 12; const d=Math.abs(mAdj - mGuide); const w = 1 + Math.max(0, 0.15 * Math.max(0, (6 - d))/6); return score * w; }
                                sHalf = octaveBias(half, sHalf);
                                sBase = octaveBias(base, sBase);
                                sDbl  = octaveBias(dbl,  sDbl);
                            }
                        }catch(_){ }
                    }
                    // 直近の連続性バイアス
                    let wHalf=0.92, wBase=1.00, wDbl=1.03; // PC相当の重み
                    if(onsetActive){ wHalf*=0.8; wDbl*=0.95; } // オンセット中はf/2選択をさらに抑制
                    if(lastMicFreq>0){
                        const dSemi = Math.abs(12*Math.log2(base/lastMicFreq));
                        if(dSemi<=3){ wBase*=1.05; wDbl*=0.98; }
                    }
                    // 高音域は f/2 誤判定が出やすい → half をさらに弱める
                    const mBase = 69+12*Math.log2(base/ A4Frequency);
                    if(mBase>=80){ wHalf*=0.85; wDbl*=1.05; }
                    let rHalf = sHalf*wHalf, rBase=sBase*wBase, rDbl=sDbl*wDbl;
                    let pick=base, bestS=sBase;
                    if(half>30 && rHalf>rBase && rHalf>rDbl){ pick=half; bestS=sHalf; }
                    if(rDbl>bestS && rDbl>rHalf){ pick=dbl; bestS=sDbl; }
                    // 僅差時は上側優先（上昇追従性を確保）
                    if(pick===half){
                        const alt=Math.max(rBase,rDbl);
                        const th = onsetActive? 1.25 : 1.10; // オンセット時はより厳しく
                        if(rHalf < alt*th){ pick=(rDbl>=rBase? dbl: base); bestS=(rDbl>=rBase? sDbl: sBase); }
                    }
                    // rawFreq と信頼度に反映（相対優位でブースト）
                    const second = (pick===base)? Math.max(sHalf, sDbl) : (pick===half? Math.max(sBase, sDbl): Math.max(sBase, sHalf));
                    const shsRel = bestS>0? Math.min(1, bestS / Math.max(1e-9, second*1.05)) : 0;
                    rawFreq = pick; rawConf = Math.max(rawConf, 0.35*rawConf + 0.65*Math.min(1, shsRel));

                    // 追加: 候補系列（half, base, dbl）をViterbiで安定化（ごく短遅延、モバイル限定）
                    if(IS_MOBILE && !IS_MOBILE_PCPIPE) try{
                        const cands = [];
                        const costs = [];
                        // コストは負の相対スコア + 連続性ペナルティ
                        function pushCand(f, score){ if(!(f>0)) return; cands.push(f); const inv = 1/Math.max(1e-9, score); let pen=0; if(lastMicFreq>0){ const dSemi=Math.abs(12*Math.log2(f/lastMicFreq)); pen = 0.06*dSemi + (Math.min(Math.abs(dSemi-12),Math.abs(dSemi-24))<0.7? 0.35: 0); } costs.push(inv+pen); }
                        pushCand(half, Math.max(1e-9, rHalf));
                        pushCand(base, Math.max(1e-9, rBase));
                        pushCand(dbl,  Math.max(1e-9, rDbl));
                        yinVitFrames.push({ cands, costs, time: playbackPosition });
                        if(yinVitFrames.length>YIN_VIT_MAX) yinVitFrames.shift();
                        const runVit=(frames, lag)=>{
                            const N=frames.length; if(N===0) return null; const out=N-1-Math.max(0,lag|0); if(out<0) return null;
                            const dp=frames.map(f=>new Array(f.cands.length).fill(Infinity));
                            const pv=frames.map(f=>new Array(f.cands.length).fill(-1));
                            for(let j=0;j<frames[0].cands.length;j++){ dp[0][j]=frames[0].costs[j]; }
                            const baseBeta=0.08, baseOct=1.15; // ロールバック（安定実績値）
                            const beta=baseBeta, octPenalty = onsetActive? 1.50 : baseOct; // オンセットは強く抑制
                            for(let i=1;i<N;i++){
                                const a=frames[i-1], b=frames[i];
                                for(let j=0;j<b.cands.length;j++){
                                    const f2=b.cands[j]; const lc=b.costs[j]; let best=Infinity,bk=-1;
                                    for(let k=0;k<a.cands.length;k++){
                                        const f1=a.cands[k]; let trans=0; if(f1===0||f2===0) trans=0.18; else { const d= Math.abs(12*Math.log2(f2/f1)); const nearOct=Math.min(Math.abs(d-12),Math.abs(d-24)); trans = beta*d + (nearOct<0.6? octPenalty: 0); if(d<=2.5) trans -= 0.03; }
                                        const cost=dp[i-1][k]+lc+trans; if(cost<best){ best=cost; bk=k; }
                                    }
                                    dp[i][j]=best; pv[i][j]=bk;
                                }
                            }
                            let lastJ=0; { let mv=Infinity; const last=dp[N-1]; for(let j=0;j<last.length;j++){ if(last[j]<mv){ mv=last[j]; lastJ=j; } } }
                            const path=new Array(N).fill(0); path[N-1]=lastJ; for(let i=N-1;i>0;i--){ const k=pv[i][path[i]]; path[i-1]=(k>=0? k: 0); }
                            const j=path[out]; return { idx: out, freq: frames[out].cands[j], time: frames[out].time };
                        };
                        const vit = runVit(yinVitFrames, YIN_VIT_LAG);
                        if(vit && vit.freq>0){ rawFreq = vit.freq; }
                    }catch(_){ }
                }catch(_){ /* ignore SHS fallback */ }
            }
            if(rawFreq>0){
                // 低信頼はスムージング/赤丸更新をスキップ（前回値を保持して見た目を安定化）
                const liveMin = (IS_MOBILE && !IS_MOBILE_PCPIPE) ? Math.max(0.38, Math.min(confMin, 0.50)) : confMin; // PCパイプライン時はPCと同一
                if(rawConf >= confMin){
                    const sm = _pitchSmootherMod? _pitchSmootherMod.push(rawFreq, rawConf): rawFreq;
                    // 表示用（赤点/滑らかな追従）の極端ジャンプ抑制（モバイルのみ）
                    let acceptDisp = true;
                    if(IS_MOBILE){
                        const ref = lastMicFreq>0? lastMicFreq : (analyzePitch._lastAcceptedFreqDisp||0);
                        if(isExtremeJump(sm, ref)){
                            analyzePitch._extremeFramesDisp = (analyzePitch._extremeFramesDisp|0)+1;
                            if(analyzePitch._extremeFramesDisp < 2){ acceptDisp=false; }
                        } else { analyzePitch._extremeFramesDisp=0; }
                    }
                    if(acceptDisp){
                        lastMicFreq = sm; _mobileHoldRemain = (IS_MOBILE && !IS_MOBILE_PCPIPE)? (onsetActive? 2: 1) : 0; _mobileHoldFreq = sm;
                        analyzePitch._lastAcceptedFreqDisp = lastMicFreq;
                        lastMicMidi = 69 + 12*Math.log2(Math.max(1e-9,lastMicFreq)/A4Frequency);
                    } else {
                        // ホールドして見た目の突発を抑制
                        if((IS_MOBILE && !IS_MOBILE_PCPIPE) && _mobileHoldRemain>0 && _mobileHoldFreq>0){
                            _mobileHoldRemain--; lastMicFreq=_mobileHoldFreq; lastMicMidi = 69 + 12*Math.log2(lastMicFreq/A4Frequency);
                        }
                    }
                }else if(IS_MOBILE){
                    // 履歴には残さないが、赤丸用にはやや低信頼でも更新して可視性を確保
                    if(rawConf >= liveMin){
                        const sm = _pitchSmootherMod? _pitchSmootherMod.push(rawFreq, rawConf): rawFreq;
                        let acceptDisp = true;
                        const ref = lastMicFreq>0? lastMicFreq : (analyzePitch._lastAcceptedFreqDisp||0);
                        if(IS_MOBILE && isExtremeJump(sm, ref)){
                            analyzePitch._extremeFramesDisp = (analyzePitch._extremeFramesDisp|0)+1;
                            if(analyzePitch._extremeFramesDisp < 2){ acceptDisp=false; }
                        } else { analyzePitch._extremeFramesDisp=0; }
                        if(acceptDisp){
                            lastMicFreq = sm; _mobileHoldRemain = ((IS_MOBILE && !IS_MOBILE_PCPIPE) && onsetActive? 1: 0); _mobileHoldFreq = sm;
                            analyzePitch._lastAcceptedFreqDisp = lastMicFreq;
                            lastMicMidi = 69 + 12*Math.log2(Math.max(1e-9,lastMicFreq)/A4Frequency);
                        }
                    }
                    // 直近の有声音を 2 フレームだけ保持（ギザギザ抑制）
                    if(_mobileHoldRemain>0 && _mobileHoldFreq>0){
                        _mobileHoldRemain--; lastMicFreq=_mobileHoldFreq; lastMicMidi = 69 + 12*Math.log2(lastMicFreq/A4Frequency);
                    }
                }
                if(!isCalibrating && rawConf >= confMin){
                    const vOff = getPitchVisOffsetSec();
                    const recTime = playbackPosition - vOff;
                    // 履歴にはスムージング前の生周波数を保存（描画側で一貫して再計算）
                    // 高信頼はモバイルでも常時記録（間引きしない）が、極端ジャンプは短時間拒否
                    let acceptHist = true;
                    if(IS_MOBILE){
                        const refH = analyzePitch._lastAcceptedRawHist||0;
                        if(isExtremeJump(rawFreq, refH)){
                            analyzePitch._extremeFramesHist = (analyzePitch._extremeFramesHist|0)+1;
                            if(analyzePitch._extremeFramesHist < 2){ acceptHist=false; }
                        } else { analyzePitch._extremeFramesHist=0; }
                    }
                    if(!IS_MOBILE || IS_MOBILE_PCPIPE || true){
                        if(acceptHist){
                            // 診断: 無効値検出
                            if(!(rawFreq>0) || !Number.isFinite(rawFreq) || rawFreq>12000){
                                __diagLog('hist-push-invalid', {rawFreq, rawConf, recTime, vOff, A4:A4Frequency});
                            }
                            pitchHistory.push({ time: recTime, visOff: vOff, freq: rawFreq, conf: rawConf, sid: scoreSessionId });
                            analyzePitch._lastAcceptedRawHist = rawFreq;
                            if(pitchHistory.length>2000) pitchHistory.shift();
                            if(IS_MOBILE) _mobileLowDecim = 0;
                        }
                    }
                } else if(!isCalibrating && (IS_MOBILE && !IS_MOBILE_PCPIPE)){
                    // 低信頼だが liveMin 以上: 線の連続性確保のため軽量に履歴へ記録（さらに間引き）
                    const liveMin = Math.max(0.38, Math.min(confMin, 0.50));
                    if(rawConf >= liveMin){
                        const vOff = getPitchVisOffsetSec();
                        const recTime = playbackPosition - vOff;
                        // さらに間引き: シンプルなカウンタで3〜4フレームに1回程度
                        _mobileLowDecim = ((_mobileLowDecim|0) + 1);
                        if((_mobileLowDecim % 3)===0){
                            // 低信頼でも極端ジャンプは記録しない（線の突発スパイク防止）
                            let acceptHistL = true;
                            const refH = analyzePitch._lastAcceptedRawHist||0;
                            if(isExtremeJump(rawFreq, refH)){
                                analyzePitch._extremeFramesHist = (analyzePitch._extremeFramesHist|0)+1;
                                if(analyzePitch._extremeFramesHist < 2){ acceptHistL=false; }
                            } else { analyzePitch._extremeFramesHist=0; }
                            if(acceptHistL){
                                if(!(rawFreq>0) || !Number.isFinite(rawFreq) || rawFreq>12000){
                                    __diagLog('hist-push-invalid-low', {rawFreq, rawConf, recTime, vOff, A4:A4Frequency});
                                }
                                pitchHistory.push({ time: recTime, visOff: vOff, freq: rawFreq, conf: rawConf, sid: scoreSessionId });
                                analyzePitch._lastAcceptedRawHist = rawFreq;
                                if(pitchHistory.length>2000) pitchHistory.shift();
                            }
                        }
                    }
                }
            }
            if(!isPlaying) drawChart();
            return; // YINパスで完了（旧処理へは行かない）
        }
    }catch(_){ /* fallback blocked intentionally to keep pipeline clean */ }

    const srLive = audioCtx? audioCtx.sampleRate: 44100;
    const W = micAnalyser.fftSize; // 2048 程度
    // Hann 窓
    const hann=new Float32Array(W); for(let n=0;n<W;n++) hann[n]=0.5*(1-Math.cos(2*Math.PI*n/(W-1)));
    // DC 除去 + 窓掛け
    let mean=0; for(let i=0;i<W;i++) mean+=micData[i]; mean/=W; const frame=new Float32Array(W);
    for(let i=0;i<W;i++){ frame[i]=(micData[i]-mean)*hann[i]; }
    // 探索範囲（65..1200Hz 相当）。のちに lastMicFreq とガイドノートで緩くバイアス
    // 高音域（D8≈4.7kHz, E8≈5.2kHz）まで拾えるように上限fmaxLiveを拡張
    const fmaxLive = 6000; // Hz（端末SR48kで Nyquist=24k の十分内側）
    const tauMin = Math.max(2, Math.floor(srLive/Math.min(fmaxLive, srLive*0.49)));
    const tauMax = Math.max(tauMin+2, Math.min(Math.floor(srLive/65), Math.floor(W*0.9)));
    // 連続性制約（±2半音）
    // 連続性制約: 基本は±6半音だが、相関が弱いフレームではさらに広げ、強いときは少し狭める
    // 後段でbestRが決まるので、まずはデフォルトの±6半音を使い、あとで再計算の可能性あり
    let SEMI_NARROW = Math.pow(2, 6/12);
    let localTauMin=tauMin, localTauMax=tauMax;
    if(_forceGlobalSearch>0){
        _forceGlobalSearch = Math.max(0, _forceGlobalSearch-1); // 一時的に全域
    } else if(lastMicFreq>0){
        const tau0=srLive/lastMicFreq; localTauMin=Math.max(tauMin, Math.floor(tau0/SEMI_NARROW)); localTauMax=Math.min(tauMax, Math.ceil(tau0*SEMI_NARROW));
        const pad=2; localTauMin=Math.max(tauMin, localTauMin-pad); localTauMax=Math.min(tauMax, localTauMax+pad);
    }
    // （注意）探索範囲の過度な狭窄はハンチングの原因 → 緩やかな連続性のみ適用
    // NACF 最大探索（粗→微）
    let bestTau=-1, bestR=-1;
    // 小tau帯（高周波）では刻みを細かくし、取りこぼしを防ぐ
    const coarseStep = (localTauMin <= 32 ? 1 : 2);
    // ユーティリティ: 指定範囲で粗探索
    function coarseSearch(tMin, tMax){
        let bTau=-1, bR=-1;
        for(let tau=tMin; tau<=tMax; tau+=coarseStep){
            let r=0,e0=0,e1=0; const N=W-tau;
            for(let n=0;n<N;n++){ const a=frame[n], b=frame[n+tau]; r+=a*b; e0+=a*a; e1+=b*b; }
            const den=Math.sqrt(e0*e1)+1e-12; const nacf=r/den; if(nacf>bR){ bR=nacf; bTau=tau; }
        }
        return {bTau,bR};
    }
    // まずは局所探索
    ({bTau:bestTau, bR:bestR} = coarseSearch(localTauMin, localTauMax));
    // 相関が弱いフレームは再取得のため全域で再探索（固着判定ではなく、その瞬間の信頼度で判断）
    const REACQUIRE_R_THRESH = 0.20;
    if(bestR < REACQUIRE_R_THRESH){
        const resAll = coarseSearch(tauMin, tauMax);
        // 十分改善するなら全域結果を採用
        if(resAll.bR > bestR + 0.02){ bestTau = resAll.bTau; bestR = resAll.bR; }
    }
    // 境界に張り付いた場合は全域で再探索（大きな音程移動に対応）
    if(bestTau===localTauMin || bestTau===localTauMax){
        const res = coarseSearch(tauMin, tauMax);
        if(res.bR > bestR + 1e-6){ bestTau = res.bTau; bestR = res.bR; }
    }
    if(bestTau>0){
        // bestRに応じて窓幅を調整（弱い: ±9半音、強い: ±4半音）し、必要なら再度局所微調整
        if(bestR>0){
            const narrow = Math.pow(2, 4/12), wide = Math.pow(2, 9/12);
            const t = Math.max(0, Math.min(1, (bestR-0.2)/(0.8-0.2))); // R=0.2→0, R=0.8→1
            const target = wide * Math.pow(narrow/wide, t); // R低→wide, R高→narrow
            if(Math.abs(target - SEMI_NARROW) > 1e-6 && lastMicFreq>0){
                SEMI_NARROW = target;
                let lMin=tauMin, lMax=tauMax;
                const tau0=srLive/lastMicFreq; lMin=Math.max(tauMin, Math.floor(tau0/SEMI_NARROW)); lMax=Math.min(tauMax, Math.ceil(tau0*SEMI_NARROW));
                const pad=2; lMin=Math.max(tauMin, lMin-pad); lMax=Math.min(tauMax, lMax+pad);
                const resLoc = coarseSearch(lMin, lMax);
                if(resLoc.bR > bestR + 1e-6){ bestTau = resLoc.bTau; bestR = resLoc.bR; }
            }
        }
        const t0=Math.max(localTauMin, bestTau-2), t1=Math.min(localTauMax, bestTau+2);
        for(let tau=t0; tau<=t1; tau++){ let r=0,e0=0,e1=0; const N=W-tau; for(let n=0;n<N;n++){ const a=frame[n], b=frame[n+tau]; r+=a*b; e0+=a*a; e1+=b*b; } const den=Math.sqrt(e0*e1)+1e-12; const nacf=r/den; if(nacf>bestR){ bestR=nacf; bestTau=tau; } }
    }
    // パラボリック補間
    let estTau=bestTau; if(bestTau>Math.max(tauMin, localTauMin) && bestTau<Math.min(tauMax, localTauMax)){
        const fAt=(t)=>{ let r=0,e0=0,e1=0; const N=W-t; for(let n=0;n<N;n++){ const a=frame[n], b=frame[n+t]; r+=a*b; e0+=a*a; e1+=b*b; } return r/(Math.sqrt(e0*e1)+1e-12); };
        const ym1=fAt(bestTau-1), y0=bestR, yp1=fAt(bestTau+1); const denom=(ym1-2*y0+yp1); if(Math.abs(denom)>1e-9){ const delta=0.5*(ym1-yp1)/denom; if(Math.abs(delta)<=1) estTau=bestTau+delta; }
    }
    const NACF_THRESH=0.28; // わずかに緩める
    let freq=(bestR>=NACF_THRESH && estTau>0)? (srLive/estTau) : 0;
    // 全域探索モードでのSHS粗サーチ（固着検出では起動しない）
    function shsReacquire(frameArr, sr){
    const fMin=80, fMax=fmaxLive; const bins=128; let bestF=0, bestS=0; const scores=new Float32Array(bins);
        for(let i=0;i<bins;i++){
            const r=i/(bins-1); const f = fMin * Math.pow(fMax/fMin, r);
            const s = shsScore(frameArr, sr, f, 5);
            scores[i]=s; if(s>bestS){ bestS=s; bestF=f; }
        }
        const arr=Array.from(scores).sort((a,b)=>a-b); const med=arr[Math.floor(arr.length/2)]||0; if(bestS>Math.max(1e-9, med*2)) return bestF; return 0;
    }
    if(_forceGlobalSearch>0){
        const fRe = shsReacquire(frame, srLive);
        if(fRe>0) freq=fRe;
    }
    // 軽量SHSで f/2, f, 2f の中から最良を選択（オクターブ誤認の抑制）
    function goertzelPower(frameArr, sr, f){
        if(!(f>0) || f>=sr*0.5) return 0; const w=2*Math.PI*f/sr; const c=Math.cos(w); const coeff=2*c; let s0=0,s1=0,s2=0; for(let n=0;n<frameArr.length;n++){ s0 = frameArr[n] + coeff*s1 - s2; s2=s1; s1=s0; } return Math.max(0, s1*s1 + s2*s2 - coeff*s1*s2);
    }
    function shsScore(frameArr, sr, f0, K){ if(!(f0>0)) return 0; const kMax=Math.max(1, K|0); let sum=0, used=0; for(let k=1;k<=kMax;k++){ const fk=f0*k; if(fk>=sr*0.5) break; const p=goertzelPower(frameArr, sr, fk); sum += (p>0? Math.sqrt(p):0) * (1/k); used++; } return used? sum/used: 0; }
    let conf=0.0;
    // --- ライブViterbi候補系列の更新（freq確定の前段で行う） ---
    // cFreqs, cCosts はこの上のブロックで構築される（無声音も含む）
    // ここでは現フレームの候補数を過度に増やさないため、コストの低い上位のみ採用
    try{
        if(Array.isArray(cFreqs) && Array.isArray(cCosts) && cFreqs.length===cCosts.length){
            const idx = Array.from({length:cFreqs.length}, (_,i)=>i).sort((a,b)=> cCosts[a]-cCosts[b]);
            const keep = Math.min(5, idx.length);
            const selCands = new Array(keep);
            const selCosts = new Array(keep);
            for(let ii=0; ii<keep; ii++){ selCands[ii]=cFreqs[idx[ii]]; selCosts[ii]=cCosts[idx[ii]]; }
            liveVitFrames.push({ cands: selCands, costs: selCosts, time: playbackPosition });
            if(liveVitFrames.length > LIVE_VIT_MAX) liveVitFrames.shift();
            // 短遅延Viterbiで安定な周波数を選ぶ
            const vit = (function runLiveViterbi(frames, lag){
                try{
                    const N = frames.length; if(N===0) return null;
                    const outIndex = N - 1 - Math.max(0, lag|0);
                    if(outIndex < 0) return null; // まだ遅延分が溜まっていない
                    // DP配列
                    const dp = frames.map(f => new Array(f.cands.length).fill(Infinity));
                    const pv = frames.map(f => new Array(f.cands.length).fill(-1));
                    // 初期化
                    const f0 = frames[0]; for(let j=0;j<f0.cands.length;j++){ dp[0][j] = f0.costs[j]; }
                    const baseBeta = 0.10; const baseOct = 1.25;
                    const beta = onsetActive? baseBeta : baseBeta;
                    const octPenalty = onsetActive? 1.45 : baseOct;
                    for(let i=1;i<N;i++){
                        const fi = frames[i]; const fi_1 = frames[i-1];
                        for(let j=0;j<fi.cands.length;j++){
                            const f2 = fi.cands[j]; const lc = fi.costs[j];
                            let best=Infinity, bestk=-1;
                            for(let k=0;k<fi_1.cands.length;k++){
                                const f1 = fi_1.cands[k];
                                let trans=0;
                                if(f1===0 || f2===0){ trans = 0.26; }
                                else {
                                    const dSemi = Math.abs(12*Math.log2(f2/f1));
                                    const nearOct = Math.min(Math.abs(dSemi-12), Math.abs(dSemi-24));
                                    trans = beta*dSemi + (nearOct<0.7? octPenalty: 0);
                                    if(dSemi<=3) trans -= 0.04; else if(dSemi<12) trans += 0.03;
                                }
                                const cost = dp[i-1][k] + lc + trans;
                                if(cost<best){ best=cost; bestk=k; }
                            }
                            dp[i][j]=best; pv[i][j]=bestk;
                        }
                    }
                    // 末尾から最小コストのパスを復元
                    let lastJ=0; { let minv=Infinity; const last=dp[N-1]; for(let j=0;j<last.length;j++){ if(last[j]<minv){ minv=last[j]; lastJ=j; } } }
                    const pathIdx = new Array(N).fill(0); pathIdx[N-1]=lastJ; for(let i=N-1;i>0;i--){ const k=pv[i][pathIdx[i]]; pathIdx[i-1] = (k>=0? k: 0); }
                    const selJ = pathIdx[outIndex];
                    return { idx: outIndex, freq: frames[outIndex].cands[selJ], time: frames[outIndex].time };
                }catch(_){ return null; }
            })(liveVitFrames, LIVE_VIT_LAG);
            if(vit && vit.freq>0){ freq = vit.freq; var __vitTimeOverride = vit.time; }
        }
    }catch(_){ }

    if(freq>0){
        const base = freq; const half=base*0.5; const dbl=base*2;
        const sBase = shsScore(frame, srLive, base, 5);
        const sHalf = shsScore(frame, srLive, half, 5);
        const sDbl  = shsScore(frame, srLive, Math.min(dbl, srLive*0.49), 5);
    // 下オクターブ（f/2）に流れにくくし、上オクターブ（2f）は近接時に取りやすくする重み付け
    let wHalf=0.88, wBase=1.00, wDbl=1.12;
        // 直近のトレンドで弱いバイアス（上昇→高い候補に+、下降→低い候補に+）。過剰にしない
        let trend=0; try{
            if(pitchSmoothBuf.length>=4){
                const a=pitchSmoothBuf[pitchSmoothBuf.length-4];
                const b=pitchSmoothBuf[pitchSmoothBuf.length-1];
                trend = Math.max(-1, Math.min(1, Math.sign(b-a)));
            }
        }catch(_){ }
        const trendBoost = 1 + 0.05*trend;    // 上昇時 1.05, 下降時 0.95（高低で逆に適用）
        // 直近の出力MIDIとの連続性（±6半音以内を優遇、±6超は減点）
        function contMul(m){
            try{
                if(!(lastMicMidi>0)) return 1.0;
                let mm=m; const exp=lastMicMidi;
                while(mm-exp>6) mm-=12; while(exp-mm>6) mm+=12;
                const d=Math.abs(mm-exp);
                if(d<=3) return 1.05; // 近接は微優遇
                if(d<=6) return 1.00; // 通常
                return 0.85;           // 1オクターブ級に離れる候補は減点
            }catch(_){ return 1.0; }
        }
        const mHalf = 69+12*Math.log2(Math.max(1e-9,half)/A4Frequency);
        const mBase = 69+12*Math.log2(Math.max(1e-9,base)/A4Frequency);
        const mDbl  = 69+12*Math.log2(Math.max(1e-9,dbl)/A4Frequency);
        // 高音域では下オクターブ（f/2）への誤判定を強めに抑制し、2f をわずかに優遇
        if(mBase>=80){ // だいたい G#5 以上
            wHalf *= 0.85; // より下を取りにくく
            wDbl  *= 1.05;
        }

        let rHalf = sHalf * wHalf * (trend<0? 1.04:1.00) * contMul(mHalf); // 下降傾向では半分側を微優遇
        let rBase = sBase * wBase * contMul(mBase);
        let rDbl  = sDbl  * wDbl  * (trend>0? trendBoost:1.00) * contMul(mDbl); // 上昇傾向では2f側を微優遇

        let pick=base, bestS=sBase, bestRW=rBase;
        if(half>30 && rHalf>bestRW){ pick=half; bestS=sHalf; bestRW=rHalf; }
        if(rDbl>bestRW){ pick=dbl; bestS=sDbl; bestRW=rDbl; }
        // ヒステリシス: 上昇傾向で pick が half になっても、僅差なら上側（base/dbl）を優先
        if(trend>0 && pick===half){
            const alt = Math.max(rBase, rDbl);
            if(rHalf < alt * 1.12){ // 12%以内の僅差なら高い方へ
                if(rDbl>=rBase){ pick=dbl; bestS=sDbl; bestRW=rDbl; }
                else { pick=base; bestS=sBase; bestRW=rBase; }
            }
        }
        // SHSの相対優位を confidence に反映（生スコアで比較）
        const second = (pick===base)? Math.max(sHalf, sDbl) : (pick===half? Math.max(sBase, sDbl): Math.max(sBase, sHalf));
        const shsRel = bestS>0? Math.min(1, bestS / Math.max(1e-9, second*1.05)) : 0; // 1.05でわずかに甘め
        conf = Math.max(0, Math.min(1, 0.65*bestR + 0.35*shsRel));
        freq = pick;
    }
    if(freq<=0){ if(_forceGlobalSearch<=0 && lastMicFreq>0) freq=lastMicFreq; }
    if(freq>0){
        // スムージング（移動平均 + メディアン + デッドゾーン + 最大変化制限）
        pitchSmoothBuf.push(freq); if(pitchSmoothBuf.length>PITCH_SMOOTH_WINDOW) pitchSmoothBuf.shift();
        const avg = pitchSmoothBuf.reduce((a,b)=>a+b,0)/pitchSmoothBuf.length;
        const med = [...pitchSmoothBuf].sort((a,b)=>a-b)[Math.floor(pitchSmoothBuf.length/2)];
        // 平均とメディアンをブレンド（ロバスト化）
        const fused = 0.6*med + 0.4*avg;
        // 信頼度に応じてデッドゾーン/最大変化量を自動調整
        function lerp(a,b,t){ return a + (b-a)*Math.max(0,Math.min(1,t)); }
    const DEAD_CENTS = lerp(10, 3, conf);           // 低信頼→広いデッドゾーン, 高信頼→狭く
    let   MAX_STEP_CENTS = lerp(15, 45, conf);      // 低信頼→小さく, 高信頼→大きく（追従性UP）
        const cents = (lastMicFreq>0)? 1200*Math.log2(fused/lastMicFreq) : 0;
        let smoothed = (lastMicFreq>0 && Math.abs(cents)<DEAD_CENTS)? lastMicFreq : fused;
        // 1フレーム最大変化量（セーフティ）
        if(lastMicFreq>0){
            // 高信頼かつ急激な変化（> 半音）を検出したら一時的にさらに上限を緩めて取り逃しを防ぐ
            const absC = Math.abs(cents);
            if(conf>0.7 && absC>100){
                // 最大で±2半音まで即時追従を許容
                MAX_STEP_CENTS = Math.max(MAX_STEP_CENTS, Math.min(200, absC*1.2));
            }
            const maxStep = lastMicFreq * Math.pow(2, MAX_STEP_CENTS/1200) - lastMicFreq;
            const diff = smoothed - lastMicFreq;
            if(Math.abs(diff) > Math.abs(maxStep)) smoothed = lastMicFreq + Math.sign(diff)*Math.abs(maxStep);
        }
        // 固着判定は削除（早いパッセージでの追随を優先）
        // ライブ値の更新とオプションのガイド吸着（±6半音）
        lastMicFreq = smoothed;
        let liveMidi = 69 + 12*Math.log2(Math.max(1e-9,lastMicFreq)/A4Frequency);
        // ガイド吸着（メロディノートへ近接させる補正）は撤廃
        lastMicMidi = liveMidi;
    // 表示用・統計用のセント誤差とピッチクラス
    let dCentsForDot = null; // ガイドに対するセント偏差（±600c折畳み）
    let pcForDot = null;     // ピッチクラス 0..11（C=0）
        try{
            // ガイドノートの取得: 1) メロディトラック 2) 練習モードのゴーストノート
            let nn=null;
            const tr=currentTracks[melodyTrackIndex];
            const t = ((typeof __vitTimeOverride==='number')? __vitTimeOverride: playbackPosition) - getPitchVisOffsetSec(); // 記録・保存に用いる時刻
            const T_TOL = 0.12; // 120ms 以内は同一ノートとして扱う（可視化の“合っている扱い”）
            if(tr && tr.notes && tr.notes.length){
                // まずは通常の包含検索
                nn = tr.notes.find(n=> t>=n.time && t<=n.time+n.duration);
                if(!nn){
                    // 前後の最近傍を取得し、時間誤差が閾値内なら最寄りを採用
                    let prev=null, next=null;
                    for(const n of tr.notes){ if(n.time<=t) prev=n; if(n.time>t){ next=n; break; } }
                    let best=null, bd=1e9;
                    if(prev){ const d=Math.min(Math.abs(t-prev.time), Math.abs((prev.time+prev.duration)-t)); if(d<bd){ bd=d; best=prev; } }
                    if(next){ const d=Math.min(Math.abs(t-next.time), Math.abs((next.time+next.duration)-t)); if(d<bd){ bd=d; best=next; } }
                    if(best && bd<=T_TOL) nn=best;
                    // それでも見つからなければ最後のノートをフォールバック
                    if(!nn) nn = next || tr.notes[tr.notes.length-1];
                }
            }
            if(!nn && Array.isArray(midiGhostNotes) && midiGhostNotes.length){
                // 近い時間のゴーストノートを採用（±durationの範囲優先、なければ最近傍、さらに120ms許容）
                let best=null, bd=1e9;
                for(const g of midiGhostNotes){
                    const dCenter = Math.abs(t - (g.time + (g.duration||0)/2));
                    const score = dCenter / Math.max(0.001, g.duration||0.4);
                    if(score < bd){ bd=score; best=g; }
                }
                if(best){
                    const dEdge = Math.min(Math.abs(t-best.time), Math.abs((best.time+(best.duration||0))-t));
                    if(dEdge<=T_TOL || (t>=best.time && t<=best.time+(best.duration||0))) nn = { midi: best.midi, time: best.time, duration: best.duration };
                }
            }
            if(!nn && isPracticing && Array.isArray(practiceExpectedNotes) && practiceExpectedNotes.length){
                // レスポンス用期待ノートから最近傍を採用（練習採点フォールバック）
                let best=null, bd=1e9;
                for(const g of practiceExpectedNotes){
                    const mid = g.time + (g.duration||0)/2;
                    const d = Math.abs(t - mid);
                    if(d<bd){ bd=d; best=g; }
                }
                if(best){
                    const dEdge = Math.min(Math.abs(t-best.time), Math.abs((best.time+(best.duration||0))-t));
                    if(dEdge<=T_TOL || (t>=best.time && t<=best.time+(best.duration||0))) nn = { midi: best.midi, time: best.time, duration: best.duration };
                }
            }
            if(nn){
                    // nn.midi を基準に ±2オクターブ候補から liveMidi に最も近いオクターブを選ぶ
                    let best=nn.midi, bestD=1e9;
                    for(let k=-2;k<=2;k++){
                        const cand=nn.midi + 12*k;
                        const d=Math.abs(cand - liveMidi);
                        if(d<bestD){ bestD=d; best=cand; }
                    }
                    const fTar = midiToFreq(best);
                    let centErr = 1200*Math.log2(Math.max(1e-9,lastMicFreq)/Math.max(1e-9,fTar));
                    centErr = wrapToPm600(centErr);
                    dCentsForDot = centErr;
                    pcForDot = ((nn.midi%12)+12)%12;
                    // 統計を更新（採点中のみ）
                    try{
                        if((isPlaying || isPracticing) && scoreStats && Number.isFinite(centErr)){
                            const bin = scoreStats.bins[pcForDot];
                            bin.count++;
                            scoreStats.total++;
                            bin.sum += centErr;
                            bin.sumAbs += Math.abs(centErr);
                            const tol = toleranceCents||0;
                            if(Math.abs(centErr) <= tol) bin.inTol++; else bin.outTol++;
                            const bias = 5; // 5c 以上を高低傾向としてカウント
                            if(centErr >= bias) bin.sharp++;
                            else if(centErr <= -bias) bin.flat++;
                        }
                    }catch(_){ }
            }
        }catch(_){ /* fall back to liveMidi */ }
        // 詳細統計（音種×オクターブ）更新
        try{
            if((isPlaying || isPracticing) && dCentsForDot!=null && pcForDot!=null){
                const tol = toleranceCents||0; const ok = Math.abs(dCentsForDot) <= tol;
                const mForOct = (69 + 12*Math.log2(Math.max(1e-9,lastMicFreq)/A4Frequency));
                const oct = Math.floor(mForOct/12) - 1; const key = String(oct);
                if(!scoreDetailByOct[key]) scoreDetailByOct[key] = {};
                const cell = (scoreDetailByOct[key][pcForDot] ||= {in:0,out:0,count:0});
                cell.count++; if(ok) cell.in++; else cell.out++;
            }
        }catch(_){ }
        // 視覚化遅延補正: 少し過去側に時刻をずらして保存（スクロール位置でノーツと揃えやすく）
        // キャリブレーション中は赤点を残さない
        if(!isCalibrating){
            const vOff = getPitchVisOffsetSec();
            const recTime = ((typeof __vitTimeOverride==='number')? __vitTimeOverride: playbackPosition) - vOff;
            if(!(lastMicFreq>0) || !Number.isFinite(lastMicFreq) || lastMicFreq>12000){
                __diagLog('live-push-invalid', {lastMicFreq, conf, recTime, vOff, A4:A4Frequency});
            }
            pitchHistory.push({ time: recTime, visOff: vOff, freq: lastMicFreq, conf, sid: scoreSessionId });
            if(pitchHistory.length>2000) pitchHistory.shift();
        }
    }
        if(!isPlaying) drawChart();
}
function zeroCrossFreq(buf,sr){
    let crossings=0; let lastSign=buf[0]>0; for(let i=1;i<buf.length;i++){ const s=buf[i]>0; if(s!==lastSign){ crossings++; lastSign=s; } }
    const freq = (crossings/2)*(sr/buf.length); return freq||-1;
}
function autoCorrelate(buf,sr){ const S=buf.length; let rms=0; for(let i=0;i<S;i++) rms+=buf[i]*buf[i]; rms=Math.sqrt(rms/S); if(rms<0.01) return -1; const end=S/2; let best=0,bestV=0; for(let lag=20;lag<end;lag++){ let sum=0; for(let i=0;i<end;i++) sum+=buf[i]*buf[i+lag]; if(sum>bestV){ bestV=sum; best=lag; } } return best? sr/best:-1; }
// セント差を ±600c に折り畳む（最近傍オクターブへ）
function wrapToPm600(cents){
    const x = ((cents + 600) % 1200 + 1200) % 1200 - 600;
    return x;
}
// ---- Draw ----
function loop(){
    updatePlaybackPositionHybrid();
    const now = performance.now();
    const dt = now - _lastFrameTime; _lastFrameTime = now; _frameAccum += dt; _frameCnt++;
    // ===== Drift (Audio vs Perf) 計測 =====
    // audioCtx.currentTime と performance.now ベースの play 進行差分を継続的に記録し、
    // モバイルずれ原因（描画orスケジューリングorデバイスオーディオ遅延）の切り分け基礎データとする。
    if(audioCtx && isPlaying){
        try{
            const nowPerfSec = now/1000;
            const ctxDt = Math.max(0, audioCtx.currentTime - playbackStartTime);
            const perfDt = Math.max(0, nowPerfSec - playbackStartPerf);
            const driftMs = (perfDt - ctxDt)*1000; // 正: perf の方が先行
            if(!window.__driftStats){
                window.__driftStats = { samples:0, avg:0, max:0, last:0, updated:0 };
            }
            const ds = window.__driftStats;
            ds.samples++;
            // online average
            ds.avg += (driftMs - ds.avg)/ds.samples;
            if(Math.abs(driftMs) > Math.abs(ds.max)) ds.max = driftMs;
            ds.last = driftMs;
            if(!ds.updated || (now - ds.updated) > 500){
                // 500ms 毎にオーバーレイへ反映
                const el = document.getElementById('driftOverlay');
                if(el){
                    el.textContent = `Drift(avg:${ds.avg.toFixed(1)}ms max:${ds.max.toFixed(1)}ms last:${ds.last.toFixed(1)}ms mode:${FORCE_PERF_CLOCK?'PERF':'AUTO'} state:${_driftForceState}`;
                }
                ds.updated = now;
            }
            // ==== 強制判定 (1s に 1 回程度) ====
            if(now - _lastDriftDecisionAt > 1000){
                _lastDriftDecisionAt = now;
                if(FORCE_PERF_CLOCK){
                    // 解除判定: 平均がヒステリシス閾値を十分下回る
                    if(ds.samples>DRIFT_FORCE_SAMPLES && Math.abs(ds.avg) < DRIFT_FORCE_HYST_MS){
                        FORCE_PERF_CLOCK=false; _driftForceState='idle';
                        try{ console.warn('[drift] FORCE_PERF_CLOCK OFF (avg', ds.avg.toFixed(1),'ms)'); }catch(_){ }
                    } else {
                        _driftForceState='forcing';
                    }
                } else {
                    if(ds.samples>DRIFT_FORCE_SAMPLES && Math.abs(ds.avg) > DRIFT_FORCE_AVG_MS){
                        // 一度 armed を挟んでユーザーに数値が跳ねる時間を与える
                        if(_driftForceState!=='armed'){
                            _driftForceState='armed';
                        } else {
                            FORCE_PERF_CLOCK=true; _driftForceState='forcing';
                            try{ console.warn('[drift] FORCE_PERF_CLOCK ON (avg', ds.avg.toFixed(1),'ms)'); }catch(_){ }
                        }
                    } else {
                        _driftForceState='idle';
                    }
                }
            }
        }catch(_){ }
    }
    let doDraw = true;
    if(IS_MOBILE){
        // 60fps 端末で無駄に速いフレームを間引き ( ~28-40fps 目安 )
        // わずかに閾値を上げて描画頻度を抑制し、カクつきを低減
        if(dt < 14){ doDraw = false; }
    }
    if(doDraw){
        drawChart();
        if(IS_MOBILE){
            _frameSkipToggle = !_frameSkipToggle;
            if(!_frameSkipToggle){ setSelectionByPlayhead(); }
        } else {
            setSelectionByPlayhead();
        }
    }
    if(now - _lastPerfLog > 2000){
        try{ const avg = (_frameAccum/_frameCnt).toFixed(1); console.debug('[perf] avgFrame(ms)=',avg,' pos=',playbackPosition.toFixed(3)); }catch(_){ }
        _frameAccum=0; _frameCnt=0; _lastPerfLog=now;
    }
    if(isPlaying) requestAnimationFrame(loop);
}
// LRU 定期チェック (再生ループ駆動)
setInterval(()=>{ maybeRunLru(); },5000);
// 選択状態とヒットテスト用レクト
let noteRectsGlobal=[]; // fallback in case earlier declaration fails
function drawChart(){
    if(!chartCanvas||!ctx) return;
    // 以前: 毎フレーム canvas.width/height を再設定 → レイアウト再計算でカクつき原因
    let w=chartCanvas.width; let h=chartCanvas.height;
    if(!w || !h){
        // 初回レイアウトが未確定で 0 になる場合のフォールバック
        try{ resizeCanvas(); }catch(_){ }
        // まだ 0 の場合は属性として強制設定（ローカル変数だけでは描画バッファが生成されない）
        w = chartCanvas.width; h = chartCanvas.height;
        if(!w){
            const vw = Math.max(0, window.innerWidth||document.documentElement.clientWidth||0);
            const fallbackW = Math.max(320, Math.floor(vw*0.6)||0, 640);
            w = fallbackW;
            chartCanvas.width = w;
            chartCanvas.style.width = w + 'px';
        }
        if(!h){
            let ph = 0;
            try{ const p = chartCanvas.parentElement; ph = p? Math.floor(p.clientHeight || p.getBoundingClientRect().height || 0) : 0; }catch(_){ ph=0; }
            const fallbackH = ph>0? ph: 360;
            h = fallbackH;
            chartCanvas.height = h;
            chartCanvas.style.height = h + 'px';
        }
    }
    ctx.clearRect(0,0,w,h);
    // 可視化遅延補正の現在値（保存時との差分で再配置）
    const curOff = getPitchVisOffsetSec();
    const total=verticalZoom*12; const min=36; const maxDisplay=132; const vmin=min+Math.round((maxDisplay-min-total)*(verticalOffset/100)); const vmax=vmin+total; const pxSemi=h/total; const playX=getPlayX(w); const eff=playbackPosition+timelineOffsetSec;
    // 背景グリッド（白鍵=白、黒鍵=グレー）
    for(let m=vmin;m<=vmax;m++){
        const y=h-(m-vmin+1)*pxSemi;
        ctx.beginPath();
        ctx.moveTo(0,y);
        ctx.lineTo(w,y);
        const pc = ((m%12)+12)%12;
        const isC = pc===0; // Cは太めの目印を維持
        const isNatural = (pc===0||pc===2||pc===4||pc===5||pc===7||pc===9||pc===11);
        // C行はより白く、それ以外は白鍵/黒鍵で濃淡
        ctx.strokeStyle = isC ? '#ffffff' : (isNatural ? '#8c8c8c' : '#3a3a3a');
        ctx.lineWidth = isC ? 2 : 1;
        ctx.stroke();
    }
    // 可視領域時間範囲（余白: 2秒）: x = playX + ((t-eff)*pxPerSec/tempoFactor) を反転
    const visMarginSec = 2.0;
    const visStart=eff - (playX/pxPerSec)*tempoFactor - visMarginSec;
    const visEnd  =eff + ((w-playX)/pxPerSec)*tempoFactor + visMarginSec;

    // 他パートのノーツを控えめに下層へ描画（現在パート以外で showNotes=true）
    try{
        if(Array.isArray(melodyParts) && !isPitchOnlyMode){
            for(let i=0;i<melodyParts.length;i++){
                if(i===currentMelodyPart) continue;
                const p = melodyParts[i];
                if(!p || !p.showNotes) continue;
                const notes = Array.isArray(p.notes)? p.notes: [];
                if(!notes.length) continue;
                ctx.save();
                ctx.lineWidth = Math.max(1, Math.floor(guideLineWidth*0.6));
                // 淡い色で背景に
                ctx.strokeStyle = 'rgba(180, 190, 210, 0.45)';
                for(const n of notes){
                    if(!n) continue;
                    if(n.time>visEnd) break;
                    if(n.time+n.duration<visStart) continue;
                    const x1=playX+(n.time-eff)*pxPerSec/tempoFactor;
                    const x2=playX+((n.time+n.duration)-eff)*pxPerSec/tempoFactor;
                    if(x2<0||x1>w) continue;
                    const y=h-(n.midi-vmin+1)*pxSemi;
                    ctx.beginPath(); ctx.moveTo(x1,y); ctx.lineTo(x2,y); ctx.stroke();
                }
                ctx.restore();
            }
        }
    }catch(_){ }

    // メロディノート（ラインのみ、枠無し） + 選択ハイライト（選択パートを前面で描画）
    // キャリブレーション中はメロディ表示を抑止（ゴーストのみ表示）
    if(!isCalibrating && currentTracks[melodyTrackIndex] && !isPitchOnlyMode){
        ctx.lineWidth=guideLineWidth; ctx.strokeStyle='#4e8cff';
        const notes=currentTracks[melodyTrackIndex].notes;
    
        noteRectsGlobal.length=0;
        const t = playbackPosition;
        let playheadIdx = -1;
        for(let i=0;i<notes.length;i++){
            const n=notes[i];
            if(n.time<=t && t<=n.time+n.duration){ playheadIdx = i; break; }
        }
        for(let i=0;i<notes.length;i++){
            const n=notes[i];
            if(n.time>visEnd) break;
            if(n.time+n.duration<visStart) continue;
            const x1=playX+(n.time-eff)*pxPerSec/tempoFactor;
            const x2=playX+((n.time+n.duration)-eff)*pxPerSec/tempoFactor;
            if(x2<0||x1>w) continue;
            const y=h-(n.midi-vmin+1)*pxSemi;
            const sel=window._selection||{type:'none'};
            const isSingleSel = (sel.type==='single' && sel.index!=null && notes[sel.index]===n);
            const isRangeSel  = (sel.type==='range' && sel.startSec!=null && sel.endSec!=null && !(n.time>sel.endSec || (n.time+n.duration)<sel.startSec));
            if(isSingleSel){
                // 単一選択のみ黄色で強調
                ctx.save();
                ctx.fillStyle='rgba(255,255,80,0.38)';
                const barH = Math.min(12, pxSemi*1.0);
                ctx.fillRect(x1, y-barH/2, x2-x1, barH);
                ctx.strokeStyle='#ffe600'; ctx.lineWidth=Math.max(guideLineWidth,3.2);
                ctx.beginPath(); ctx.moveTo(x1,y); ctx.lineTo(x2,y); ctx.stroke();
                ctx.restore();
            } else if(isRangeSel){
                // 範囲選択は黄色を避け、控えめなシアン系で可視化
                ctx.save();
                ctx.fillStyle='rgba(120, 220, 255, 0.18)';
                const barH = Math.min(10, pxSemi*0.9);
                ctx.fillRect(x1, y-barH/2, x2-x1, barH);
                ctx.strokeStyle='#6fe0ff'; ctx.lineWidth=Math.max(guideLineWidth,2.0);
                ctx.beginPath(); ctx.moveTo(x1,y); ctx.lineTo(x2,y); ctx.stroke();
                ctx.restore();
            } else {
                ctx.beginPath(); ctx.moveTo(x1,y); ctx.lineTo(x2,y); ctx.stroke();
            }
            // 許容範囲ライン（白い実線）: toleranceCents を半音換算して上下に描画
            const dy = (toleranceCents/100) * pxSemi; // cents -> semitone -> px
            if(dy>0.2){
                ctx.save();
                ctx.lineWidth = 1;
                ctx.strokeStyle = '#ffffff';
                // 上側
                ctx.beginPath(); ctx.moveTo(x1, y - dy); ctx.lineTo(x2, y - dy); ctx.stroke();
                // 下側
                ctx.beginPath(); ctx.moveTo(x1, y + dy); ctx.lineTo(x2, y + dy); ctx.stroke();
                ctx.restore();
            }
            noteRectsGlobal.push({x1,x2,y,idx:notes.indexOf(n)});
            if(showNoteNames){ ctx.font='10px sans-serif'; ctx.fillStyle='#fff'; ctx.textAlign='center'; ctx.textBaseline='middle'; const lab=noteLabel(n.midi); ctx.fillText(lab,(x1+x2)/2,y-8); }
        }
    }
    // ゴースト(練習)から時刻tのアンカーMIDIを取得（resp優先）
    function ghostMidiAt(t){
        try{
            if(Array.isArray(midiGhostNotes) && midiGhostNotes.length){
                // resp優先で一致するものを探す
                let cand=null;
                for(const n of midiGhostNotes){
                    if(n && (n.role==='resp') && t>=n.time && t<=n.time+n.duration){ cand=n; break; }
                }
                if(!cand){
                    for(const n of midiGhostNotes){
                        if(n && t>=n.time && t<=n.time+n.duration){ cand=n; break; }
                    }
                }
                if(cand) return cand.midi|0;
            }
        }catch(_){ }
        return null;
    }
    // 指定時刻がコール（アプリ演奏）区間かどうか
    function isCallAt(t){
        try{
            if(!isPracticing) return false;
            if(Array.isArray(midiGhostNotes) && midiGhostNotes.length){
                for(const n of midiGhostNotes){
                    if(n && n.role==='call' && t>=n.time && t<=n.time+n.duration){ return true; }
                }
            }
        }catch(_){ }
        return false;
    }
    // 再生線上のガイドMIDI（音程モードでは無効化）
    let guideMidiAtPlayhead = null;
    if(!isPitchOnlyMode){
        try{
            const tr=currentTracks[melodyTrackIndex];
            const tRef = playbackPosition - getPitchVisOffsetSec();
            if(tr&&tr.notes&&tr.notes.length){
                const nn=tr.notes.find(n=> tRef>=n.time && tRef<=n.time+n.duration) || tr.notes.find(n=> n.time>tRef) || tr.notes[tr.notes.length-1];
                if(nn) guideMidiAtPlayhead = nn.midi|0;
            } else {
                // トラックが無い場合はゴーストから
                const gM = ghostMidiAt(tRef);
                if(gM!=null) guideMidiAtPlayhead = gM;
            }
        }catch(_){ }
    }
    // アシスト中の見やすい棒線（後段で重ね描きするため、ここではセグメントを算出）
    let _assistSegments = null;
    if(isAssistActive()){
    const LAG_MS = Math.round((getPitchVisOffsetSec())*1000);
        const lag = LAG_MS/1000;
        const effStart = eff - (playX/pxPerSec)*tempoFactor - 1;
        const effEnd   = eff + ((w-playX)/pxPerSec)*tempoFactor + 1;
        const drawUntil = (playbackPosition - lag);
        const pts=[];
        for(const p of pitchHistory){
            const t = p.time + ((p.visOff!=null)? (p.visOff - curOff) : 0);
            if(!(t>=effStart && t<=effEnd)) continue; if(t>drawUntil) continue;
            if(typeof p.conf==='number' && p.conf < PITCH_CONF_MIN) continue;
            if(isCallAt(t)) continue;
            pts.push({t});
        }
        pts.sort((a,b)=>a.t-b.t);
        if(Array.isArray(midiGhostNotes) && midiGhostNotes.length){
            const TOL = 0.15; // 150ms
            const segs=[];
            for(const p of pts){
                let best=null, bd=1e9;
                for(const g of midiGhostNotes){ const c=g.time+(g.duration||0)/2; const d=Math.abs(p.t - c); if(d<bd){ bd=d; best=g; } }
                if(!best) continue;
                const dEdge = Math.min(Math.abs(p.t-best.time), Math.abs((best.time+(best.duration||0))-p.t));
                if(Math.min(bd, dEdge) > TOL) continue;
                const y = h - (best.midi - vmin + 1) * pxSemi - 3; // -3px 上にずらして重なりを避ける
                const x1 = playX + ((p.t - 0.06 - eff) * pxPerSec / tempoFactor);
                const x2 = playX + ((p.t + 0.06 - eff) * pxPerSec / tempoFactor);
                if(x2<0 || x1>w) continue;
                segs.push({x1,x2,y});
            }
            if(segs.length) _assistSegments = segs;
        }
    }

    // キャリブレーション中は非表示
    // 追加仕様（緩和）: モバイルでは停止中でも直近に有声音履歴があれば描画を許可
    let allowDrawPitch = (isPitchOnlyMode || isPlaying);
    // 停止中でも直近に有効な履歴があれば描画を許可（PC/モバイル共通）
    if(!allowDrawPitch){
        try{
            // 直近 0.5 秒以内に信頼度閾値以上の点があれば描画許可
            const tNow = playbackPosition - getPitchVisOffsetSec();
            const drawConfMin = IS_MOBILE ? DRAW_CONF_MIN_MOBILE : PITCH_CONF_MIN;
            for(let i=pitchHistory.length-1;i>=0;i--){ const p=pitchHistory[i]; if((tNow - p.time) > 0.5) break; if((p.conf==null) || (p.conf >= drawConfMin)){ allowDrawPitch = true; break; } }
        }catch(_){ }
    }
    if(!isCalibrating && pitchHistory.length && !isAssistActive() && allowDrawPitch){
    const LAG_MS = Math.round((getPitchVisOffsetSec())*1000); // 測定遅延も反映
        // 補正なし: サンプル間の自然な連続のみ（解析レートから最小連結幅を算出）
        const CHANGE_TOL_SEMI = 0.5;      // 基本の分割しきい値（半音）
        const lag = LAG_MS/1000;
        const bridgeGap = Math.max(0.001, (1/Math.max(1,(analysisRate||20))) * 1.5);
        // 可視時間帯に合わせて履歴を抽出（少し余裕）
        const visStart = eff - (playX/pxPerSec)*tempoFactor - 1;
        const visEnd = eff + ((w-playX)/pxPerSec)*tempoFactor + 1;
        // 遅延を加味した描画対象時間の上限
        const drawUntil = (playbackPosition - lag);

    // 1) 範囲内の点を抽出し、時間順に並べ、表示用MIDIとdCentsを整形
        const pts = [];
        // 補正なし: アウトライヤ除去は行わない（信頼度の下限のみ適用）
        const WIN = 0;
        for(let i=0;i<pitchHistory.length;i++){
            const p = pitchHistory[i];
            // 保存時の可視オフセット差分を現在値に合わせて再配置
            const t = p.time + ((p.visOff!=null)? (p.visOff - curOff) : 0);
            if(!(t>=visStart && t<=visEnd)) continue;
            if(t > drawUntil) continue;   // 遅延より後はまだ描かない
            const drawConfMin = IS_MOBILE ? DRAW_CONF_MIN_MOBILE : PITCH_CONF_MIN;
            if(typeof p.conf==='number' && p.conf < drawConfMin) continue; // 低信頼は無視
            if(isCallAt(t)) continue;     // コール中は非表示
            // 表示用MIDI: ガイドへの吸着は廃止。常に生周波数から算出。
            let midi;
            let dCents = (p.dCents!=null && Number.isFinite(p.dCents))? p.dCents : null;
            midi = (69+12*Math.log2(Math.max(1e-9,p.freq)/A4Frequency));
            if(!(midi>=vmin && midi<=vmax)) continue;
            pts.push({t, midi, dCents, conf:(typeof p.conf==='number'? p.conf: 0.7), freq:p.freq});
        }
        if(pts.length){
            // 診断: 可視範囲の音高クラスが実質的に1クラス（例: Cのみ）に張り付いているか検出
            try{
                const classes = new Map();
                for(const p of pts){
                    const pc = ((Math.round(p.midi)%12)+12)%12;
                    classes.set(pc, (classes.get(pc)||0)+1);
                }
                if(classes.size===1){
                    const onlyPc=[...classes.keys()][0];
                    __diagLog('c-only-visual', {
                        pc: onlyPc,
                        count: pts.length,
                        A4: A4Frequency,
                        visRange: {vmin, vmax},
                        states: {isCalibrating, practicing:isPracticing, assist:isAssistActive()},
                        micRenderMode
                    }, 4000);
                }
            }catch(_){ }
            // pitchHistory は時系列で追加されるため、ここでの追加点列 pts も概ね時系列。
            // 不要な毎フレームソートを避けて描画負荷を軽減する（極端な順序入替は上流で統一）。
            if(micRenderMode==='dot'){
                // 赤い点モード: サンプルごとに小さな点を描画
                ctx.save();
                for(const p of pts){
                    const y = h - (p.midi - vmin + 1) * pxSemi;
                    const x = playX + ((p.t - eff) * pxPerSec / tempoFactor);
                    if(x<0 || x>w) continue;
                    ctx.beginPath();
                    ctx.arc(x, y, 2.5, 0, Math.PI*2);
                    ctx.fillStyle = 'rgba(255,80,80,0.9)';
                    ctx.strokeStyle = '#fff';
                    ctx.lineWidth = 1.2;
                    ctx.fill(); ctx.stroke();
                }
                ctx.restore();
            } else if(micRenderMode==='graph'){
                // グラフモード: 無音ギャップで分割し、許容内は前面緑、許容外は背面赤
                // 近接判定のための閾値
                const CHANGE_TOL_SEMI = 0.5;      // 半音差分の分割しきい値
                const bridgeGap = Math.max(0.02, (1/Math.max(1,(analysisRate||20))) * 1.8);
                // 表示専用の軽量平滑化: 3点移動平均 [1,2,1]/4 を適用（時間はそのまま）
                (function smoothDisplayPoints(){
                    if(pts.length<3) return;
                    const sm = new Array(pts.length);
                    for(let i=0;i<pts.length;i++){
                        if(i===0 || i===pts.length-1){ sm[i] = { ...pts[i] }; }
                        else {
                            const m = (pts[i-1].midi + 2*pts[i].midi + pts[i+1].midi)/4;
                            sm[i] = { ...pts[i], midi: m };
                        }
                    }
                    for(let i=0;i<pts.length;i++){ pts[i].midi = sm[i].midi; }
                })();
                // まず連続セグメントに分割
                const segs=[]; // {pts:[{x,y,t,midi,inTol,conf}]}
                let cur=null; let last=null;
                for(const p of pts){
                    const x = playX + ((p.t - eff) * pxPerSec / tempoFactor);
                    const y = h - (p.midi - vmin + 1) * pxSemi;
                    const inTol = (p.dCents!=null)? (Math.abs(p.dCents) <= (toleranceCents||0)) : false;
                    if(x<0 || x>w){ last=p; continue; }
                    const voiced = (p.conf==null? true: p.conf>=0.3);
                    if(!voiced){ last=p; continue; }
                    const isCont = last? ((p.t - last.t) <= bridgeGap && Math.abs(p.midi - last.midi) <= CHANGE_TOL_SEMI) : false;
                    if(!cur || !isCont){
                        if(cur && cur.pts.length>=2) segs.push(cur);
                        cur = { pts:[{x,y,t:p.t,midi:p.midi,inTol,conf:p.conf}] };
                    } else {
                        cur.pts.push({x,y,t:p.t,midi:p.midi,inTol,conf:p.conf});
                    }
                    last=p;
                }
                if(cur && cur.pts.length>=2) segs.push(cur);
                // 平滑化描画ヘルパー: ポリラインを二次曲線でスムーズに
                function drawSmoothedPolyline(ctx, points){
                    if(!points || points.length<2) return;
                    ctx.beginPath();
                    if(points.length===2){
                        ctx.moveTo(points[0].x, points[0].y);
                        ctx.lineTo(points[1].x, points[1].y);
                        ctx.stroke();
                        return;
                    }
                    ctx.moveTo(points[0].x, points[0].y);
                    for(let i=1;i<points.length-1;i++){
                        const xc=(points[i].x + points[i+1].x)/2;
                        const yc=(points[i].y + points[i+1].y)/2;
                        ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
                    }
                    ctx.lineTo(points[points.length-1].x, points[points.length-1].y);
                    ctx.stroke();
                }
                function splitRuns(points, predicate){
                    const runs=[]; let run=[];
                    for(const pt of points){
                        if(predicate(pt)){
                            run.push(pt);
                        } else {
                            if(run.length>=2) runs.push(run);
                            run=[];
                        }
                    }
                    if(run.length>=2) runs.push(run);
                    return runs;
                }
                // 背面（赤）→ 前面（緑）の順に描画
                ctx.save();
                ctx.lineWidth = 2.0;
                // 赤: 許容外連続部分のみポリライン
                ctx.strokeStyle = 'rgba(255,120,120,0.9)';
                for(const s of segs){
                    const runs = splitRuns(s.pts, (pt)=>!pt.inTol);
                    for(const r of runs){ drawSmoothedPolyline(ctx, r); }
                }
                // 緑: 許容内を前面で
                ctx.strokeStyle = 'rgba(24,200,70,0.98)';
                for(const s of segs){
                    const runs = splitRuns(s.pts, (pt)=>pt.inTol);
                    for(const r of runs){ drawSmoothedPolyline(ctx, r); }
                }
                ctx.restore();
            } else {
                // 棒線（既存）: 連続トーンに分割して太さ/色分け
                // 2) 連続トーンに分割
                let run=null; // {t0, t1, sumMidi, sumW, lastT, baseKey, inTol, outTol, confSum, cnt, samples:[]}
                const flushRun=(r)=>{
                if(!r) return;
                const mAvg = r.sumMidi / Math.max(1e-6, r.sumW);
                const y = h - (mAvg - vmin + 1) * pxSemi;
                const x1 = playX + ((r.t0 - eff) * pxPerSec / tempoFactor);
                const x2 = playX + ((r.t1 - eff) * pxPerSec / tempoFactor);
                if(x2<0 || x1>w) return;
                // 色分け: 許容内割合で決定（50%以上で緑）
                const tol = toleranceCents||0;
                const okRatio = (r.inTol + r.outTol) > 0 ? (r.inTol/(r.inTol + r.outTol)) : 0;
                const alpha = Math.max(0.35, Math.min(1, 0.45 + 0.55*(r.confSum/Math.max(1,r.cnt)) ));
                if(okRatio >= 0.5){
                    // 視認性向上: 白縁 + 緑本線 + わずかに上オフセット
                    const yOff = y - 3; // 上に 3px
                    ctx.save();
                    // 外側白縁
                    ctx.lineWidth = 6;
                    ctx.strokeStyle = `rgba(255,255,255,${alpha*0.95})`;
                    ctx.beginPath(); ctx.moveTo(x1, yOff); ctx.lineTo(x2, yOff); ctx.stroke();
                    // 内側緑
                    ctx.lineWidth = 3;
                    ctx.strokeStyle = `rgba(24,200,70,${alpha})`;
                    ctx.beginPath(); ctx.moveTo(x1, yOff); ctx.lineTo(x2, yOff); ctx.stroke();
                    ctx.restore();
                } else {
                    ctx.save();
                    ctx.lineWidth = 3;
                    ctx.strokeStyle = `rgba(255,64,64,${alpha})`;
                    ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
                    ctx.restore();
                }

                // ビブラート検出と波線描画
                try{
                    // 条件: ラン長が0.3s以上、サンプル数が5以上
                    const dur = (r.t1 - r.t0);
                    if(dur >= 0.3 && r.samples && r.samples.length >= 5){
                        // ローカル中央値を基準にしたセント偏差列を作成
                        const mids = r.samples.map(s=> s.midi);
                        const times = r.samples.map(s=> s.t);
                        const med = mids.slice().sort((a,b)=>a-b)[Math.floor(mids.length/2)];
                        const cents = mids.map(m=> (m - med)*100);
                        // 1次トレンドを除去（単純移動平均）
                        const win = Math.max(1, Math.floor(Math.min(7, Math.max(3, Math.round(r.samples.length*0.12)))));
                        const detr = cents.map((v,i)=>{
                            let s=0,c=0; for(let k=-win;k<=win;k++){ const j=i+k; if(j>=0&&j<cents.length){ s+=cents[j]; c++; } }
                            const ma = s/Math.max(1,c); return v - ma;
                        });
                        // 単純ゼロクロスから基本振動数を推定（4〜9Hz域）
                        let zc=0; for(let i=1;i<detr.length;i++){ if((detr[i-1]<=0 && detr[i]>0) || (detr[i-1]>=0 && detr[i]<0)) zc++; }
                        const fs = Math.max(1e-6, r.cnt / Math.max(1e-6, dur)); // サンプル/秒（解析レート近似）
                        const estHz = (zc/2) / Math.max(1e-6, dur); // 粗推定
                        // 振幅（peak-to-peakの半分）
                        const minV = Math.min(...detr), maxV=Math.max(...detr);
                        const amp = (maxV - minV)/2; // cents
                        const vibOK = (estHz>=3.5 && estHz<=8.5 && amp>=20);
                        if(vibOK){
                            // 波線パラメータ
                            const ampPx = Math.min(6, Math.max(3, (amp/100)*pxSemi*0.9)); // セミトーン→px換算の約0.9倍
                            const yWave = y - 8; // ノート線の少し上
                            const fHz = estHz;
                            // 可視範囲ないのサンプル点からポリラインを生成
                            const step = Math.max(2, Math.floor((x2-x1)/48));
                            ctx.save();
                            ctx.lineWidth = 2;
                            ctx.strokeStyle = 'rgba(120,200,255,0.9)';
                            ctx.beginPath();
                            const totalPx = x2 - x1;
                            const twoPiF = 2*Math.PI*fHz;
                            for(let i=0;i<=Math.max(1, Math.floor(totalPx/step)); i++){
                                const px = x1 + i*step;
                                if(px<x1 || px> x2) continue;
                                const tt = r.t0 + ( (px - x1) / (x2 - x1) ) * dur; // 線形対応
                                const phase = twoPiF * (tt - r.t0);
                                const yy = yWave - ampPx * Math.sin(phase);
                                if(i===0) ctx.moveTo(px, yy); else ctx.lineTo(px, yy);
                            }
                            ctx.stroke();
                            ctx.restore();
                        }
                    }
                }catch(_){ }
            };
            // ゆっくりした連続ドリフトを長い水平バーに平均化しないための分割しきい値（セミトーン）
            const DRIFT_SPLIT_SEMI = 0.18; // ≈ 18 cents
            const DRIFT_MIN_DUR = 0.25;    // 0.25s 以上続いたら評価
            for(const p of pts){
                    const key = Math.round(p.midi); // 半音丸め（ビブラートを同一トーンとして扱う）
                    const w = 0.5 + 0.5*p.conf;
                    if(!run){
                        run = { t0:p.t, t1:p.t, sumMidi:p.midi*w, sumW:w, lastT:p.t, baseKey:key, inTol:0, outTol:0, confSum:p.conf, cnt:1, samples:[{t:p.t, midi:p.midi}] };
                        if(p.dCents!=null){ (Math.abs(p.dCents) <= (toleranceCents||0)) ? run.inTol++ : run.outTol++; }
                        continue;
                    }
                    const gap = p.t - run.lastT;
                    const lastMidiInRun = run.samples[run.samples.length-1]?.midi ?? (run.sumMidi/Math.max(1e-6,run.sumW));
                    const mAvgCur = run.sumMidi/Math.max(1e-6,run.sumW);
                    const deltaToKey = Math.abs(p.midi - run.baseKey);
                    const deltaToLast = Math.abs(p.midi - lastMidiInRun);
                    const deltaToAvg  = Math.abs(p.midi - mAvgCur);
                    // 連続性は「直前/移動平均」のどちらかが許容内ならOK（キー固定による過度な引っ張りを抑制）
                    const continuous = (gap <= bridgeGap) && ( (deltaToLast <= CHANGE_TOL_SEMI*1.2) || (deltaToAvg <= CHANGE_TOL_SEMI) || (deltaToKey <= CHANGE_TOL_SEMI*0.9) );
                    if(continuous){
                        // 累積ドリフトが閾値を超えたら分割（長い水平バー抑制）
                        const durRun = (run.lastT - run.t0);
                        if(durRun >= DRIFT_MIN_DUR && Math.abs(p.midi - mAvgCur) > DRIFT_SPLIT_SEMI){
                            // 現在の run を確定し、新しい run を開始
                            __diagLog('line-split-drift', {dur:durRun, drift:Math.abs(p.midi - mAvgCur), tol:DRIFT_SPLIT_SEMI}, 4000);
                            flushRun(run);
                            run = { t0:p.t, t1:p.t, sumMidi:p.midi*w, sumW:w, lastT:p.t, baseKey:key, inTol:0, outTol:0, confSum:p.conf, cnt:1, samples:[{t:p.t, midi:p.midi}] };
                            if(p.dCents!=null){ (Math.abs(p.dCents) <= (toleranceCents||0)) ? run.inTol++ : run.outTol++; }
                        } else {
                            run.t1 = p.t; run.lastT = p.t;
                            run.sumMidi += p.midi*w; run.sumW += w;
                            run.confSum += p.conf; run.cnt++;
                            run.samples.push({t:p.t, midi:p.midi});
                            if(p.dCents!=null){ (Math.abs(p.dCents) <= (toleranceCents||0)) ? run.inTol++ : run.outTol++; }
                        }
                    } else {
                        // いまのrunを確定して新規開始
                        flushRun(run);
                        run = { t0:p.t, t1:p.t, sumMidi:p.midi*w, sumW:w, lastT:p.t, baseKey:key, inTol:0, outTol:0, confSum:p.conf, cnt:1, samples:[{t:p.t, midi:p.midi}] };
                        if(p.dCents!=null){ (Math.abs(p.dCents) <= (toleranceCents||0)) ? run.inTol++ : run.outTol++; }
                    }
                }
                flushRun(run);
            }
        }
        // ガイド無し時のピッチクラス・オーバーレイはドット専用表現のため省略
    }
    // 仮ノーツ（MIDIアライン/練習ゴーストのプレビュー）
    // 通常: 赤の破線。基礎練習モード中はメロディと同じ青の実線で表示。
    // 変更: モバイルの基礎練習モードでは、ピッチ専用モード中でもガイド/赤破線を表示する
    // 練習モード中は PC/モバイル問わずピッチ専用モードでもガイドを表示
    if(Array.isArray(midiGhostNotes) && midiGhostNotes.length && (!isPitchOnlyMode || isPracticing)){
    const visStart=eff - (playX/pxPerSec)*tempoFactor - 1; const visEnd=eff + ((w-playX)/pxPerSec)*tempoFactor + 1;
        ctx.save();
        ctx.lineWidth = Math.max(2, guideLineWidth);
    for(const n of midiGhostNotes){
            // ノート毎の描画スタイルを切替
            if(n.role==='resp' || n.role==='calib'){
                ctx.strokeStyle = '#4e8cff';
                ctx.setLineDash([]);
            }else if(n.role==='call'){
                ctx.strokeStyle = 'rgba(255,80,80,0.9)';
                ctx.setLineDash([6,4]);
            }else{
                // 既定（MIDIアライン等）
                ctx.strokeStyle = 'rgba(255,80,80,0.9)';
                ctx.setLineDash([6,4]);
            }
            const st=n.time, en=n.time+n.duration;
            if(en<visStart || st>visEnd) continue;
            const x1=playX+(st-eff)*pxPerSec/tempoFactor;
            const x2=playX+((en)-eff)*pxPerSec/tempoFactor;
            if(x2<0 || x1>w) continue;
            // 見た目のみのオクターブ表示シフト（基礎練習の call/resp/calib に適用）
            const dispMidi = (practiceMode==='basic' && (n.role==='call' || n.role==='resp' || n.role==='calib'))
                ? (n.midi + (practiceCallDisplayOctShift|0))
                : n.midi;
            const y=h-(dispMidi-vmin+1)*pxSemi;
            ctx.beginPath();
            ctx.moveTo(x1,y);
            ctx.lineTo(x2,y);
            ctx.stroke();
            // ラベル: コード名ではなく音名を表示（call/resp 双方）。
            if(n.role==='call' || n.role==='resp'){
                try{
                    const lbl = noteLabel(Math.round(dispMidi));
                    ctx.save();
                    ctx.font='12px sans-serif';
                    ctx.textAlign='center'; ctx.textBaseline='bottom';
                    const textX = (x1+x2)/2, textY = y-6;
                    const tw=ctx.measureText(lbl).width;
                    ctx.fillStyle='rgba(0,0,0,0.6)';
                    ctx.fillRect(textX - tw/2 - 4, textY-16, tw+8, 14);
                    ctx.fillStyle = (n.role==='call')? '#ffd27d' : '#d6f0ff';
                    ctx.fillText(lbl, textX, textY-2);
                    ctx.restore();
                }catch(_){ }
            }
            // 青いユーザ用ノーツ（resp）には通常モード同様の許容範囲ラインを付与
            if(n.role==='resp'){
                const dy = (toleranceCents/100) * pxSemi;
                if(dy>0.2){
                    ctx.save();
                    ctx.setLineDash([]);
                    ctx.lineWidth = 1;
                    ctx.strokeStyle = '#ffffff';
                    // 上側
                    ctx.beginPath(); ctx.moveTo(x1, y - dy); ctx.lineTo(x2, y - dy); ctx.stroke();
                    // 下側
                    ctx.beginPath(); ctx.moveTo(x1, y + dy); ctx.lineTo(x2, y + dy); ctx.stroke();
                    ctx.restore();
                }
            }
        }
        ctx.restore();
    }
    // アシスト中の棒線はゴーストの上に重ねて描く（白縁＋緑で視認性UP）。
    // 変更: モバイルの基礎練習モードでは、ピッチ専用モード中でも表示する
    if(_assistSegments && _assistSegments.length && (!isPitchOnlyMode || (IS_MOBILE && isPracticing))){
        ctx.save();
        for(const s of _assistSegments){
            // 外側の白縁
            ctx.lineWidth = 5;
            ctx.strokeStyle = 'rgba(255,255,255,0.9)';
            ctx.beginPath(); ctx.moveTo(s.x1, s.y); ctx.lineTo(s.x2, s.y); ctx.stroke();
            // 内側の緑本線
            ctx.lineWidth = 3;
            ctx.strokeStyle = 'rgba(24,200,70,0.95)';
            ctx.beginPath(); ctx.moveTo(s.x1, s.y); ctx.lineTo(s.x2, s.y); ctx.stroke();
        }
        ctx.restore();
    }
    // ライブインジケータ (再生中/停止中共通)
    // キャリブレーション中は非表示（ゴーストのみ見せる）
    if(!isCalibrating && lastMicFreq>0){
        // 表示用に、ガイド（トラック or ゴースト）がある場合は最も近いオクターブに寄せる
        // 基準は必ず生周波数由来のMIDI（lastMicFreq）
        let midi = 69 + 12*Math.log2(lastMicFreq/A4Frequency);
        // ガイドMIDIに合わせるオクターブ補正は撤廃（生MIDIそのまま表示）
        // 低信頼フレームでは赤丸を描かない（履歴同様の基準に合わせる）
        const canShowLive = (function(){
            try{
                // 直近履歴の信頼度で判定（同一時刻帯の点があればそれに合わせる）
                const tRef = playbackPosition - getPitchVisOffsetSec();
                const drawConfMin = IS_MOBILE ? DRAW_CONF_MIN_MOBILE : PITCH_CONF_MIN;
                for(let i=pitchHistory.length-1;i>=0;i--){ const p=pitchHistory[i]; if((tRef - p.time) > 0.25) break; if(Math.abs(p.time - tRef) <= 0.12){ return (p.conf==null) || (p.conf >= drawConfMin); } }
            }catch(_){ }
            return true; // 情報がなければ表示
        })();
        if(canShowLive && midi>=vmin && midi<=vmax){
            const y=h-(midi-vmin+1)*pxSemi;
            // 外枠白→内部赤円
            ctx.beginPath(); ctx.arc(playX,y,8,0,Math.PI*2); ctx.fillStyle='rgba(255,80,80,0.9)'; ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.fill(); ctx.stroke();
            // 音名表示
            const label=noteLabel(Math.round(midi));
            ctx.font='12px sans-serif'; ctx.textAlign='left'; ctx.textBaseline='middle';
            const tx=playX+12; const ty=y;
            ctx.fillStyle='rgba(0,0,0,0.6)'; const pad=4; const tw=ctx.measureText(label).width; ctx.fillRect(tx-2,ty-10,tw+pad+2,16);
            ctx.fillStyle='#ffe'; ctx.fillText(label,tx,ty);
            // カラオケ風: 目標ノートに対するセント偏差を表示（音程モードでは非表示）
            try{
                if(!isPitchOnlyMode){
                const tr=currentTracks[melodyTrackIndex];
                if(tr && tr.notes && tr.notes.length){
                    const t=playbackPosition; const nn=tr.notes.find(n=> t>=n.time && t<=n.time+n.duration) || tr.notes.find(n=> n.time>t) || tr.notes[tr.notes.length-1];
                    if(nn){
                        // 表示オクターブに合わせて目標MIDIを±12で寄せる
                        let mTar = nn.midi; let mLive = Math.round(midi);
                        while(mLive - mTar > 6) mTar += 12; while(mTar - mLive > 6) mTar -= 12;
                        const fTar = midiToFreq(mTar);
                        const dCents = 1200*Math.log2(Math.max(1e-9,lastMicFreq)/Math.max(1e-9,fTar));
                        const centsTxt = (dCents>=0? '+':'') + Math.round(dCents) + 'c';
                        const within = Math.abs(dCents) <= (toleranceCents||0);
                        const cx = tx + tw + 10;
                        const cy = ty;
                        const ctW = ctx.measureText(centsTxt).width + 8;
                        ctx.fillStyle = 'rgba(0,0,0,0.6)';
                        ctx.fillRect(cx-2, cy-10, ctW+2, 16);
                        ctx.fillStyle = within? '#aef0ae' : '#ffd6a6';
                        ctx.fillText(centsTxt, cx+2, cy);
                    }
                }
                }
            }catch(_){ }
        }

        // 追加: タイムライン左側に現在の音名をオーバーレイ表示（PC/スマホ/タブレット共通）
        try{
            // noteLabel() は labelNotation 設定に従って CDE/ドレミ を切り替える
            const liveRoundMidi = Math.round(midi);
            const liveLabel = noteLabel(liveRoundMidi);
            // 端末サイズに合わせた適度なフォントサイズ（縦の4.5%を上限18pxで抑制）
            const fontPx = Math.max(12, Math.min(18, Math.floor(h*0.045)));
            ctx.save();
            ctx.font = `bold ${fontPx}px sans-serif`;
            ctx.textAlign = 'left'; ctx.textBaseline = 'top';
            const padX = 10, padY = 6;
            const x0 = 8, y0 = 8; // 左上に固定
            const tw = ctx.measureText(liveLabel).width;
            const boxW = Math.floor(tw + padX*2);
            const boxH = Math.floor(fontPx + padY*2);
            // 背景（半透明）
            ctx.fillStyle = 'rgba(0,0,0,0.55)';
            ctx.fillRect(x0, y0, boxW, boxH);
            // テキスト
            ctx.fillStyle = '#fff';
            ctx.fillText(liveLabel, x0 + padX, y0 + padY);
            ctx.restore();
        }catch(_){ }
    }
    // キャリブレーションのカウントダウン表示（タイムライン上に大きく）
    if(isCalibrating && calibCountdownText){
        ctx.save();
        ctx.globalAlpha = 1;
        const msg = String(calibCountdownText);
        // 可視範囲内の先頭ゴーストノーツを基準に座標を決定
        let anchorX = null, anchorY = null;
        try{
            if(Array.isArray(midiGhostNotes) && midiGhostNotes.length){
                const visStart=eff - (playX/pxPerSec)*tempoFactor - 1;
                const visEnd  =eff + ((w-playX)/pxPerSec)*tempoFactor + 1;
                for(const n of midiGhostNotes){
                    const st=n.time, en=st+n.duration;
                    if(en<visStart || st>visEnd) continue;
                    const x1=playX+(st-eff)*pxPerSec/tempoFactor;
                    const x2=playX+((en)-eff)*pxPerSec/tempoFactor;
                    const y=h-(n.midi-vmin+1)*pxSemi;
                    anchorX = Math.max(40, Math.min(w-40, (x1+x2)/2));
                    anchorY = Math.max(40, Math.min(h-40, y - 36));
                    break;
                }
            }
        }catch(_){ }
        // アンカーが見つからなければ、事前計算のアンカー/中央へフォールバック
        if(anchorX==null || anchorY==null){
            if(calibAnchorActive){
                try{
                    const xRaw = playX + ((calibAnchorTime - eff) * pxPerSec/tempoFactor);
                    const yRaw = h - ((calibAnchorMidi - vmin + 1) * pxSemi);
                    anchorX = Math.max(40, Math.min(w-40, xRaw));
                    anchorY = (yRaw>=40 && yRaw<=h-40)? Math.round(yRaw - 36) : Math.floor(h*0.35);
                }catch(_){ }
            }
            if(anchorX==null || anchorY==null){ anchorX=Math.floor(w*0.5); anchorY=Math.floor(h*0.35); }
        }
        // 背景パネル
        const fontPx = Math.floor(h*0.22);
        ctx.font = `bold ${fontPx}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const padX=18, padY=10; const metrics = ctx.measureText(msg);
        const textW = Math.max(metrics.width, fontPx*0.6);
        const boxW = Math.floor(textW + padX*2); const boxH = Math.floor(fontPx + padY*2);
        const bx = Math.floor(anchorX - boxW/2); const by = Math.floor(anchorY - boxH/2);
        ctx.fillStyle='rgba(0,0,0,0.55)';
        // 角丸矩形
        const r=12; ctx.beginPath();
        ctx.moveTo(bx+r,by); ctx.lineTo(bx+boxW-r,by); ctx.quadraticCurveTo(bx+boxW,by,bx+boxW,by+r);
        ctx.lineTo(bx+boxW,by+boxH-r); ctx.quadraticCurveTo(bx+boxW,by+boxH,bx+boxW-r,by+boxH);
        ctx.lineTo(bx+r,by+boxH); ctx.quadraticCurveTo(bx,by+boxH,bx,by+boxH-r);
        ctx.lineTo(bx,by+r); ctx.quadraticCurveTo(bx,by,bx+r,by); ctx.closePath(); ctx.fill();
        // 数字（白＋黒縁＋赤影）
        ctx.shadowColor='rgba(255,40,40,0.9)'; ctx.shadowBlur=12; ctx.lineWidth=8; ctx.strokeStyle='rgba(0,0,0,0.8)'; ctx.fillStyle='#fff';
        ctx.strokeText(msg, anchorX, anchorY+2);
        ctx.fillText(msg, anchorX, anchorY+2);
        ctx.shadowBlur=0;
        ctx.restore();
    }
    // 練習中: 現在のコード名を大きく表示（カウントダウン風）
    try{
        if(isPracticing && Array.isArray(midiGhostNotes) && midiGhostNotes.length){
            // 現在時刻に“かかっている” call ノートのラベルのみ表示（ズレ防止）
            const now = playbackPosition + timelineOffsetSec;
            let curLabel = null;
            for(const n of midiGhostNotes){
                if(n.role!=='call' || !n.label) continue;
                const st=n.time, en=n.time+n.duration;
                if(now>=st && now<=en){ curLabel=n.label; break; }
            }
            if(curLabel){
                ctx.save();
                // 画面上部中央にパネル＋文字
                const W=w, H=h; const anchorX = Math.floor(W*0.5); const anchorY = Math.floor(H*0.18);
                const fontPx = Math.max(20, Math.floor(h*0.08));
                ctx.font = `bold ${fontPx}px sans-serif`;
                ctx.textAlign='center'; ctx.textBaseline='middle';
                const txt = String(curLabel);
                const padX=14, padY=8; const metrics = ctx.measureText(txt);
                const textW = metrics.width; const boxW = Math.floor(textW + padX*2), boxH=Math.floor(fontPx + padY*2);
                const bx = Math.floor(anchorX - boxW/2), by=Math.floor(anchorY - boxH/2);
                ctx.fillStyle='rgba(0,0,0,0.55)';
                const r=10; ctx.beginPath();
                ctx.moveTo(bx+r,by); ctx.lineTo(bx+boxW-r,by); ctx.quadraticCurveTo(bx+boxW,by,bx+boxW,by+r);
                ctx.lineTo(bx+boxW,by+boxH-r); ctx.quadraticCurveTo(bx+boxW,by+boxH,bx+boxW-r,by+boxH);
                ctx.lineTo(bx+r,by+boxH); ctx.quadraticCurveTo(bx,by+boxH,bx,by+boxH-r);
                ctx.lineTo(bx,by+r); ctx.quadraticCurveTo(bx,by,bx+r,by); ctx.closePath(); ctx.fill();
                ctx.fillStyle='#ffd27d'; ctx.strokeStyle='rgba(0,0,0,0.85)'; ctx.lineWidth=4;
                ctx.strokeText(txt, anchorX, anchorY+1);
                ctx.fillText(txt, anchorX, anchorY+1);
                ctx.restore();
            }
        }
    }catch(_){ }
    // タイムラインマーカー表示（A〜G）
    try{
        ctx.save();
        const labels = Object.keys(markers||{});
        for(const k of labels){
            const t = markers[k];
            if(typeof t!=="number") continue;
            const x=playX+((t-eff)*pxPerSec/tempoFactor);
            if(x<0||x>w) continue; // ビュー外はスキップ
            // 目印: 上端に三角、その下に縦線、ラベル
            ctx.strokeStyle = '#0ff';
            ctx.fillStyle = '#0ff';
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x-5, 10); ctx.lineTo(x+5, 10); ctx.closePath(); ctx.fill();
            ctx.beginPath(); ctx.moveTo(x, 10); ctx.lineTo(x, Math.min(24,h)); ctx.stroke();
            ctx.fillStyle='#cff'; ctx.font='11px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='top'; ctx.fillText(k, x, 26);
        }
        ctx.restore();
    }catch(_){ }
    // 音程モードの右上オーバーレイ
    try{
        if(isPitchOnlyMode){
            const pad = 10;
            const label = '音程モード';
            ctx.save();
            ctx.font = 'bold 13px sans-serif';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'top';
            const tw = ctx.measureText(label).width;
            const boxW = Math.ceil(tw + 12);
            const boxH = 22;
            const x = (chartCanvas?.width||0) - pad - boxW;
            const y = pad;
            // 背景（半透明・角丸）
            ctx.fillStyle = 'rgba(0,0,0,0.55)';
            const r = 8; ctx.beginPath();
            ctx.moveTo(x+r, y); ctx.lineTo(x+boxW-r, y); ctx.quadraticCurveTo(x+boxW, y, x+boxW, y+r);
            ctx.lineTo(x+boxW, y+boxH-r); ctx.quadraticCurveTo(x+boxW, y+boxH, x+boxW-r, y+boxH);
            ctx.lineTo(x+r, y+boxH); ctx.quadraticCurveTo(x, y+boxH, x, y+boxH-r);
            ctx.lineTo(x, y+r); ctx.quadraticCurveTo(x, y, x+r, y); ctx.closePath(); ctx.fill();
            // 文字
            ctx.fillStyle = '#fff';
            ctx.fillText(label, x + boxW - 6, y + Math.floor((boxH-13)/2));
            ctx.restore();
        }
    }catch(_){ }
    // 再生ヘッド（より白く）
    ctx.strokeStyle='#ffffff'; ctx.beginPath(); ctx.moveTo(playX+0.5,0); ctx.lineTo(playX+0.5,h); ctx.stroke();
    // 最後にスクロールバー範囲を更新
    updateTimelineScrollRange();
}

// 再生線位置にあるノートを自動選択（編集モード時のみ）
function setSelectionByPlayhead(){
    try{
        if(!editToolbar || editToolbar.classList.contains('hidden')) return; // 編集モード外
        const tr=currentTracks[melodyTrackIndex]; if(!tr||!tr.notes||!tr.notes.length) return;
        const sel=window._selection||{type:'none'};
        // 範囲選択中は自動切替しない
        if(sel.type==='range') return;
        const t = playbackPosition; // 曲上の現在秒
        // 常に再生線下ノートを優先、無ければ最近傍のノート（開始/終了の端からの距離が最小）を選択
        let idx=-1;
        for(let i=0;i<tr.notes.length;i++){ const n=tr.notes[i]; if(t>=n.time && t<=n.time+n.duration){ idx=i; break; } }
        if(idx<0){
            // 最近傍検索
            let bestIdx=-1, bestDist=1e9;
            for(let i=0;i<tr.notes.length;i++){
                const n=tr.notes[i];
                const d = (t < n.time)? (n.time - t) : (t - (n.time+n.duration));
                if(d < bestDist){ bestDist=d; bestIdx=i; }
            }
            idx = bestIdx;
        }
        if(idx>=0){ setSingleSelection(idx,{audition:false}); }
    }catch(_){ }
}
// 選択状態（グローバル公開: 描画で参照）
window._selection = { type:'none', index:null, startSec:null, endSec:null };
let _rangePending = null; // {startIdx, startTime}
function setSingleSelection(idx, opts){
    const audition = (opts && opts.audition===false)? false: true;
    window._selection = { type:'single', index:idx, startSec:null, endSec:null };
    if(audition){
        try{
            const tr=currentTracks[melodyTrackIndex];
            if(tr&&tr.notes&&tr.notes[idx]){
                ensureAudio();
                const m=Math.max(36,Math.min(127,tr.notes[idx].midi));
                const d=Math.min(tr.notes[idx].duration||0.4, 0.6);
                // 練習モードのコール音源ゲインを再利用、なければ生成
                if(!practiceCallGain && audioCtx){ practiceCallGain = audioCtx.createGain(); practiceCallGain.gain.value=0.9; try{ (masterGain||audioCtx.destination) && practiceCallGain.connect(masterGain||audioCtx.destination); }catch(_){ practiceCallGain.connect(audioCtx.destination); } }
                const ok = simplePlaySfz(m, (audioCtx?audioCtx.currentTime:0)+0.02, d, practiceCallGain||masterGain||audioCtx?.destination);
                if(!ok && audioCtx){
                    try{ const osc=audioCtx.createOscillator(); const g=audioCtx.createGain(); osc.frequency.value=440*Math.pow(2,(m-69)/12); g.gain.setValueAtTime(0,audioCtx.currentTime); g.gain.linearRampToValueAtTime(0.9,audioCtx.currentTime+0.01); g.gain.linearRampToValueAtTime(0,audioCtx.currentTime+d); osc.connect(g); g.connect(practiceCallGain||masterGain||audioCtx.destination); osc.start(); osc.stop(audioCtx.currentTime+d+0.02); }catch(_){ }
                }
            }
        }catch(_){ }
    }
    drawChart();
}
function setRangeSelection(aSec,bSec){ const s=Math.min(aSec,bSec), e=Math.max(aSec,bSec); window._selection = { type:'range', index:null, startSec:s, endSec:e }; drawChart(); }
function clearSelection(){ window._selection = { type:'none', index:null, startSec:null, endSec:null }; drawChart(); }
function viewToTime(x,eff,playX){ return (x - playX) / pxPerSec * tempoFactor + eff; }
function hitTestNote(x,y){ const tol=6; const rects=noteRectsGlobal||[]; for(let i=0;i<rects.length;i++){ const r=rects[i]; if(x>=r.x1 && x<=r.x2 && Math.abs(y-r.y)<=tol) return r.idx; } return null; }
// 範囲ドラッグ
let draggingRange=false, dragStartX=0;
if(chartCanvas){
    // タイムライン領域の上下スワイプで縦オフセットを移動（ピクセル等価で厳密化）
    let swipeYActive=false, swipeStartY=0, swipePointerId=null;
    let swipeStartRelSemi=0, swipeAllowRangeSemi=0, swipePxPerSemi=1, swipeH=1;
    chartCanvas.addEventListener('pointerdown',(e)=>{
        if(isAdjustingVOffset) return; // スライダ操作中は無効
        // 現在の表示条件からピクセル→半音変換係数を算出
        const total = verticalZoom*12; // 表示半音数
        const min=36, max=132; // 全域
        const allowRange = Math.max(0, (max-min-total)); // スクロール可能な半音幅
        swipeAllowRangeSemi = allowRange;
        swipeH = chartCanvas.height||1;
        swipePxPerSemi = (swipeH>0 && total>0)? (swipeH/total) : 1; // px / semi
        const relSemi = (verticalOffset/100) * allowRange; // 現在の相対半音オフセット
        swipeStartRelSemi = relSemi;
        swipeYActive=true; swipeStartY=e.clientY; swipePointerId=e.pointerId; try{ chartCanvas.setPointerCapture(e.pointerId); }catch(_){ }
    });
    chartCanvas.addEventListener('pointermove',(e)=>{
        if(isAdjustingVOffset) return; // スライダ操作中は無効
        if(!swipeYActive) return; if(swipePointerId!=null && e.pointerId!==swipePointerId) return; const dy = e.clientY - swipeStartY;
        // ピクセル→半音→% に変換（dy > 0: 下へドラッグ → 表示範囲を下へ移動＝relSemi を増加）
        const deltaSemi = dy / (swipePxPerSemi||1);
        const newRelSemi = Math.max(0, Math.min(swipeAllowRangeSemi, swipeStartRelSemi + deltaSemi));
        verticalOffset = (swipeAllowRangeSemi>0)? Math.max(0, Math.min(100, Math.round((newRelSemi / swipeAllowRangeSemi)*100))) : 0;
        try{ if(typeof syncVerticalOffsetSliders==='function') syncVerticalOffsetSliders(); }catch(_){ }
        drawChart();
    });
    chartCanvas.addEventListener('pointerup',()=>{ swipeYActive=false; swipePointerId=null; });
    chartCanvas.addEventListener('pointercancel',()=>{ swipeYActive=false; swipePointerId=null; });
    chartCanvas.addEventListener('mousedown',(e)=>{
        if(isAdjustingVOffset) return; // スライダ操作中は無効
        const rect=chartCanvas.getBoundingClientRect(); const x=e.clientX-rect.left; const y=e.clientY-rect.top;
        if(_rangePending){
            // 2段階方式: 終点選択はボタンで行うため、ここでは無視
        }
    const idx=hitTestNote(x,y); if(idx!=null){ setSingleSelection(idx,{audition:true}); }
    });
    chartCanvas.addEventListener('mousemove',(e)=>{
        if(!draggingRange) return; const rect=chartCanvas.getBoundingClientRect(); const x=e.clientX-rect.left; const eff=playbackPosition+timelineOffsetSec; const playX=(chartCanvas&&chartCanvas.width)? getPlayX(chartCanvas.width):70; setRangeSelection(viewToTime(dragStartX,eff,playX), viewToTime(x,eff,playX));
    });
    chartCanvas.addEventListener('mouseup',()=>{ draggingRange=false; });
    // タッチ
    chartCanvas.addEventListener('touchstart',(e)=>{
        if(isAdjustingVOffset) return; // スライダ操作中は無効
        const t=e.touches[0]; if(!t) return;
        const total = verticalZoom*12; const min=36, max=132; const allowRange=Math.max(0,(max-min-total));
        swipeAllowRangeSemi=allowRange; swipeH=chartCanvas.height||1; swipePxPerSemi=(swipeH>0 && total>0)? (swipeH/total):1; swipeStartRelSemi=(verticalOffset/100)*allowRange; swipeStartY=t.clientY;
    },{passive:true});
    chartCanvas.addEventListener('touchmove',(e)=>{
        const t=e.touches[0]; if(!t) return;
        const dy = t.clientY - (swipeStartY||t.clientY);
        const deltaSemi = dy / (swipePxPerSemi||1);
        const newRelSemi = Math.max(0, Math.min(swipeAllowRangeSemi, swipeStartRelSemi + deltaSemi));
        verticalOffset = (swipeAllowRangeSemi>0)? Math.max(0, Math.min(100, Math.round((newRelSemi / swipeAllowRangeSemi)*100))) : 0;
        try{ if(typeof syncVerticalOffsetSliders==='function') syncVerticalOffsetSliders(); }catch(_){ }
        drawChart();
        e.preventDefault();
    },{passive:false});
    chartCanvas.addEventListener('touchend',()=>{ draggingRange=false; swipeStartY=0; });
}
// オクターブ補正適用（±12）
function applyOctaveShift(delta){
    const tr=currentTracks[melodyTrackIndex]; if(!tr||!tr.notes||!tr.notes.length) return;
    const notes=tr.notes; const clamp=(m)=> Math.max(36,Math.min(127,m));
    const sel=window._selection;
    if(sel.type==='single' && sel.index!=null){
        const idx=sel.index;
        const applyForward = !!(applyForwardToggle && applyForwardToggle.checked);
        const endIdx = applyForward? findPhraseEndIndex(idx): idx;
        for(let i=idx;i<=endIdx;i++){ notes[i].midi = clamp(notes[i].midi + delta); }
        setSingleSelection(idx);
    } else if(sel.type==='range' && sel.startSec!=null && sel.endSec!=null){
        for(let i=0;i<notes.length;i++){
            const st=notes[i].time, en=st+notes[i].duration;
            if(!(en<sel.startSec || st>sel.endSec)){
                notes[i].midi = clamp(notes[i].midi + delta);
            }
        }
    }
    autoCenterMelodyTrack();
    drawChart();
}
function applySemitoneShift(delta){
    autoCenterFrozen = true; // 以降の自動センタリングを停止
    const tr=currentTracks[melodyTrackIndex]; if(!tr||!tr.notes||!tr.notes.length) return;
    // 編集モード中は、実行直前に再生線下ノートへ選択を同期（範囲選択中は維持）
    try{
        if(editToolbar && !editToolbar.classList.contains('hidden')){
            const selNow = window._selection || {type:'none'};
            if(selNow.type !== 'range'){ setSelectionByPlayhead(); }
        }
    }catch(_){ }
    const notes=tr.notes; const clamp=(m)=> Math.max(36,Math.min(127,m)); const sel=window._selection;
    if(sel.type==='single' && sel.index!=null){
        const idx=sel.index; const applyForward = !!(applyForwardToggle && applyForwardToggle.checked);
        const endIdx = applyForward? findPhraseEndIndex(idx): idx;
        for(let i=idx;i<=endIdx;i++){ notes[i].midi = clamp(notes[i].midi + delta); }
        if(!applyForward){ try{ ensureAudio(); const m=clamp(notes[endIdx].midi); const d=Math.min(notes[endIdx].duration||0.4,0.6); simplePlaySfz(m,(audioCtx?audioCtx.currentTime:0)+0.02,d,masterGain||audioCtx?.destination); }catch(_){ } }
        setSingleSelection(idx,{audition:false});
    } else if(sel.type==='range' && sel.startSec!=null && sel.endSec!=null){
        for(let i=0;i<notes.length;i++){ const st=notes[i].time,en=st+notes[i].duration; if(!(en<sel.startSec || st>sel.endSec)){ notes[i].midi = clamp(notes[i].midi + delta); } }
    }
    autoCenterMelodyTrack();
    // ノート配列が変わったのでスケジュールをリセット
    scheduleAll(); if(isPlaying){ pausePlayback(); startPlayback(); } else { drawChart(); }
}
// キーボード操作: ↑/↓=±12、Shift併用で以降にも適用
window.addEventListener('keydown',(e)=>{ if(e.key==='ArrowUp' || e.key==='ArrowDown'){ const delta=(e.key==='ArrowUp')? +12 : -12; if(window._selection.type==='single' && window._selection.index!=null && e.shiftKey){ const prev=applyForwardToggle? applyForwardToggle.checked: false; if(applyForwardToggle) applyForwardToggle.checked=true; applyOctaveShift(delta); if(applyForwardToggle) applyForwardToggle.checked=prev; } else { applyOctaveShift(delta); } e.preventDefault(); } });
window.addEventListener('keydown',(e)=>{ if(e.key==='ArrowUp' || e.key==='ArrowDown'){ const delta=(e.key==='ArrowUp')? +12 : -12; if(window._selection.type==='single' && window._selection.index!=null && e.shiftKey){ const prev=applyForwardToggle? applyForwardToggle.checked: false; if(applyForwardToggle) applyForwardToggle.checked=true; applyOctaveShift(delta); if(applyForwardToggle) applyForwardToggle.checked=prev; } else { applyOctaveShift(delta); } e.preventDefault(); } else if(e.key==='[' || e.key===']'){ const d=(e.key===']')? +1 : -1; applySemitoneShift(d); e.preventDefault(); } });
// 採点オーバーレイのON/OFF: O キーで切り替え
window.addEventListener('keydown',(e)=>{ if(e.key==='o' || e.key==='O'){ scorePitchClassOverlay = !scorePitchClassOverlay; drawChart(); } });
// ガイドスナップ切替は当面無効化
// ボタン
if(clearSelectionBtn){ clearSelectionBtn.onclick=()=> clearSelection(); }
if(octDownBtn){ octDownBtn.onclick=()=> applyOctaveShift(-12); }
if(octUpBtn){ octUpBtn.onclick=()=> applyOctaveShift(+12); }

// 左端の全体オクターブボタン（＋/－）: メロディトラック全体を±12移動
const globalOctUpBtn = document.getElementById('globalOctUpBtn');
const globalOctDownBtn = document.getElementById('globalOctDownBtn');
function shiftAllMelodyNotes(delta){
    try{
        const tr = currentTracks[melodyTrackIndex];
        if(!tr || !Array.isArray(tr.notes) || !tr.notes.length) return;
        const clamp = (m)=> Math.max(36, Math.min(127, m));
        for(let i=0;i<tr.notes.length;i++){
            tr.notes[i].midi = clamp((tr.notes[i].midi|0) + delta);
        }
        // 自動センタリングは以降停止（ユーザ意図を優先）
        autoCenterFrozen = true;
        // スケジュール更新と再描画
        scheduleAll(); if(isPlaying){ pausePlayback(); startPlayback(); } else { drawChart(); }
    }catch(_){ }
}
function updateGlobalOctButtonsTooltip(){
    try{
        const up = document.getElementById('globalOctUpBtn');
        const dn = document.getElementById('globalOctDownBtn');
        if(!up || !dn) return;
        if(practiceMode==='basic'){
            up.title = '基礎練習: 赤破線ガイドの表示オクターブを+12（音は変わりません）';
            dn.title = '基礎練習: 赤破線ガイドの表示オクターブを-12（音は変わりません）';
        } else {
            up.title = 'メロディ全体を+12（編集）';
            dn.title = 'メロディ全体を-12（編集）';
        }
    }catch(_){ }
}
if(globalOctUpBtn){
    globalOctUpBtn.onclick = ()=>{
        if(practiceMode==='basic'){
            practiceCallDisplayOctShift = (practiceCallDisplayOctShift|0) + 12;
            // 表示範囲も合わせて寄せる（見やすさ優先）
            try{
                if(Array.isArray(midiGhostNotes) && midiGhostNotes.length){
                    let gMin=Infinity, gMax=-Infinity;
                    for(const n of midiGhostNotes){ const mm=(n.role==='call')? (n.midi + (practiceCallDisplayOctShift|0)) : n.midi; if(mm<gMin) gMin=mm; if(mm>gMax) gMax=mm; }
                    if(isFinite(gMin) && isFinite(gMax)) setVerticalOffsetToRange(gMin, gMax);
                }
            }catch(_){ }
            drawChart();
        } else {
            shiftAllMelodyNotes(+12);
        }
        updateGlobalOctButtonsTooltip();
    };
}
if(globalOctDownBtn){
    globalOctDownBtn.onclick = ()=>{
        if(practiceMode==='basic'){
            practiceCallDisplayOctShift = (practiceCallDisplayOctShift|0) - 12;
            try{
                if(Array.isArray(midiGhostNotes) && midiGhostNotes.length){
                    let gMin=Infinity, gMax=-Infinity;
                    for(const n of midiGhostNotes){ const mm=(n.role==='call')? (n.midi + (practiceCallDisplayOctShift|0)) : n.midi; if(mm<gMin) gMin=mm; if(mm>gMax) gMax=mm; }
                    if(isFinite(gMin) && isFinite(gMax)) setVerticalOffsetToRange(gMin, gMax);
                }
            }catch(_){ }
            drawChart();
        } else {
            shiftAllMelodyNotes(-12);
        }
        updateGlobalOctButtonsTooltip();
    };
}
// 半音ボタン
const semiDownBtn=document.getElementById('semiDownBtn');
const semiUpBtn=document.getElementById('semiUpBtn');
if(semiDownBtn){ semiDownBtn.onclick=()=> applySemitoneShift(-1); }
if(semiUpBtn){ semiUpBtn.onclick=()=> applySemitoneShift(+1); }
// 編集モードの表示切替（初期は非表示）。ボタンで show/hide をトグル
if(editModeToggle){
    editModeToggle.onclick=()=>{
        if(!editToolbar) return;
        if(editToolbar.classList.contains('hidden')){
            editToolbar.classList.remove('hidden');
            editToolbar.style.display='flex';
            // 編集モードに入ったら即、再生線下ノートを選択
            setSelectionByPlayhead();
        } else {
            editToolbar.classList.add('hidden');
            editToolbar.style.display='none';
        }
    };
}

// Undo/Redo スタック
const undoStack=[]; const redoStack=[]; const MAX_HISTORY=100;
function snapshotNotes(){ try{ const tr=currentTracks[melodyTrackIndex]; if(!tr||!tr.notes) return null; return tr.notes.map(n=>({midi:n.midi,time:n.time,duration:n.duration})); }catch(_){ return null; } }
function pushHistory(){ const snap=snapshotNotes(); if(!snap) return; undoStack.push(snap); if(undoStack.length>MAX_HISTORY) undoStack.shift(); redoStack.length=0; }
function restoreFromSnap(snap){ try{ const tr=currentTracks[melodyTrackIndex]; if(!tr) return; tr.notes = snap.map(n=>({midi:n.midi,time:n.time,duration:n.duration})); autoCenterMelodyTrack(); drawChart(); }catch(_){ }}
function doUndo(){ if(!undoStack.length) return; const current=snapshotNotes(); const prev=undoStack.pop(); if(current) redoStack.push(current); restoreFromSnap(prev); }
function doRedo(){ if(!redoStack.length) return; const current=snapshotNotes(); const next=redoStack.pop(); if(current) undoStack.push(current); restoreFromSnap(next); }
if(undoBtn){ undoBtn.onclick=()=> doUndo(); }
if(redoBtn){ redoBtn.onclick=()=> doRedo(); }
// ノート分割: 再生線位置で現在ノートを2つに分割
function splitCurrentNoteAtPlayhead(){
    try{
        const tr=currentTracks[melodyTrackIndex]; if(!tr||!tr.notes||!tr.notes.length) return;
        const t=playbackPosition; const notes=tr.notes;
        // 再生線下ノート探索
        let idx=-1; for(let i=0;i<notes.length;i++){ const n=notes[i]; if(t>n.time && t<n.time+n.duration){ idx=i; break; } }
        if(idx<0) return; const n=notes[idx];
        const rel = t - n.time; const remain = n.duration - rel; const MIN_DUR=0.05; // 50ms 未満は分割しない
        if(rel<MIN_DUR || remain<MIN_DUR) return; // 端すぎて無効
        pushHistory();
        // 元ノートを前半に短縮し後半ノートを挿入
        n.duration = rel;
        const newNote = { midi:n.midi, time:t, duration:remain };
        notes.splice(idx+1,0,newNote);
        // 後続が time 順であること維持（既に time=t 以降なのでOK）
        setSingleSelection(idx+1,{audition:false});
        scheduleAll(); drawChart();
    }catch(_){ }
}
const splitBtn=document.getElementById('splitNoteBtn'); if(splitBtn){ splitBtn.onclick=()=>{ splitCurrentNoteAtPlayhead(); }; }
// Ctrl+Z / Ctrl+Y
window.addEventListener('keydown',(e)=>{ if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='z'){ doUndo(); e.preventDefault(); } else if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='y'){ doRedo(); e.preventDefault(); } });

// 操作前に履歴保存（オクターブ適用時）
const _applyOctaveShiftOrig = applyOctaveShift;
applyOctaveShift = function(delta){ pushHistory(); _applyOctaveShiftOrig(delta); };
// 操作前に履歴保存（オクターブ/半音適用時）
const _applySemitoneShiftOrig = applySemitoneShift;
applySemitoneShift = function(delta){ pushHistory(); _applySemitoneShiftOrig(delta); };
function snapshotNotes(){ try{ const tr=currentTracks[melodyTrackIndex]; if(!tr||!tr.notes) return null; const notesSnap=tr.notes.map(n=>({midi:n.midi,time:n.time,duration:n.duration})); const marks={}; Object.keys(markers||{}).forEach(k=>{ const v=markers[k]; if(typeof v==='number') marks[k]=v; }); return {notes:notesSnap, markers:marks}; }catch(_){ return null; } }
function restoreFromSnap(snap){ try{ const tr=currentTracks[melodyTrackIndex]; if(!tr) return; if(Array.isArray(snap)){ tr.notes = snap.map(n=>({midi:n.midi,time:n.time,duration:n.duration})); } else if(snap && Array.isArray(snap.notes)){ tr.notes = snap.notes.map(n=>({midi:n.midi,time:n.time,duration:n.duration})); if(snap.markers){ Object.keys(snap.markers).forEach(k=>{ const v=snap.markers[k]; if(typeof v==='number') markers[k]=v; }); } } autoCenterMelodyTrack(); drawChart(); }catch(_){ }}

// 曲ごとの補正保存/復元（localStorage）
function getSongKey(){ try{ const n=(melodyAudioLabel&&melodyAudioLabel.textContent)||'unknown'; const d=Math.round((melodyBuffer&&melodyBuffer.duration)||0); return 'corr:'+n+':'+d; }catch(_){ return 'corr:unknown'; } }
// 旧: ローカルストレージへの補正保存/復元は削除

// MIDI参照の読み込みと連動補正（トラック選択対応）
if(midiRefBtn && midiRefInput){ midiRefBtn.onclick=()=> midiRefInput.click(); }
let _midiTracksCache=null; // [{notes:[{midi,st,en}], index}]
let _midiAlign={ detIdx:0, refIdx:0, scale:1.0 };
if(midiRefInput){ midiRefInput.onchange=async (e)=>{
    const f=e.target.files?.[0]; if(!f) return;
    try{
        const arr=await f.arrayBuffer();
        const parsed = parseMidiAllTracks(new Uint8Array(arr)); // [{notes:[{midi,st,en}], index}]
    if(!parsed || !parsed.length){ console.warn('MIDIから参照トラックを検出できませんでした'); return; }
        _midiTracksCache = parsed;
        if(parsed.length===1){
            // 単一トラックでも自動適用せず、まずは全体プレビュー（赤の破線）を表示（秒ベース）
            const refNotesSec = normalizeMidiToSeconds(parsed[0].notes);
            let mapped = applyAlignMapping(refNotesSec);
            mapped = Array.isArray(mapped)? mapped.slice().sort((a,b)=>a.time-b.time): [];
            midiGhostNotes = mapped;
            drawChart();
            // トラック選択は省略可だが、適用/生成と倍率UIは表示
            if(midiTrackSelect){ midiTrackSelect.style.display='none'; }
            if(midiApplyBtn){ midiApplyBtn.style.display='inline-block'; }
            if(midiGenerateBtn){ midiGenerateBtn.style.display='inline-block'; }
            buildAlignDropdowns(refNotesSec);
            if(midiAlignPanel) midiAlignPanel.style.display='flex';
        } else {
            // トラック選択UIを表示
            if(midiTrackSelect){
                midiTrackSelect.innerHTML='';
                parsed.forEach((tr, i)=>{
                    const opt=document.createElement('option');
                    opt.value=String(i);
                    opt.textContent=`MIDI Track ${i+1} (${tr.notes.length} notes)`;
                    midiTrackSelect.appendChild(opt);
                });
                midiTrackSelect.selectedIndex=0;
                midiTrackSelect.style.display='inline-block';
                // トラック選択でゴースト更新
                midiTrackSelect.onchange=()=>{
                    try{
                        const idx = midiTrackSelect.selectedIndex||0;
                        const refNotesSec = normalizeMidiToSeconds(_midiTracksCache[idx].notes);
                        let mapped = applyAlignMapping(refNotesSec);
                        mapped = Array.isArray(mapped)? mapped.slice().sort((a,b)=>a.time-b.time): [];
                        midiGhostNotes = mapped;
                        drawChart();
                    }catch(_){ }
                };
            }
            if(midiApplyBtn){ midiApplyBtn.style.display='inline-block'; }
            if(midiGenerateBtn){ midiGenerateBtn.style.display='inline-block'; }
            const refNotesSec = normalizeMidiToSeconds(parsed[0].notes);
            // トラック選択時点で全体プレビュー（秒ベース）
            let mapped0 = applyAlignMapping(refNotesSec);
            mapped0 = Array.isArray(mapped0)? mapped0.slice().sort((a,b)=>a.time-b.time): [];
            midiGhostNotes = mapped0;
            drawChart();
            buildAlignDropdowns(refNotesSec);
            if(midiAlignPanel) midiAlignPanel.style.display='flex';
        }
    }catch(err){ console.warn('MIDI参照の読み込みに失敗:', err); }
}; }
if(midiApplyBtn){ midiApplyBtn.onclick=()=>{
    if(!_midiTracksCache || !_midiTracksCache.length) return;
    const idx = Math.max(0, Math.min(_midiTracksCache.length-1, (midiTrackSelect && midiTrackSelect.selectedIndex) || 0));
    const refNotesRaw = normalizeMidiNotesForAlign(_midiTracksCache[idx].notes);
    const refNotes = applyAlignMapping(refNotesRaw);
    // 適用時はプレビューを消す
    midiGhostNotes = null;
    pushHistory(); alignOctaveToReferenceDP(refNotes);
    drawChart();
}; }
// MIDIからノーツ生成
if(midiGenerateBtn){ midiGenerateBtn.onclick=()=>{
    if(!_midiTracksCache || !_midiTracksCache.length){ console.warn('先にMIDIを読み込んでください'); return; }
    const idx = Math.max(0, Math.min(_midiTracksCache.length-1, (midiTrackSelect && midiTrackSelect.selectedIndex) || 0));
    const ref = _midiTracksCache[idx];
    // 生成先はメロディトラック
    const notesRaw = normalizeMidiToSeconds(ref.notes);
    const notes = applyAlignMapping(notesRaw);
    if(!Array.isArray(notes) || !notes.length){ console.warn('MIDIから有効なノーツを生成できませんでした'); return; }
    // 現在のメロディトラックに置換
    pushHistory();
    currentTracks[melodyTrackIndex] = { notes: notes.map(n=>({ midi:n.midi, time:n.time, duration:n.duration })) };
    // ノーツ全置換: 自動センタリングを再有効化して適用
    autoCenterFrozen = false;
    autoCenterMelodyTrack();
    // 生成後はプレビューを消す
    midiGhostNotes = null;
    drawChart();
    // 成功メッセージのダイアログは表示しない
}; }

function normalizeMidiNotesForAlign(trackNotes){
    // [{midi, st, en}] -> [{midi, time, duration}] 相対tickベースでよい
    if(!Array.isArray(trackNotes) || !trackNotes.length) return [];
    const minT = Math.min(...trackNotes.map(n=>n.st));
    return trackNotes.map(n=>({ midi:n.midi, time:(n.st-minT), duration:(n.en-n.st) }));
}

// 対応調整: UI構築（先頭いくつかの候補を表示）
function buildAlignDropdowns(refNotes){
    try{
        if(!midiAlignDetStart || !midiAlignRefStart) return;
        // 解析側（検出済みメロディ）
        const det = (currentTracks[melodyTrackIndex]?.notes)||[];
        const detOpts = det.map((n,i)=>({ i, label:`#${i+1} ${noteLabel(n.midi)} @${n.time.toFixed(2)}s` }));
        midiAlignDetStart.innerHTML='';
        detOpts.slice(0,200).forEach(o=>{ const opt=document.createElement('option'); opt.value=String(o.i); opt.textContent=o.label; midiAlignDetStart.appendChild(opt); });
        // 参照側（MIDI）
        const refOpts = refNotes.map((n,i)=>({ i, label:`#${i+1} ${noteLabel(n.midi)} t${n.time}` }));
        midiAlignRefStart.innerHTML='';
        refOpts.slice(0,200).forEach(o=>{ const opt=document.createElement('option'); opt.value=String(o.i); opt.textContent=o.label; midiAlignRefStart.appendChild(opt); });
        // 既定
        midiAlignDetStart.value='0'; midiAlignRefStart.value='0';
        _midiAlign={ detIdx:0, refIdx:0, scale:1.0 };
        if(midiAlignScale) midiAlignScale.value='1.0';
        updateAlignInfo();
        // イベント
        const onAlignChanged = ()=>{
            updateAlignInfo();
            // ゴースト更新（現在選択中トラック優先、なければ先頭）
            try{
                const idx = (midiTrackSelect && midiTrackSelect.style.display!=='none')? (midiTrackSelect.selectedIndex||0) : 0;
                const src = (_midiTracksCache && _midiTracksCache.length)? _midiTracksCache[Math.max(0,Math.min(idx,_midiTracksCache.length-1))]: null;
                const base = src? normalizeMidiToSeconds(src.notes): refNotes;
                let mapped = applyAlignMapping(base);
                mapped = Array.isArray(mapped)? mapped.slice().sort((a,b)=>a.time-b.time): [];
                midiGhostNotes = mapped;
                drawChart();
            }catch(_){ }
        };
        midiAlignDetStart.onchange=()=>{ _midiAlign.detIdx=parseInt(midiAlignDetStart.value)||0; onAlignChanged(); };
        midiAlignRefStart.onchange=()=>{ _midiAlign.refIdx=parseInt(midiAlignRefStart.value)||0; onAlignChanged(); };
        if(midiAlignScale){ midiAlignScale.oninput=()=>{ _midiAlign.scale=parseFloat(midiAlignScale.value)||1.0; onAlignChanged(); }; }
        if(midiAlignFitEnds){
            midiAlignFitEnds.onclick=()=>{
                try{
                    // 現在の選択トラック（なければ先頭）から参照MIDI（秒ベース）を取得
                    const idx = (midiTrackSelect && midiTrackSelect.style.display!=='none')? (midiTrackSelect.selectedIndex||0) : 0;
                    const src = (_midiTracksCache && _midiTracksCache.length)? _midiTracksCache[Math.max(0,Math.min(idx,_midiTracksCache.length-1))]: null;
                    if(!src) return;
                    const ref = normalizeMidiToSeconds(src.notes);
                    if(!ref.length) return;
                    // 検出メロディ（実ノーツ）
                    const det = (currentTracks[melodyTrackIndex]?.notes)||[];
                    if(!det.length) return;
                    // 先頭と最後のノーツの時間
                    const detT0 = det[0].time;
                    const detT1 = det[det.length-1].time + det[det.length-1].duration;
                    const refT0 = ref[0].time;
                    const refT1 = ref[ref.length-1].time + ref[ref.length-1].duration;
                    const detSpan = Math.max(1e-6, detT1 - detT0);
                    const refSpan = Math.max(1e-6, refT1 - refT0);
                    // 現仕様の applyAlignMapping は detIdx/refIdx を起点とするオフセットも加える。
                    // 両端合わせの意図に合わせるため、起点は0に固定してスケールのみ算出し、UIにも反映。
                    _midiAlign.detIdx = 0;
                    _midiAlign.refIdx = 0;
                    const scale = detSpan / refSpan;
                    _midiAlign.scale = scale;
                    if(midiAlignScale){ midiAlignScale.value = String(scale.toFixed(3)); }
                    onAlignChanged();
                }catch(_){ }
            };
        }
    }catch(e){ console.warn('buildAlignDropdowns failed', e); }
}
function updateAlignInfo(){
    try{
    if(!midiAlignInfo) return;
    midiAlignInfo.textContent = `det#${_midiAlign.detIdx+1} ⇔ ref#${_midiAlign.refIdx+1}, scale ${_midiAlign.scale.toFixed(3)}`;
    }catch(_){ }
}
// 調整適用: refNotes/timeを「refの起点→detの起点」に合わせ、倍率scaleで伸縮
function applyAlignMapping(refNotes){
    try{
        if(!Array.isArray(refNotes)||!refNotes.length) return refNotes;
        const det = (currentTracks[melodyTrackIndex]?.notes)||[];
        const di = Math.max(0, Math.min(det.length-1, _midiAlign.detIdx|0));
        const ri = Math.max(0, Math.min(refNotes.length-1, _midiAlign.refIdx|0));
        const scale = (typeof _midiAlign.scale==='number' && isFinite(_midiAlign.scale) && _midiAlign.scale>0)? _midiAlign.scale: 1.0;
        const detT0 = det[di]? det[di].time: 0;
        const refT0 = refNotes[ri]? refNotes[ri].time: 0;
        return refNotes.map(n=>({
            midi: n.midi,
            time: detT0 + (n.time - refT0) * scale,
            duration: (n.duration||0) * scale
        }));
    }catch(_){ return refNotes; }
}

// MIDI tick → 秒 変換を伴う生成（仮: テンポ200ms/四分音符相当でスケーリング or 音声長に合わせる）
function normalizeMidiToSeconds(trackNotes){
    // 暫定: 音声の長さに合わせてスケーリング（メロディ音声があればそちらを優先）
    if(!Array.isArray(trackNotes) || !trackNotes.length) return [];
    const stMin = Math.min(...trackNotes.map(n=>n.st));
    const stMax = Math.max(...trackNotes.map(n=>n.en));
    const tickSpan = Math.max(1, stMax - stMin);
    const audioSpan = (melodyBuffer?.duration) || (accompBuffer?.duration) || 60; // 音声が無ければ仮に60秒
    const scale = audioSpan / tickSpan;
    return trackNotes.map(n=>({ midi:n.midi, time:(n.st-stMin)*scale, duration:(n.en-n.st)*scale }));
}

// 参照MIDIに対し、動的計画法で±12整合（連続性重視）
function alignOctaveToReferenceDP(ref){
    try{
        const tr=currentTracks[melodyTrackIndex]; if(!tr||!tr.notes||!tr.notes.length) return;
        const notes=tr.notes;
        const N=Math.min(ref.length, notes.length); if(N<=0) return;
        // 各ノートに対して候補: m+12k, k in {-2,-1,0,1,2}
        const K=[-2,-1,0,1,2];
        const C=new Array(N); // costs
        const P=new Array(N); // backpointers
        const LAMBDA_JUMP=3.0;   // 隣接ノート間のオクターブジャンプの罰
        const LAMBDA_DIFF=0.8;   // refとの半音差コスト係数
        const LAMBDA_OCT=0.6;    // ±12そのものの罰
        for(let i=0;i<N;i++){
            C[i]=new Array(K.length).fill(Infinity);
            P[i]=new Array(K.length).fill(-1);
            const refM=ref[i].midi;
            for(let a=0;a<K.length;a++){
                const m0 = notes[i].midi + K[a]*12;
                const d = Math.abs(m0 - refM);
                const octAbs = Math.abs(K[a]);
                const obs = LAMBDA_DIFF * d + LAMBDA_OCT * octAbs; // 観測コスト
                if(i===0){ C[i][a]=obs; continue; }
                // 遷移コスト
                let best=Infinity, bestA=-1;
                for(let b=0;b<K.length;b++){
                    const trans = LAMBDA_JUMP * Math.abs(K[a]-K[b]);
                    const val = C[i-1][b] + obs + trans;
                    if(val<best){ best=val; bestA=b; }
                }
                C[i][a]=best; P[i][a]=bestA;
            }
        }
        // 後ろ向きに最良列を復元
        let lastA=0, lastCost=Infinity;
        for(let a=0;a<K.length;a++){ if(C[N-1][a]<lastCost){ lastCost=C[N-1][a]; lastA=a; } }
        for(let i=N-1;i>=0;i--){
            const k=K[lastA];
            notes[i].midi = notes[i].midi + k*12;
            lastA = (i>0? P[i][lastA]: -1);
            if(lastA<0 && i>0){ // フォールバック
                let best=0, cost=Infinity; for(let a=0;a<K.length;a++){ if(C[i-1][a]<cost){ cost=C[i-1][a]; best=a; } } lastA=best;
            }
        }
    }catch(_){ /* ignore */ }
}

// 簡易MIDIパーサ全トラック版（Type0/1）: 各トラックのNoteOn/Offを抽出
function parseMidiAllTracks(u8){
    try{
        const dv=new DataView(u8.buffer,u8.byteOffset,u8.byteLength);
        let p=0; function readStr(len){ let s=''; for(let i=0;i<len;i++) s+=String.fromCharCode(dv.getUint8(p++)); return s; }
        function readU32(){ const v=dv.getUint32(p); p+=4; return v; }
        function readU16(){ const v=dv.getUint16(p); p+=2; return v; }
        if(readStr(4)!=='MThd') return [];
        const hdrLen=readU32(); const format=readU16(); const ntr=readU16(); const division=readU16(); p = 8+6; // skip to after header
        const tracks=[];
        for(let t=0;t<ntr;t++){
            const id=readStr(4); const len=readU32(); if(id!=='MTrk'){ p+=len; continue; }
            const end=p+len; let curTime=0; let runningStatus=0; const events=[];
            function readVar(){ let v=0; while(true){ const b=dv.getUint8(p++); v=(v<<7)|(b&0x7F); if(!(b&0x80)) break; } return v; }
            while(p<end){ const dt=readVar(); curTime+=dt; let st=dv.getUint8(p++); if(st<0x80){ p--; st=runningStatus; } else { runningStatus=st; }
                if((st&0xF0)===0x90 || (st&0xF0)===0x80){ const note=dv.getUint8(p++); const vel=dv.getUint8(p++); events.push({t:curTime, type:(st&0xF0), note, vel}); }
                else if(st===0xFF){ const meta=dv.getUint8(p++); const len=readVar(); p+=len; }
                else { const hi=st&0xF0; const cons = (hi===0xC0||hi===0xD0)? 1: 2; p+=cons; }
            }
            const onMap=new Map(); const notes=[];
            events.forEach(ev=>{
                if(ev.type===0x90 && ev.vel>0){ onMap.set(ev.note, ev.t); }
                else if((ev.type===0x80) || (ev.type===0x90 && ev.vel===0)){ const st=onMap.get(ev.note); if(st!=null){ notes.push({midi:ev.note, st, en:ev.t}); onMap.delete(ev.note); } }
            });
            tracks.push({ index:t, notes });
        }
        return tracks.filter(tr=> tr.notes && tr.notes.length>0).sort((a,b)=> b.notes.length - a.notes.length);
    }catch(_){ return []; }
}

// 旧API: 簡易MIDIパーサ（Type0/1, 単純化）: 最も音数の多いモノフォニック近似トラックをメロディとみなす
function parseMidiMelody(u8){
    // 依存なしの超簡易読み取り（完全対応ではない）。失敗時は空配列。
    try{
        // ここでは簡略化のため、既存のMIDI解析は最小限のヘッダとデルタタイム、NoteOn/Offのみ対応
        // 実運用で精度が必要なら外部ライブラリ導入を検討
        const dv=new DataView(u8.buffer,u8.byteOffset,u8.byteLength);
        let p=0; function readStr(len){ let s=''; for(let i=0;i<len;i++) s+=String.fromCharCode(dv.getUint8(p++)); return s; }
        function readU32(){ const v=dv.getUint32(p); p+=4; return v; }
        function readU16(){ const v=dv.getUint16(p); p+=2; return v; }
        if(readStr(4)!=='MThd') return [];
        const hdrLen=readU32(); const format=readU16(); const ntr=readU16(); const division=readU16(); p = 8+6; // 先頭からの相対
        const tracks=[];
        for(let t=0;t<ntr;t++){
            const id=readStr(4); const len=readU32(); if(id!=='MTrk'){ p+=len; continue; }
            const end=p+len; let curTime=0; let runningStatus=0; const events=[];
            function readVar(){ let v=0; while(true){ const b=dv.getUint8(p++); v=(v<<7)|(b&0x7F); if(!(b&0x80)) break; } return v; }
            while(p<end){ const dt=readVar(); curTime+=dt; let st=dv.getUint8(p++); if(st<0x80){ p--; st=runningStatus; } else { runningStatus=st; }
                if((st&0xF0)===0x90 || (st&0xF0)===0x80){ const note=dv.getUint8(p++); const vel=dv.getUint8(p++); events.push({t:curTime, type:(st&0xF0), note, vel}); }
                else if(st===0xFF){ const meta=dv.getUint8(p++); const len=readVar(); p+=len; }
                else { // その他: 長さ決め打ち処理
                    const hi=st&0xF0; const cons = (hi===0xC0||hi===0xD0)? 1: 2; p+=cons; }
            }
            // NoteOn/Off からノートへ
            const onMap=new Map(); const notes=[];
            events.forEach(ev=>{
                if(ev.type===0x90 && ev.vel>0){ onMap.set(ev.note, ev.t); }
                else if((ev.type===0x80) || (ev.type===0x90 && ev.vel===0)){ const st=onMap.get(ev.note); if(st!=null){ notes.push({midi:ev.note, st, en:ev.t}); onMap.delete(ev.note); } }
            });
            tracks.push({notes});
        }
        // 最もノート数の多いトラックを採用
        tracks.sort((a,b)=> (b.notes.length)-(a.notes.length));
        const picked=(tracks[0]?.notes)||[]; if(!picked.length) return [];
        // 時間正規化（division仮定: 480ticks/四分 ≒ 120bpmで秒換算は不明→縦相対比較に使うため比率のみ利用）
        // 実用ではオーディオとMIDIの整合にユーザーマーカー/頭合わせを使うのが良い
        const minT=Math.min(...picked.map(n=>n.st));
        const res=picked.map(n=>({ midi:n.midi, time:(n.st-minT), duration:(n.en-n.st) }));
        return res;
    }catch(_){ return []; }
}

// 参照MIDIにオクターブを整合（相対的に最も近い±12へ）
function alignOctaveToReference(ref){ return alignOctaveToReferenceDP(ref); }
function noteLabel(midi){
    const namesCDE=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    const namesDo=['ド','ド#','レ','レ#','ミ','ファ','ファ#','ソ','ソ#','ラ','ラ#','シ'];
    const names = labelNotation==='ドレミ'? namesDo : namesCDE; const o=Math.floor(midi/12)-1; return names[midi%12]+o; }
// 旧テンポ関連を撤去。ノート配列は秒単位 time/duration のみを使用。
function buildTimesFromTicks(){ /* no-op: MIDI撤去 */ }

// ---- アドバイス機能 ----
function noteName(pc){
    const namesCDE=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    const namesDo=['ド','ド#','レ','レ#','ミ','ファ','ファ#','ソ','ソ#','ラ','ラ#','シ'];
    const arr = labelNotation==='ドレミ'? namesDo : namesCDE;
    return arr[((pc%12)+12)%12];
}
function buildAdviceText(){
    if(!scoreStats || scoreStats.total<5) return 'データが十分ではありません。まずは再生して歌ってください。';
    const hi=[], lo=[], stable=[], unstable=[];
    for(let pc=0; pc<12; pc++){
        const b=scoreStats.bins[pc]; if(!b||b.count<3) continue;
        const avg=b.sum/b.count; const avgAbs=b.sumAbs/b.count; const tolRate=(b.inTol/Math.max(1,b.count));
        if(avg>=5 && b.sharp > b.flat) hi.push({pc, avg});
        if(avg<=-5 && b.flat > b.sharp) lo.push({pc, avg});
        if(avgAbs<=6 && tolRate>=0.75) stable.push({pc, tolRate});
        if(avgAbs>=12 && tolRate<0.6) unstable.push({pc, avgAbs});
    }
    hi.sort((a,b)=> Math.abs(b.avg)-Math.abs(a.avg));
    lo.sort((a,b)=> Math.abs(b.avg)-Math.abs(a.avg));
    stable.sort((a,b)=> b.tolRate-a.tolRate);
    unstable.sort((a,b)=> b.avgAbs-a.avgAbs);
    const fmtList=(arr, prop, suffix='')=> arr.slice(0,6).map(o=> `${noteName(o.pc)}${suffix}`).join(' ');
    const totalIn = scoreStats.bins.reduce((s,b)=> s + (b?.inTol||0), 0);
    const totalCnt = scoreStats.bins.reduce((s,b)=> s + (b?.count||0), 0);
    const hitRate = totalCnt? (totalIn/totalCnt*100) : 0;
    const lines=[];
    if(hi.length) lines.push(`高め: ${fmtList(hi,'avg')}`);
    if(lo.length) lines.push(`低め: ${fmtList(lo,'avg')}`);
    if(unstable.length) lines.push(`不安定: ${fmtList(unstable,'avgAbs')}`);
    if(stable.length) lines.push(`安定: ${fmtList(stable,'tolRate')}`);
    lines.push(`命中率: ${hitRate.toFixed(1)}%`);
    if(hi.length||lo.length||unstable.length){
        lines.push('対策: 進入（音の入り）を丁寧に。高め→息圧を早めに落ち着かせる / 低め→声帯を立ち上げて早めに共鳴ポイントへ。');
    } else {
        lines.push('良好: 大きな偏りはありません。この調子でフレーズ終端の収まりを磨きましょう。');
    }
    return lines.join('\n');
}
function drawAdviceBars(){ /* グラフ機能はユーザー要望で無効化 */ if(_adviceCtx&&adviceCanvas){ try{ _adviceCtx.clearRect(0,0,adviceCanvas.width, adviceCanvas.height); }catch(_){ } } }
function openAdvice(){ if(advicePanel) advicePanel.style.display='block'; if(adviceTextEl) adviceTextEl.textContent = buildAdviceText(); /* グラフ呼び出し削除 */ }
function closeAdvice(){ if(advicePanel) advicePanel.style.display='none'; }
if(adviceBtn){ adviceBtn.onclick = ()=> openAdvice(); }
if(adviceCloseBtn){ adviceCloseBtn.onclick = ()=> closeAdvice(); }

// マイク安定化ヘルプ（開閉と外側クリックで閉じる）
(function(){
    try{
        const micHelpBtn = document.getElementById('micHelpBtn');
        const micHelpPanel = document.getElementById('micHelpPanel');
        const micHelpClose = document.getElementById('micHelpClose');
        if(!micHelpPanel) return; // パネルが無ければ何もしない
        function openMicHelp(){ micHelpPanel.style.display='block'; }
        function closeMicHelp(){ micHelpPanel.style.display='none'; }
        if(micHelpBtn){
            micHelpBtn.addEventListener('click', (e)=>{
                e.stopPropagation();
                const isOpen = micHelpPanel.style.display !== 'none' && micHelpPanel.style.display !== '';
                if(isOpen) closeMicHelp(); else openMicHelp();
            });
        }
        if(micHelpClose){
            micHelpClose.addEventListener('click', (e)=>{ e.stopPropagation(); closeMicHelp(); });
        }
        // パネル外クリックで閉じる（他パネルへの影響を避ける）
        document.addEventListener('click', (e)=>{
            try{
                if(!micHelpPanel || micHelpPanel.style.display==='none') return;
                const t = e.target;
                if(t instanceof Node){
                    if(micHelpPanel.contains(t)) return; // 内側なら維持
                    if(micHelpBtn && micHelpBtn.contains && micHelpBtn.contains(t)) return; // ボタン自体
                }
                closeMicHelp();
            }catch(_){ /* ignore */ }
        });
        // Esc キーで閉じる
        document.addEventListener('keydown', (e)=>{ if(e.key==='Escape'){ closeMicHelp(); } });
    }catch(e){ console.warn('micHelp wiring failed', e); }
})();

// グローバルヘルプ（開閉と外側クリック/Escで閉じる）
(function(){
    try{
        const helpBtn = document.getElementById('globalHelpBtn');
        const panel = document.getElementById('globalHelpPanel');
        const closeBtn = document.getElementById('globalHelpClose');
        if(!panel) return;
        function openHelp(){ panel.style.display='block'; }
        function closeHelp(){ panel.style.display='none'; }
        if(helpBtn){
            helpBtn.addEventListener('click', (e)=>{
                e.stopPropagation();
                const isOpen = panel.style.display !== 'none' && panel.style.display !== '';
                if(isOpen) closeHelp(); else openHelp();
            });
        }
        if(closeBtn){ closeBtn.addEventListener('click', (e)=>{ e.stopPropagation(); closeHelp(); }); }
        document.addEventListener('click', (e)=>{
            if(!panel || panel.style.display==='none') return;
            const t = e.target;
            if(t instanceof Node){
                if(panel.contains(t)) return;
                if(helpBtn && helpBtn.contains && helpBtn.contains(t)) return;
            }
            closeHelp();
        });
        document.addEventListener('keydown', (e)=>{ if(e.key==='Escape'){ closeHelp(); } });
    }catch(e){ console.warn('globalHelp wiring failed', e); }
})();

// 単音（モノフォニック）トラック検出: 同時発音が無いトラックを返す（複数ある場合はノート数が多い順）
function findMonophonicTracks(){
    const res=[];
    currentTracks.forEach((tr,idx)=>{
        const notes=(tr.notes||[]).slice().sort((a,b)=>a.time-b.time);
        if(!notes.length) return;
        let ok=true; let lastEnd=-Infinity;
        for(const n of notes){ if(n.time < lastEnd - 1e-6){ ok=false; break; } lastEnd = Math.max(lastEnd, n.time + n.duration); }
        if(ok) res.push({idx, count: notes.length});
    });
    res.sort((a,b)=> b.count - a.count);
    return res.map(o=>o.idx);
}

function autoSelectMelodyTrackIfMonophonic(){
    const monos=findMonophonicTracks();
    if(monos.length){
        melodyTrackIndex=monos[0];
        populateTrackSelectors();
    }
}

// トラックセレクタを現在の譜面内容で更新（要素が無ければ黙ってスキップ）
function populateTrackSelectors(){
    try{
        const tracks = Array.isArray(currentTracks)? currentTracks: [];
        // メロディ選択プルダウン
        if(melodySel){
            // 既存をクリア
            while(melodySel.firstChild) melodySel.removeChild(melodySel.firstChild);
            tracks.forEach((t, i)=>{
                const opt=document.createElement('option');
                const count = (t && Array.isArray(t.notes))? t.notes.length: 0;
                opt.value=String(i);
                opt.textContent = `Track ${i+1} (${count} notes)`;
                if(i===melodyTrackIndex) opt.selected=true;
                melodySel.appendChild(opt);
            });
            // 範囲外なら0に丸め
            const idx = Math.max(0, Math.min(melodyTrackIndex, Math.max(0, tracks.length-1)));
            melodySel.value = String(idx);
        }
        // 伴奏表示用（現在は読み取り専用の補助表示）
        if(accompSel){
            while(accompSel.firstChild) accompSel.removeChild(accompSel.firstChild);
            const opt=document.createElement('option');
            opt.value='auto';
            const accompCount = tracks.reduce((a, t, i)=> a + ((i===melodyTrackIndex)? 0: ((t?.notes?.length)||0)), 0);
            opt.textContent = `Auto (melody除く全トラック, total ${accompCount} notes)`;
            accompSel.appendChild(opt);
            accompSel.disabled = true; // 現行UIではメロディのみ変更
        }
        // トラック→音源割当の簡易グリッド（未実装のため省略、安全に何もしない）
        // trackInstrumentGrid が存在しても、ここでは変更しない（将来の詳細UIに委ねる）
    }catch(e){ console.warn('populateTrackSelectors failed', e); }
}

// fflate を動的ロード（未定義やダミーのとき）
async function loadFflateDynamic(){
    function isStub(){
        try{
            if(typeof fflate==='undefined') return true;
            if(typeof fflate.unzipSync!=='function') return true;
            const s=String(fflate.unzipSync);
            if(/本物のライブラリを配置してください/.test(s)) return true;
        }catch(_){ return true; }
        return false;
    }
    if(!isStub()) return true;
    // まずローカルの assets/libs を再注入試行
    await new Promise((res)=>{
        const s=document.createElement('script'); s.src='assets/libs/fflate.min.js'; s.async=true; s.onload=()=>res(true); s.onerror=()=>res(false); document.head.appendChild(s);
    });
    if(!isStub()) return true;
    // 最後にCDNを試す（オフラインでは失敗しても良い）
    await new Promise((res)=>{
        const s=document.createElement('script'); s.src='https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.min.js'; s.async=true; s.onload=()=>res(true); s.onerror=()=>res(false); document.head.appendChild(s);
    });
    return !isStub();
}
// ---- Playback core (missing helpers) ----
function startPlayback(){
    if(isPlaying) return;
    ensureAudio(); tuneCompressor();
    // 音源未ロード時 or 音程モードでは「無音再生」: マイク解析のみで赤点を記録
    const practiceMode = (function(){
        let hasAny=false;
        try{ if(melodyBuffer) hasAny=true; if(accompBuffer) hasAny=true; if(Array.isArray(melodyParts)){ for(const p of melodyParts){ if(p&&p.buffer){ hasAny=true; break; } } } }catch(_){ }
        // isPitchOnlyMode が true の場合は、音源があっても強制的に無音側へ
        if(isPitchOnlyMode) return true;
        return !hasAny;
    })();
    try{ if(audioCtx.state!=='running'){ audioCtx.resume().catch(()=>{}); } }catch(_){ }
    isPlaying=true;
    const START_LAT=0.02; const startLead = 0; // btLatencySec は scheduleMore 側で補正する（ここでは加算しない）
    playbackStartTime=audioCtx.currentTime + START_LAT + startLead;
    playbackStartPerf=performance.now()/1000 + START_LAT + startLead;
    playbackStartPos=playbackPosition;
    stopAllSources();
    // ドリフト統計初期化
    try{ if(window.__driftStats){ window.__driftStats.samples=0; window.__driftStats.avg=0; window.__driftStats.max=0; window.__driftStats.last=0; const el=document.getElementById('driftOverlay'); if(el) el.textContent='Drift(start)'; }
        const el=document.getElementById('driftOverlay'); if(el){ el.textContent+=''; }
    }catch(_){ }
    if(!practiceMode){
        // マルチパート: 有効パートのみ同時再生
        try{ melodySources.forEach(s=>{ try{s.stop(0);}catch(_){}}); }catch(_){ } melodySources=[];
        if(Array.isArray(melodyParts)){
            for(let i=0;i<melodyParts.length;i++){
                const p = melodyParts[i];
                if(!p || !p.buffer) continue;
                if(!p.playAudio) continue;
                const s = createAndStartSource(p.buffer, playbackStartTime, playbackPosition, melodyGain||masterGain||audioCtx.destination);
                if(s) melodySources.push(s);
            }
        } else if(melodyBuffer){
            // フォールバック: 旧単一
            melodySource=createAndStartSource(melodyBuffer, playbackStartTime, playbackPosition, melodyGain||masterGain||audioCtx.destination);
        }
        if(accompBuffer){ accompSource=createAndStartSource(accompBuffer, playbackStartTime, playbackPosition, accompGain||masterGain||audioCtx.destination); }
    } else {
        // 自動ではプロンプトしない。権限が granted のときだけ静かに初期化。
    if(!micAnalyser || !micData){ try{ canInitMicWithoutPrompt().then(ok=>{ if(ok) initMic(false).catch(()=>{}); }); }catch(_){ } }
    }
    if(analysisTimer){ clearInterval(analysisTimer); analysisTimer=null; }
    analysisTimer=setInterval(analyzePitch, 1000/analysisRate);
    // 音程モード（無音再生）でも進行ループは必ず起動
    requestAnimationFrame(loop);
    // 採点開始: 統計をリセット
    try{
        scoreSessionId++;
        scoreStats = { total:0, bins: Array.from({length:12},()=>({count:0,sum:0,sumAbs:0,inTol:0,outTol:0,sharp:0,flat:0})) };
    }catch(_){ scoreStats=null; }
    // 停止アドバイス保留があればキャンセル
    if(_pauseAdviceTimer){ try{ clearTimeout(_pauseAdviceTimer); }catch(_){} _pauseAdviceTimer=null; }
    // 練習モードでもダイアログは表示しない
}
function pausePlayback(){
    isPlaying=false;
    try{ console.warn('[pausePlayback] called at pos=', (playbackPosition||0).toFixed(3)); }catch(_){ }
    try{ if(schedTimer) clearInterval(schedTimer); schedTimer=null; }catch(_){ }
    stopAllSources();
    forceStopAllVoices();
    // 次回再生に備えて先読み境界をリセット
    scheduleAll();
    // アドバイスの自動表示はしない（ボタンで開く方式）。保留タイマーはクリアのみ。
    if(_pauseAdviceTimer){ try{ clearTimeout(_pauseAdviceTimer); }catch(_){} _pauseAdviceTimer=null; }
}

// 再生中の全ノード（サンプル/リリース/シンセ）を強制停止
function forceStopAllVoices(){
    try{
        const now=audioCtx? audioCtx.currentTime: 0;
        // サンプル本体/リリース
        activeSampleVoices.forEach(v=>{
            try{ if(v.g && v.g.gain){ v.g.gain.cancelScheduledValues(now); v.g.gain.setValueAtTime(0.0001, now); } }catch(_){ }
            try{ if(v.src && v.src.stop) v.src.stop(0); }catch(_){}
            try{ if(v.rsrc && v.rsrc.stop) v.rsrc.stop(0); }catch(_){}
            try{ if(v.g && v.g.disconnect) v.g.disconnect(); }catch(_){}
        });
        activeSampleVoices=[];
    }catch(_){ }
    try{
        // シンセ
        activeVoices.forEach(v=>{ try{ v.nodes.forEach(n=>{ try{ if(n.stop) n.stop(0); }catch(_){ } try{ if(n.disconnect) n.disconnect(); }catch(_){ } }); }catch(_){ } });
        activeVoices=[];
    }catch(_){ }
}
function updatePlaybackPosition(){ if(!isPlaying||!audioCtx) return; const dt=Math.max(0, audioCtx.currentTime - playbackStartTime); playbackPosition = playbackStartPos + dt; }

// ---- Playback position hybrid clock ----
// AudioContext.currentTime が環境要因で著しく遅れる場合に備え、performance.now() を併用
let playbackStartPerf=0; // 秒（performance.now/1000）
const IS_MOBILE = /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(navigator.userAgent||'');
const IS_MOBILE_PCPIPE = IS_MOBILE && USE_PC_PIPELINE_ON_MOBILE;
let _lastFrameTime=performance.now();
let _frameAccum=0, _frameCnt=0, _lastPerfLog=performance.now();
let _frameSkipToggle=false;
// === Drift 強制用制御フラグ ===
// 高ドリフト環境で AudioContext.currentTime 依存を放棄し performance.now() ベースに切替える
// 判定条件は loop() 内で driftStats を参照して自動更新
let FORCE_PERF_CLOCK=false; // true なら perfDt をそのまま採用
let _driftForceState='idle'; // 'idle' | 'armed' | 'forcing'
const DRIFT_FORCE_AVG_MS=150;      // 平均乖離閾値
const DRIFT_FORCE_SAMPLES=60;      // 最低サンプル数
const DRIFT_FORCE_HYST_MS=90;      // 解除のためのヒステリシス(平均がこの値未満に戻る)
let _lastDriftDecisionAt=0;
// ==== 将来最適化予定: 静的レイヤ (ノート/グリッド) と動的レイヤ (再生線/赤点) の分離描画 ====
// 実装方針メモ:
// 1) noteGridCanvas, dynamicCanvas の2枚用意し chartContainer にスタック
// 2) ノート/背景はズームやノート編集が起きた時だけ再描画
// 3) 毎フレームは dynamicCanvas に再生線・赤点・ゴーストのみ
// 4) これによりモバイルでの CPU/GPU 負荷と jank を低減
// フラグ（true で二層化を有効化する想定。現段階では未使用）
let USE_STATIC_LAYER_OPT=false;
function updatePlaybackPositionHybrid(){
    if(!isPlaying||!audioCtx) return;
    try{
        const nowPerf = performance.now()/1000;
        const ctxDt = Math.max(0, audioCtx.currentTime - playbackStartTime);
        const perfDt = Math.max(0, nowPerf - playbackStartPerf);
        let usePerf=false;
        if(FORCE_PERF_CLOCK){
            // 強制モード: drift が大きい環境。Performance 時間を信頼。
            playbackPosition = playbackStartPos + perfDt;
            return;
        }
        if(perfDt>0.15){
            const ratio = ctxDt / (perfDt||1e-6);
            usePerf = IS_MOBILE? (ratio < 0.5) : (ratio < 0.6);
        }
        let dt = ctxDt;
        if(!usePerf){
            if(perfDt - ctxDt > 0.04){ // 40ms 以上乖離で徐々に追従
                dt = ctxDt + (perfDt-ctxDt)*0.10;
            }
        } else {
            dt = perfDt;
        }
        playbackPosition = playbackStartPos + dt;
    }catch(_){
        const dt=Math.max(0, audioCtx.currentTime - playbackStartTime);
        playbackPosition = playbackStartPos + dt;
    }
}
function scheduleMore(){
    if(SIMPLE_SFZ_MODE){ return scheduleMoreSimple(); }
    if(!isPlaying||!audioCtx) return;
    // 練習モード: 音源が何も無い場合はスケジュール不要
    if(!melodyBuffer && !accompBuffer) return;
    const now=audioCtx.currentTime;
    // 有効トラックフィルタ
    // 右上（実際はバー右側）の再生チェックに従う。旧トグルもフォールバックで尊重
    // 再生可否はスライダ値>~0.01で判断（チェックボックスは廃止済み）
    const gvEl=document.getElementById('guideVolumeSlider');
    const avEl=document.getElementById('accompVolumeSlider');
    const enableMel = gvEl? (parseFloat(gvEl.value)>0.01) : true;
    const enableAcc = avEl? (parseFloat(avEl.value)>0.01) : true;
    const isTrackEnabled = (ti)=>{
        const isMel = (ti===melodyTrackIndex);
        if((isMel && !enableMel) || (!isMel && !enableAcc)) return false;
        const assign = trackInstrumentAssign[ti]|| (isMel? 'Flute': 'Piano');
        return assign!=='none' && (currentTracks[ti]?.notes?.length>0);
    };
    // 次ノート探索ヘルパ
    const findNextNoteTime = (after)=>{
        let t=Infinity;
        for(let ti=0; ti<currentTracks.length; ti++){
            if(!isTrackEnabled(ti)) continue;
            const notes=currentTracks[ti].notes;
            for(const n of notes){
                const st=n.time; if(st>after+1e-6){ if(st<t) t=st; break; }
            }
        }
        return isFinite(t)? t: null;
    };

    // from/target を常に有限に矯正
    let from = isFinite(scheduledUntil)? scheduledUntil: (playbackPosition||0);
    const baseAhead = SCHEDULE_AHEAD; // 一定の先読み

    // 同一呼び出し内で数回まで前進しつつスケジュール（休符で止まらないよう）
    let loops=0; const MAX_LOOPS=3; let scheduledTotal=0; const MAX_NODES_PER_CALL=120;
    while(loops<MAX_LOOPS){
        loops++;
        const basePos = Math.max(isFinite(scheduledUntil)? scheduledUntil: 0, playbackPosition||0);
        const songDur = getSongDuration();
        let target = Math.min(isFinite(songDur)? songDur: (basePos+baseAhead), basePos + baseAhead);
        if(!(isFinite(target))) target = basePos + baseAhead;
        if(target<=from+1e-6){ target = from + baseAhead; }
        if(window.DEBUG_SCHED){ try{ console.log('[sched] win',loops,'from',from.toFixed(3),'base',basePos.toFixed(3),'target',target.toFixed(3),'pos', (playbackPosition||0).toFixed(3)); }catch(_){ } }

        let scheduledCount=0; let hardLimitHit=false;
        for(let ti=0; ti<currentTracks.length && !hardLimitHit; ti++){
            if(!isTrackEnabled(ti)) continue;
            const isMel = (ti===melodyTrackIndex);
            const assign = trackInstrumentAssign[ti]|| (isMel? 'Flute': 'Piano');
            const out = isMel? (melodyGain||masterGain||audioCtx.destination): (accompGain||masterGain||audioCtx.destination);
            const notes=currentTracks[ti].notes;
            for(const n of notes){
                const st=n.time, en=st+n.duration;
                if(en<=from) continue; if(st>=target) break;
                // 固定基準に対して when を決定
                let when = (isFinite(playbackStartTime)? playbackStartTime: audioCtx.currentTime) + ((isFinite(st)&&isFinite(playbackStartPos))? (st - playbackStartPos): 0);
                if(btLatencyEnabled){ when -= btLatencySec; }
                if(when < now - 0.01){ when = now + 0.002; }

                let ok=false;
                if(useSamplePiano && (instrumentMaps[assign] || pianoSampleMap) && (Object.keys(instrumentMaps[assign]||pianoSampleMap).length)){
                    ok = playFromZipPiano(n.midi, when, n.duration, out, assign);
                    if(window.DEBUG_SAMPLE_NOTE && ok){ try{ console.log('scheduled sample', {inst:assign, midi:n.midi, when: (when-audioCtx.currentTime).toFixed(3)}); }catch(_){ } }
                }
                if(!ok){ ok = !!createPianoVoice(n.midi, when, n.duration, out); }
                if(ok){ scheduledCounter++; scheduledCount++; scheduledTotal++; }

                if(scheduledTotal >= MAX_NODES_PER_CALL){ hardLimitHit=true; break; }
            }
        }

        // 進捗を更新
        scheduledUntil = target;
        if(window.DEBUG_SCHED){ try{ console.log('[sched] scheduled:', scheduledCount, 'accum:', scheduledTotal, 'scheduledUntil->', (scheduledUntil||0).toFixed(3)); }catch(_){ } }

        // ノートが1つも無ければ、先のノートを探して from をジャンプ（最大30秒）
        if(scheduledCount===0 && !hardLimitHit){
            const nextT = findNextNoteTime(from);
            if(nextT!=null){
                const jumpTo = Math.min(nextT, from + (MAX_DYNAMIC_LOOKAHEAD||30));
                if(window.DEBUG_SCHED){ try{ console.log('[sched] no-notes; jump from', from.toFixed(3), '->', jumpTo.toFixed(3)); }catch(_){ } }
                from = jumpTo;
                continue; // 次ループで再計算
            }
        }

        // 打ち切りまたは先がない場合は終了
        if(hardLimitHit || scheduledTotal >= MAX_NODES_PER_CALL) break;
        if(scheduledCount===0) break;
    }
}
function autoCenterMelodyTrack(){
    if(autoCenterFrozen) return; // 凍結中は自動センタリングしない
    // 2.5オクターブ固定: 自動ズーム・自動オフセットは行わない
    // 必要であれば手動スライダやボタン操作で調整する
    return;
}
// 指定したMIDI範囲 [low, high] が見えるように縦オフセットを調整
function setVerticalOffsetToRange(low, high){
    if(!Number.isFinite(low) || !Number.isFinite(high)) return;
    const total=verticalZoom*12; // 表示半音数
    const min=36, max=132; // 描画の全範囲
    const allowRange=Math.max(0, (max-min-total));
    const span = Math.max(1, (high - low + 1));
    const desiredCenter = (low + high) / 2;
    const clampedCenter = Math.max(min + total/2, Math.min(max - total/2, desiredCenter));
    const desiredVmin = Math.round(clampedCenter - total/2);
    const rel = Math.max(0, Math.min(allowRange, desiredVmin - min));
    verticalOffset = Math.round((rel / Math.max(1, allowRange)) * 100);
    try{ if(typeof syncVerticalOffsetSliders==='function') syncVerticalOffsetSliders(); }catch(_){ }
}
// 必要に応じてリセット用ユーティリティも提供
window.resetAutoCenter = function(){ autoCenterFrozen=false; autoCenterMelodyTrack(); drawChart(); };
function scheduleAll(){ scheduledUntil=playbackPosition; }
// ---- UI ----
// 音声ファイル UI
if(melodyAudioBtn && melodyAudioInput){ melodyAudioBtn.onclick=()=>{ if(melodyAudioBtn.disabled) return; melodyAudioInput.click(); }; }
if(melodyAudioInput){ melodyAudioInput.onchange=async e=>{ const f=e.target.files?.[0]; if(!f) return; if(melodyAudioLabel){ melodyAudioLabel.textContent=f.name; melodyAudioLabel.title=f.name; } const overlay=document.getElementById('analyzingOverlay'); try{ if(overlay){ overlay.classList.remove('hidden'); } const ab=await f.arrayBuffer(); const srcU8=new Uint8Array(ab); // 保存用にディープコピー（decodeAudioDataでdetachされても安全）
    const P = melodyParts[currentMelodyPart];
    P.origBytes=new Uint8Array(srcU8.length); P.origBytes.set(srcU8);
    P.origName=f.name; P.origExt=(f.name.split('.').pop()||'bin').toLowerCase(); if(!audioCtx) ensureAudio();
    // デコード自体は元のabを使用（detachしても保存用は別バッファ）
    P.buffer=await new Promise((res,rej)=> audioCtx.decodeAudioData(ab, b=>res(b), e=>rej(e)));
    P.duration=P.buffer.duration||0; await extractMelodyNotesFromBuffer(P.buffer);
    // 抽出結果は currentTracks[0] に入っているため、パートの notes に写す
    try{ P.notes = (currentTracks && currentTracks[0] && Array.isArray(currentTracks[0].notes))? currentTracks[0].notes.slice() : []; }catch(_){ P.notes = []; }
    // 解析によりノーツが更新されたので自動センタリングを解除して適用
    autoCenterFrozen = false;
    autoCenterMelodyTrack();
    // --- 再セット: アシスト/キャリブ解除・停止・頭出し・スケジューラ/タイムライン更新 ---
    try{ if(isAssistActive()) stopLatencyAssist(); }catch(_){ }
    try{ if(isCalibrating){ _calibAbort=true; isCalibrating=false; } }catch(_){ }
    midiGhostNotes = null; calibCountdownText=null; calibAnchorActive=false;
    // パートのノーツを編集対象に切替
    currentTracks=[{name:`Melody P${currentMelodyPart+1}`, notes:(P.notes||[])}]; melodyTrackIndex=0; melodyNotesExtracted=true;
    // ピッチ専用モードの解除（読込直後はノーツ表示・再生を有効に戻す）
    try{
        if(isPitchOnlyMode){
            isPitchOnlyMode = false;
            const btn = document.getElementById('pitchOnlyModeBtn');
            if(btn){
                btn.classList.toggle('active', false);
                btn.title = '音源を使わず、マイクの音程だけを記録・表示します（再生は無音）';
            }
        }
    }catch(_){ }
    // 再生関連を初期化
    if(isPlaying){ try{ pausePlayback(); }catch(_){ } }
    stopStage = 0;
    timelineOffsetSec = 0;
    scheduledUntil = 0;
    playbackPosition = 0;
    playbackStartPos = 0;
    // スクロールとキャンバスを最新状態に
    try{ if(typeof resizeCanvas==='function') resizeCanvas(); }catch(_){ }
    scheduleAll();
    updateTimelineScrollRange();
    drawChart();
    // ステータスを初期化
    try{ if(btCalibStatus) btCalibStatus.textContent='未測定'; }catch(_){ }
    }catch(err){ console.warn('メロディ音声の読込に失敗:', err); } finally { if(overlay){ overlay.classList.add('hidden'); } } }; }
if(accompAudioBtn && accompAudioInput){ accompAudioBtn.onclick=()=>{ if(accompAudioBtn.disabled) return; accompAudioInput.click(); }; }
if(accompAudioInput){ accompAudioInput.onchange=async e=>{ const f=e.target.files?.[0]; if(!f) return; if(accompAudioLabel){ accompAudioLabel.textContent=f.name; accompAudioLabel.title=f.name; } try{ const ab=await f.arrayBuffer(); const srcU8=new Uint8Array(ab); accompOrigBytes=new Uint8Array(srcU8.length); accompOrigBytes.set(srcU8); accompOrigName=f.name; accompOrigExt=(f.name.split('.').pop()||'bin').toLowerCase(); if(!audioCtx) ensureAudio(); accompBuffer=await new Promise((res,rej)=> audioCtx.decodeAudioData(ab, b=>res(b), e=>rej(e))); accompDuration=accompBuffer.duration||0; }catch(err){ console.warn('伴奏音声の読込に失敗:', err); } }; }

// ================= セッション保存/読込 =================
function textEncodeUtf8(str){ try{ return new TextEncoder().encode(str); }catch(_){ // IE/旧ブラウザ想定なし
    const u8=new Uint8Array(str.length); for(let i=0;i<str.length;i++) u8[i]=str.charCodeAt(i)&255; return u8; }
}
function textDecodeUtf8(u8){ try{ return new TextDecoder().decode(u8); }catch(_){ let s=''; for(let i=0;i<u8.length;i++) s+=String.fromCharCode(u8[i]); return s; } }

function buildSessionJson(){
    const tr=currentTracks[melodyTrackIndex];
    const notes=(tr&&tr.notes)? tr.notes.map(n=>({midi:n.midi,time:n.time,duration:n.duration})) : [];
    const dots=pitchHistory.map(p=>({time:p.time,freq:p.freq,conf:p.conf}));
    const meta={
        app:"pitch-trainer",
        ver:"1",
        a4:A4Frequency,
        toleranceCents,
        tempoFactor,
        guideLineWidth,
        verticalZoom, verticalOffset,
        pxPerSec, timelineOffsetSec,
        labelNotation,
        btLatencyEnabled, btLatencySec,
        guideVolume: (guideVol? parseFloat(guideVol.value): (melodyGain? melodyGain.gain.value: 0.8)),
        accompVolume: (accompVol? parseFloat(accompVol.value): (accompGain? accompGain.gain.value: 0.8)),
        markers
    };
    const audio={
        melody: melodyOrigBytes? {name:melodyOrigName||'melody', ext:melodyOrigExt||'bin'} : null,
        accomp: accompOrigBytes? {name:accompOrigName||'accomp', ext:accompOrigExt||'bin'} : null
    };
    return {meta, notes, dots, audio};
}

function suggestSessionFileName(){
    const base=(melodyOrigName||melodyAudioLabel?.textContent||'session').replace(/\.[^.]+$/,'');
    return base+".session.zip";
}

function makeZipStoreOnly(files){
    // シンプルな Store-only ZIP 生成（中央ディレクトリ省略: 一部解凍器は非対応の可能性あり）
    const chunks=[]; let offset=0; const enc=textEncodeUtf8;
    function pushU32LE(arr,v){ arr.push(v&255,(v>>8)&255,(v>>16)&255,(v>>24)&255); }
    function pushU16LE(arr,v){ arr.push(v&255,(v>>8)&255); }
    function dosTime(){ const d=new Date(); const t=((d.getHours())<<11)|((d.getMinutes())<<5)|((d.getSeconds()/2)|0); const da=(((d.getFullYear()-1980)<<9)|((d.getMonth()+1)<<5)|(d.getDate())); return {t,da}; }
    const {t,da}=dosTime();
    files.forEach(f=>{
        const nameU8=enc(f.name);
        const localHeader=[0x50,0x4b,0x03,0x04, 20,0, 0,0, 0,0, 0,0, 0,0, 0,0];
        // 署名+version/extract needed etc は既定
        const crc=0; const compSize=f.data.length; const unCompSize=f.data.length;
        localHeader.push(0,0, 0,0); // mod time/date は後で
        pushU16LE(localHeader,nameU8.length); pushU16LE(localHeader,0); // extra=0
        const hdrU8=new Uint8Array(localHeader);
        // 時刻
        hdrU8[10]=t&255; hdrU8[11]=(t>>8)&255; hdrU8[12]=da&255; hdrU8[13]=(da>>8)&255;
        // サイズ/CRC
        hdrU8[14]=crc&255; hdrU8[15]=(crc>>8)&255; hdrU8[16]=(crc>>16)&255; hdrU8[17]=(crc>>24)&255;
        hdrU8[18]=compSize&255; hdrU8[19]=(compSize>>8)&255; hdrU8[20]=(compSize>>16)&255; hdrU8[21]=(compSize>>24)&255;
        hdrU8[22]=unCompSize&255; hdrU8[23]=(unCompSize>>8)&255; hdrU8[24]=(unCompSize>>16)&255; hdrU8[25]=(unCompSize>>24)&255;
        chunks.push(hdrU8); chunks.push(nameU8); chunks.push(f.data);
        offset += hdrU8.length + nameU8.length + f.data.length;
    });
    // 単純に連結
    let total=0; chunks.forEach(c=> total+=c.length); const out=new Uint8Array(total); let p=0; chunks.forEach(c=>{ out.set(c,p); p+=c.length; });
    return out;
}

async function saveSessionZip(){
    try{
        const sess=buildSessionJson();
        const files=[];
        // session.json
        files.push({name:'session.json', data: textEncodeUtf8(JSON.stringify(sess))});
    if(melodyOrigBytes){ files.push({name: `${melodyOrigName||('melody.'+(melodyOrigExt||'bin'))}`, data: melodyOrigBytes}); }
    if(accompOrigBytes){ files.push({name: `${accompOrigName||('accomp.'+(accompOrigExt||'bin'))}`, data: accompOrigBytes}); }
        let zipU8=null;
        if(window.fflate && typeof fflate.zipSync==='function'){
            const m={}; files.forEach(f=> m[f.name]=f.data );
            zipU8=fflate.zipSync(m, { level: 0 }); // 無圧縮(Store)で十分
        }else{
            zipU8=makeZipStoreOnly(files);
        }
        const blob=new Blob([zipU8], {type:'application/zip'});
        const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=suggestSessionFileName(); a.click(); setTimeout(()=>URL.revokeObjectURL(a.href), 10000);
    }catch(err){ console.warn('セッション保存に失敗:', err); }
}

async function loadSessionZipFromBytes(u8){
    let files=null; let usedFallback=false;
    try{
        if(window.fflate && typeof fflate.unzipSync==='function' && !/本物のライブラリ/.test(String(fflate.unzipSync))){
            files=fflate.unzipSync(u8);
        }else{
            files=unzipStoreOnly(u8);
            usedFallback=true;
        }
    }catch(e){ console.warn('unzip失敗',e); files=unzipStoreOnly(u8); usedFallback=true; }
    if(!files){ throw new Error('ZIP展開に失敗'); }
    const sessEntry=files['session.json'] || files['./session.json'] || (function(){ for(const k in files){ if(k.endsWith('session.json')) return files[k]; } return null; })();
    if(!sessEntry) throw new Error('session.json が見つかりません');
    let sess; try{ sess=JSON.parse(textDecodeUtf8(sessEntry)); }catch(e){ throw new Error('session.json 解析失敗'); }
    // 復元: メタ
    try{
        A4Frequency=sess.meta?.a4||A4Frequency; toleranceCents=sess.meta?.toleranceCents??toleranceCents; tempoFactor=sess.meta?.tempoFactor??tempoFactor; guideLineWidth=sess.meta?.guideLineWidth??guideLineWidth; verticalZoom=sess.meta?.verticalZoom??verticalZoom; verticalOffset=sess.meta?.verticalOffset??verticalOffset; pxPerSec=sess.meta?.pxPerSec??pxPerSec; timelineOffsetSec=sess.meta?.timelineOffsetSec??timelineOffsetSec; labelNotation=sess.meta?.labelNotation||labelNotation; btLatencyEnabled=!!sess.meta?.btLatencyEnabled; btLatencySec=sess.meta?.btLatencySec??btLatencySec; if(sess.meta?.markers) markers=sess.meta.markers; 
        // 追加: 音量設定
        const gv = sess.meta?.guideVolume; const av = sess.meta?.accompVolume;
        if(typeof gv==='number' && guideVol){ guideVol.value=String(gv); }
        if(typeof av==='number' && accompVol){ accompVol.value=String(av); }
    }catch(_){ }
    // 復元: ノート
    currentTracks=[{name:'Melody', notes: (sess.notes||[]).map(n=>({midi:n.midi,time:n.time,duration:n.duration}))}]; melodyTrackIndex=0; melodyNotesExtracted=true;
    // 復元: 赤点
    pitchHistory=(sess.dots||[]).map(d=>({time:d.time,freq:d.freq,conf:d.conf}));
    // 復元: 音声（存在すれば）
    melodyBuffer=null; accompBuffer=null; melodyDuration=0; accompDuration=0;
    melodyOrigBytes=null; accompOrigBytes=null; melodyOrigName=null; accompOrigName=null; melodyOrigExt=null; accompOrigExt=null;
    // まずは session.json の audio.name で探し、見つからなければ既存の汎用名でも探す
    const melNameHint = sess.audio?.melody?.name || null;
    const accNameHint = sess.audio?.accomp?.name || null;
    const melBin = melNameHint? findFileByNames(files,[melNameHint]) : findFileByNames(files,['melody.wav','melody.mp3','melody.m4a','melody.aac','melody.bin']);
    const accBin = accNameHint? findFileByNames(files,[accNameHint]) : findFileByNames(files,['accomp.wav','accomp.mp3','accomp.m4a','accomp.aac','accomp.bin']);
    const overlay=document.getElementById('analyzingOverlay'); if(overlay){ overlay.classList.remove('hidden'); }
    try{
        ensureAudio();
        if(melBin){
            // 保存用にディープコピーして保持
            melodyOrigBytes=new Uint8Array(melBin.bytes.length); melodyOrigBytes.set(melBin.bytes);
            melodyOrigName=melBin.name; melodyOrigExt=detectExtFromName(melBin.name);
            const ab = melBin.bytes.buffer.slice(melBin.bytes.byteOffset, melBin.bytes.byteOffset + melBin.bytes.byteLength);
            const buf=await new Promise((res,rej)=> audioCtx.decodeAudioData(ab, b=>res(b), e=>rej(e)));
            melodyBuffer=buf; melodyDuration=buf.duration||0;
        }
        if(accBin){
            accompOrigBytes=new Uint8Array(accBin.bytes.length); accompOrigBytes.set(accBin.bytes);
            accompOrigName=accBin.name; accompOrigExt=detectExtFromName(accBin.name);
            const ab = accBin.bytes.buffer.slice(accBin.bytes.byteOffset, accBin.bytes.byteOffset + accBin.bytes.byteLength);
            const buf=await new Promise((res,rej)=> audioCtx.decodeAudioData(ab, b=>res(b), e=>rej(e)));
            accompBuffer=buf; accompDuration=buf.duration||0;
        }
    }catch(err){ console.warn('音声復元失敗',err); }
    finally{ if(overlay){ overlay.classList.add('hidden'); } }
    // UI 反映
    if(melodyAudioLabel){ melodyAudioLabel.textContent=melodyOrigName||'(zip内のメロディ)'; melodyAudioLabel.title=melodyAudioLabel.textContent; }
    if(accompAudioLabel){ accompAudioLabel.textContent=accompOrigName||'(zip内の伴奏)'; accompAudioLabel.title=accompAudioLabel.textContent; }
    // スライダ等も反映
    try{
    // A4 UIなし
        if(tolSlider&&tolVal){ tolSlider.value=String(toleranceCents); tolVal.textContent=String(toleranceCents); }
        if(vZoom) vZoom.value=String(verticalZoom);
        if(timeScale&&timeScaleVal){ timeScale.value=String(pxPerSec); timeScaleVal.textContent=String(pxPerSec); }
        if(guideVol && melodyGain){ const v=parseFloat(guideVol.value); if(isFinite(v)) melodyGain.gain.value=v; }
        if(accompVol && accompGain){ const v=parseFloat(accompVol.value); if(isFinite(v)) accompGain.gain.value=v; }
        if(btLatencyToggle){ btLatencyToggle.checked = !!btLatencyEnabled; }
        if(btLatencySlider){ const ms=Math.round((btLatencySec||0)*1000); btLatencySlider.value=String(ms); if(btLatencyValue) btLatencyValue.textContent=`${ms} ms`; btLatencySlider.disabled = !btLatencyEnabled; }
    }catch(_){ }
    // 読み込み直後はユーザー編集ではないため自動センタリングを許可
    autoCenterFrozen = false;
    autoCenterMelodyTrack();
    drawChart();
}

function findFileByNames(files, candidates){
    for(const k in files){
        const low=k.toLowerCase();
        for(const c of candidates){
            if(low.endsWith(c)){
                const u8=files[k];
                return { name: k, bytes: (u8 instanceof Uint8Array)? u8 : new Uint8Array(u8) };
            }
        }
    }
    return null;
}
function detectExtFromName(name){ const m=name.match(/\.([a-z0-9]+)$/i); return m? m[1].toLowerCase(): 'bin'; }

// ボタン結線
if(sessionSaveBtn){ sessionSaveBtn.onclick=()=>{ if(!melodyOrigBytes && !accompOrigBytes){ const ok = confirm('音声ファイルが未読込です。この状態でもノート/赤点のみを保存しますか?'); if(!ok) return; } saveSessionZip(); }; }
if(sessionLoadBtn && sessionLoadInput){ sessionLoadBtn.onclick=()=> sessionLoadInput.click(); sessionLoadInput.onchange=async e=>{ const f=e.target.files?.[0]; if(!f) return; try{ const ab=await f.arrayBuffer(); await loadSessionZipFromBytes(new Uint8Array(ab)); }catch(err){ console.warn('セッション読込に失敗:', err); } }; }
playBtn && (playBtn.onclick=()=>{ 
    if(!isPlaying) startPlayback(); 
    // 練習モード（basic指定）でまだ開始していない場合、再生ボタンで開始
    try{ if(practiceMode==='basic' && !isPracticing){ startBasicPractice(); } }catch(_){ }
});
if(pauseBtn){
    pauseBtn.onclick=null;
    pauseBtn.addEventListener('keydown', (e)=>{ e.preventDefault(); e.stopPropagation(); });
    pauseBtn.addEventListener('keyup', (e)=>{ e.preventDefault(); e.stopPropagation(); });
    pauseBtn.addEventListener('pointerup', (ev)=>{
        if(!ev || ev.isTrusted!==true) return;
        pausePlayback();
    });
}
// stop は pointer 操作のみ受け付ける（キーボード由来の click 合成を無効化）
if(stopBtn){
    stopBtn.onclick=null;
    stopBtn.addEventListener('keydown', (e)=>{ e.preventDefault(); e.stopPropagation(); });
    stopBtn.addEventListener('keyup', (e)=>{ e.preventDefault(); e.stopPropagation(); });
    stopBtn.addEventListener('pointerdown', (ev)=>{
        // ユーザー操作のみ許可
        if(STOP_TRUSTED_ONLY && (!ev || ev.isTrusted!==true)){
            try{ console.warn('stop ignored (untrusted trigger: pointerdown)'); }catch(_){ }
            return;
        }
        stopBtn.dataset._armed='1';
    });
    stopBtn.addEventListener('pointerup', (ev)=>{
        if(stopBtn.dataset._armed!=='1') return;
        stopBtn.dataset._armed='0';
        if(STOP_TRUSTED_ONLY && (!ev || ev.isTrusted!==true)){
            try{ console.warn('stop ignored (untrusted trigger: pointerup)'); }catch(_){ }
            return;
        }
        // 練習モード中なら停止で終了
        if(isPracticing){ try{ stopBasicPractice(true); }catch(_){ } }
        // キャリブレーション/アシスト中なら即座に中断
        if(isCalibrating){ _calibAbort = true; }
        if(isAssistActive()){ stopLatencyAssist(); }
        if(isPlaying){
            pausePlayback();
            stopStage=1;
        } else if(stopStage===1){
            playbackPosition=0; playbackStartPos=0; stopStage=0;
            scheduleAll(); // 先読みウィンドウを0位置へ矯正
            drawChart();
        }
    });
}
rw5 && (rw5.onclick=()=>seekRelative(-5)); rw10 && (rw10.onclick=()=>seekRelative(-10)); fw5 && (fw5.onclick=()=>seekRelative(5)); fw10 && (fw10.onclick=()=>seekRelative(10));
tolSlider && (tolSlider.oninput=()=>{ toleranceCents=parseInt(tolSlider.value); tolVal.textContent=toleranceCents; drawChart(); }); tolVal && (tolVal.textContent=toleranceCents);
gateSlider && (gateSlider.oninput=()=>{ gateThreshold=parseInt(gateSlider.value); gateVal.textContent=gateThreshold; updateMicGateVisual(); }); gateVal && (gateVal.textContent=gateThreshold);
rateSlider && (rateSlider.oninput=()=>{
    let v=parseInt(rateSlider.value);
    // hop=frame/2 の下限を守る（YINの安定化）
    try{
        const sr = (audioCtx && audioCtx.sampleRate) ? audioCtx.sampleRate : 48000;
        const W = (micAnalyser && micAnalyser.fftSize) ? micAnalyser.fftSize : 2048;
        const hopRate = Math.max(10, Math.min(120, Math.round(sr / Math.max(1, Math.floor(W/2)))));
        v = Math.max(v, hopRate);
    }catch(_){ }
    analysisRate=v; rateVal.textContent=analysisRate;
    if(analysisTimer){ clearInterval(analysisTimer); analysisTimer=setInterval(analyzePitch,1000/analysisRate);} 
}); rateVal && (rateVal.textContent=analysisRate);
// A4/オクターブ合わせUIは削除済み
labelSel && (labelSel.onchange=()=>{ labelNotation=labelSel.value; });
vZoom && (vZoom.oninput=()=>{ verticalZoom=parseFloat(vZoom.value); drawChart(); });
timeScale && (timeScale.oninput=()=>{ pxPerSec=parseInt(timeScale.value); if(timeScaleVal) timeScaleVal.textContent=pxPerSec; drawChart(); });
guideVol && (guideVol.oninput=()=>{ if(!melodyGain) return; const v=parseFloat(guideVol.value); melodyGain.gain.value = (isFinite(v)? v: (melodyGain.gain.value||0.8)); });
accompVol && (accompVol.oninput=()=>{ if(!accompGain) return; const v=parseFloat(accompVol.value); accompGain.gain.value = (isFinite(v)? v: (accompGain.gain.value||0.8)); });
guideLineWidthSlider && (guideLineWidthSlider.oninput=()=>{ guideLineWidth=parseInt(guideLineWidthSlider.value)||4; drawChart(); });
// 既存のトラックUIイベントはすべて無効

// 可視化補正スライダ: 即時反映
const _visTimeSnapMsEl = document.getElementById('visTimeSnapMs');
const _visTimeSnapMsVal = document.getElementById('visTimeSnapMsVal');
if(_visTimeSnapMsEl){
    _visTimeSnapMsEl.oninput=()=>{ visTimeSnapMs = parseInt(_visTimeSnapMsEl.value)||180; if(_visTimeSnapMsVal) _visTimeSnapMsVal.textContent=String(visTimeSnapMs); drawChart(); };
    if(_visTimeSnapMsVal) _visTimeSnapMsVal.textContent=String(visTimeSnapMs);
}
const _visBridgeGapMsEl = document.getElementById('visBridgeGapMs');
const _visBridgeGapMsVal = document.getElementById('visBridgeGapMsVal');
if(_visBridgeGapMsEl){
    _visBridgeGapMsEl.oninput=()=>{ visBridgeGapMs = parseInt(_visBridgeGapMsEl.value)||150; if(_visBridgeGapMsVal) _visBridgeGapMsVal.textContent=String(visBridgeGapMs); drawChart(); };
    if(_visBridgeGapMsVal) _visBridgeGapMsVal.textContent=String(visBridgeGapMs);
}
const _visBridgeGapInNoteMsEl = document.getElementById('visBridgeGapInNoteMs');
const _visBridgeGapInNoteMsVal = document.getElementById('visBridgeGapInNoteMsVal');
if(_visBridgeGapInNoteMsEl){
    _visBridgeGapInNoteMsEl.oninput=()=>{ visBridgeGapInNoteMs = parseInt(_visBridgeGapInNoteMsEl.value)||300; if(_visBridgeGapInNoteMsVal) _visBridgeGapInNoteMsVal.textContent=String(visBridgeGapInNoteMs); drawChart(); };
    if(_visBridgeGapInNoteMsVal) _visBridgeGapInNoteMsVal.textContent=String(visBridgeGapInNoteMs);
}
const _visChangeTolSemiEl = document.getElementById('visChangeTolSemi');
const _visChangeTolSemiVal = document.getElementById('visChangeTolSemiVal');
if(_visChangeTolSemiEl){
    _visChangeTolSemiEl.oninput=()=>{ visChangeTolSemi = parseFloat(_visChangeTolSemiEl.value)||0.65; if(_visChangeTolSemiVal) _visChangeTolSemiVal.textContent=String(visChangeTolSemi); drawChart(); };
    if(_visChangeTolSemiVal) _visChangeTolSemiVal.textContent=String(visChangeTolSemi);
}
const _visEdgePadMsEl = document.getElementById('visEdgePadMs');
const _visEdgePadMsVal = document.getElementById('visEdgePadMsVal');
if(_visEdgePadMsEl){
    _visEdgePadMsEl.oninput=()=>{ visEdgePadMs = parseInt(_visEdgePadMsEl.value)||160; if(_visEdgePadMsVal) _visEdgePadMsVal.textContent=String(visEdgePadMs); drawChart(); };
    if(_visEdgePadMsVal) _visEdgePadMsVal.textContent=String(visEdgePadMs);
}

micBtn && (micBtn.onclick=async()=>{
    // ユーザー操作で AudioContext を確実に有効化/再開
    _userExplicitMicInit=true;
    try{ activateAudioOnce(); }catch(_){ }
    try{ if(audioCtx && audioCtx.state==='suspended'){ await audioCtx.resume().catch(()=>{}); } }catch(_){ }
    try{ setMicStatus('ON?'); }catch(_){ }
    await initMic(true); // 明示操作なのでプロンプト許可
    if(!analysisTimer) analysisTimer=setInterval(analyzePitch,1000/analysisRate);
    if(!isPlaying) drawChart();
});
if(micDisconnectBtn){ micDisconnectBtn.onclick=()=>{ stopMic(); }; }
showNoteNamesToggle && (showNoteNamesToggle.onchange=()=>{ showNoteNames=showNoteNamesToggle.checked; drawChart(); });
function syncVerticalOffsetSliders(){ try{ if(vOffsetSliderRight) vOffsetSliderRight.value=String(verticalOffset); }catch(_){ } }
// 縦オフセットスライダーのイベントは DOM 構築後に登録済み（重複防止のためここでは未設定）
// 再生パレット右端のチェックボックスは廃止（後方互換のみ）
// if(melodyPlayToggle){ melodyPlayToggle.onchange=()=>{ ... } }
// if(accompPlayToggle){ accompPlayToggle.onchange=()=>{ ... } }
// BT補正UIイベント
if(btLatencyToggle){ btLatencyToggle.onchange=()=>{ btLatencyEnabled=btLatencyToggle.checked; if(btLatencySlider) btLatencySlider.disabled = !btLatencyEnabled; }; }
if(btLatencySlider){ btLatencySlider.oninput=()=>{ const ms=parseInt(btLatencySlider.value)||0; btLatencySec=Math.max(0, Math.min(500, ms))/1000; if(btLatencyValue) btLatencyValue.textContent=`${ms} ms`; drawChart(); }; }
if(btLatencyCalibBtn){ btLatencyCalibBtn.onclick=()=>{
    const ok = confirm('遅延補正アシストを開始します。\n\n手順:\n1) 3→2→1 のカウント後、一定間隔のノーツが流れ続けます（音は鳴りません）。\n2) ノーツに合わせて短く発声してください。音程は無視し、音を拾ったタイミングだけで棒線が出ます。\n3) 画面下の「遅延補正」スライダを動かすと即時に反映されます。棒線とノーツのタイミングが一致するように調整してください。\n4) 終了は停止ボタンを押してください。');
    if(!ok) return;
    runLatencyAssist();
}; }
// ペダル/共鳴はUI整理により非表示（内部値は固定）
// マイク状態表示用
function setMicStatus(text){
    let el=document.getElementById('micStatusBadge');
    if(!el){ el=document.createElement('div'); el.id='micStatusBadge'; el.style.cssText='position:absolute;top:8px;right:8px;padding:4px 8px;font-size:12px;background:#222;border:1px solid #4e8cff;color:#4e8cff;border-radius:4px;z-index:2000;font-family:sans-serif;'; document.body.appendChild(el);} 
    el.textContent='MIC '+text;
    if(text==='ON'){ el.style.background='#143'; el.style.color='#4eff9d'; el.style.borderColor='#4eff9d'; }
}
function updateMicGateVisual(){ if(!micGateLine) return; // gateThreshold dB を 0..1 に正規化 (-60..0)
  const norm=Math.min(1,Math.max(0,(gateThreshold+60)/60)); micGateLine.style.left=(norm*100)+'%'; }
// Canvas リサイズ（欠落していたため追加）
function resizeCanvas(){
    if(!chartCanvas) return;
    // 親のサイズを参照して固定ピクセル幅/高さを設定（描画座標系を確定させる）
    const parent=chartCanvas.parentElement; if(parent){
        // ビューポート幅と親のcontent幅を比較して、安全側を採用
        const vvw = (window.visualViewport && window.visualViewport.width) ? window.visualViewport.width : (window.innerWidth || document.documentElement.clientWidth || parent.clientWidth || 0);
        // 親の内側幅（padding/border除外）を推定
        const parentRect = parent.getBoundingClientRect();
        const style = getComputedStyle(parent);
        const padL = parseFloat(style.paddingLeft)||0, padR = parseFloat(style.paddingRight)||0;
        const borL = parseFloat(style.borderLeftWidth)||0, borR = parseFloat(style.borderRightWidth)||0;
        const inner = Math.max(0, Math.floor(parentRect.width - padL - padR - borL - borR));
        // 左側の縦スライダーパネル分を差し引いて幅確保（初期ゼロ幅罠を回避するため候補の最大値を採用）
        // 左右の縦スライダーパネル分を差し引く
        let leftW = 0, rightW = 0;
        try{
            const rightPanel = document.getElementById('rightVerticalPanel');
            if(rightPanel){ const w = Math.ceil(rightPanel.getBoundingClientRect().width)||0; rightW = w; }
        }catch(_){ /* ignore */ }
    const sideTotal = Math.max(0, /*leftW +*/ rightW);
        const innerAfterSides = Math.max(0, inner - sideTotal);
        const vvwAfterSides = Math.max(0, Math.floor(vvw) - sideTotal);
        // 最小幅を確保して 0px にならないようにする
        let avail = Math.max(120, innerAfterSides, vvwAfterSides);
        // キャンバスのCSS幅も同期して、右端が端末幅を超えないようにする
        chartCanvas.width = avail; // flex 残余幅から差引き
        chartCanvas.style.width = avail + 'px';
        chartCanvas.height=parent.clientHeight; // container 高さ
    } else {
        chartCanvas.width=chartCanvas.clientWidth;
        chartCanvas.height=chartCanvas.clientHeight;
    }
    // タイムラインバーの幅も端末幅にクランプ
    try{
        const bar = document.getElementById('timelineScrollBar');
        const input = document.getElementById('timelineScroll');
        if(bar){
            const vvw = (window.visualViewport && window.visualViewport.width) ? window.visualViewport.width : (window.innerWidth || document.documentElement.clientWidth || 0);
            const parent = bar.parentElement || document.body;
            const rect = parent.getBoundingClientRect();
            const st = getComputedStyle(parent);
            const pad = (parseFloat(st.paddingLeft)||0) + (parseFloat(st.paddingRight)||0) + (parseFloat(st.borderLeftWidth)||0) + (parseFloat(st.borderRightWidth)||0);
            const innerW = Math.max(0, Math.floor(rect.width - pad));
            const maxW = Math.min(innerW, Math.floor(vvw));
            bar.style.maxWidth = maxW + 'px';
            bar.style.width = '100%';
        }
        if(input){ input.style.maxWidth = '100%'; input.style.width = '100%'; }
    }catch(_){ }
}
// ---- Debug ----
window._appState={startPlayback,pausePlayback,seekTo,seekRelative};
// 追加デバッグ: オーディオ状態ダンプと直結バイパス
window._printAudioState=function(){
    try{
        const st = audioCtx? audioCtx.state: 'noctx';
        const gv = melodyGain? melodyGain.gain.value: null;
        const av = accompGain? accompGain.gain.value: null;
    const mgConn = !!masterGain;
    const compConn = !!compressor;
    const limConn = !!limiter;
    console.log('[audio-state]',{state:st, gv, av, isPlaying, playbackPosition, playbackStartPos, scheduledUntil, voices:{synth:activeVoices.length, sample:activeSampleVoices.length}, chain:{master:mgConn, comp:compConn, lim:limConn, direct:_directRouteOn}});
    }catch(e){ console.warn(e); }
};
// AudioContext 進行診断（無音化/スローダウンの可視化）
let _ctxDiagTimer=null, _ctxDiagLast={t:0, ct:0, pos:0};
window._ctxDiagStart=function(intervalMs=250){
    try{ ensureAudio(); }catch(_){ }
    if(_ctxDiagTimer) return console.warn('ctxDiag already running');
    // 併用: 出力RMSメータが未起動なら簡易版を内部で用意
    let ana=_levelAnalyser; let tmpBuf=null;
    if(!ana){
        try{ ana=audioCtx.createAnalyser(); ana.fftSize=1024; ana.smoothingTimeConstant=0.2; (limiter||compressor||masterGain).connect(ana); tmpBuf=new Float32Array(ana.fftSize); }catch(_){ }
    } else {
        tmpBuf=new Float32Array(ana.fftSize);
    }
    _ctxDiagLast={ t: performance.now(), ct: (audioCtx? audioCtx.currentTime: 0), pos: playbackPosition||0 };
    _ctxDiagTimer=setInterval(()=>{
        try{
            const nowP=performance.now();
            const ct= audioCtx? audioCtx.currentTime: 0;
            const pos= playbackPosition||0;
            const dtP=(nowP-_ctxDiagLast.t)/1000;
            const dCtx= ct - _ctxDiagLast.ct;
            const dPos= pos - _ctxDiagLast.pos;
            let db=null;
            if(ana && tmpBuf){ ana.getFloatTimeDomainData(tmpBuf); let s=0; for(let i=0;i<tmpBuf.length;i++){ const v=tmpBuf[i]; s+=v*v; } const rms=Math.sqrt(s/Math.max(1,tmpBuf.length)); db=20*Math.log10(Math.max(1e-7,rms)); }
            console.log('[ctxDiag]',
                `perf+${dtP.toFixed(3)}s`,
                `ctx+${dCtx.toFixed(3)}s`,
                `pos+${dPos.toFixed(3)}s`,
                `ratio=${(dCtx/dtP).toFixed(2)}`,
                (db!=null? `RMS=${db.toFixed(1)}dB`: 'RMS=na'),
                `state=${audioCtx? audioCtx.state: 'noctx'}`
            );
            _ctxDiagLast={ t: nowP, ct: ct, pos: pos };
        }catch(e){ console.warn('ctxDiag err',e); }
    }, Math.max(50, intervalMs|0));
    console.warn('ctxDiag: START');
};
window._ctxDiagStop=function(){ if(_ctxDiagTimer){ clearInterval(_ctxDiagTimer); _ctxDiagTimer=null; console.warn('ctxDiag: STOP'); } };
// 一瞬だけ目立つエネルギーを出して context を確実に wake させる
window._kickAudio=function(){ try{ ensureAudio(); const t=audioCtx.currentTime+0.001; const o=audioCtx.createOscillator(); const g=audioCtx.createGain(); o.type='square'; o.frequency.setValueAtTime(1000,t); g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.03,t+0.005); g.gain.exponentialRampToValueAtTime(0.0001,t+0.06); o.connect(g); g.connect(audioCtx.destination); o.start(t); o.stop(t+0.07); console.warn('kickAudio fired'); }catch(e){ console.warn('kickAudio failed',e); } };

// Convenience aliases (no underscore) for console usage
window.enableLevelMeter = function(on){ return window._enableLevelMeter(on); };
window.ctxDiagStart = function(interval){ return window._ctxDiagStart(interval); };
window.ctxDiagStop = function(){ return window._ctxDiagStop(); };
window.printAudioState = function(){ return window._printAudioState(); };

// ページがバックグラウンドに入ったらマイクを自動停止（復帰時は権限ありのみ静かに再初期化）
try{
    document.addEventListener('visibilitychange', async()=>{
        if(document.hidden){
            stopMic();
        } else {
            try{ if(await canInitMicWithoutPrompt()){ await initMic(false).catch(()=>{}); } }catch(_){ }
        }
    });
}catch(_){ }

// Panic: 全停止→AudioContext微リセット→配線復元
window.audioPanic = function(){
    try{ forceStopAllVoices(); }catch(_){ }
    try{ if(schedTimer) clearInterval(schedTimer); schedTimer=null; }catch(_){ }
    try{ if(audioCtx && audioCtx.state==='running'){ /* 軽いナッジ */ ensureKeepAlive(); } }catch(_){ }
    try{ ensureConvolver(); ensureKeepAlive(); }catch(_){ }
    console.warn('audioPanic executed');
};

// 直結バイパスの簡易エイリアス
window.setDirectRoute = function(on){ return window._directRoute(!!on); };

// 即時に1音だけSFZを鳴らす（Simple経路）
window.playSfzNow = function(midi=60, dur=0.5){ try{ ensureAudio(); const when=audioCtx.currentTime+0.03; return simplePlaySfz(midi, when, dur, masterGain||audioCtx.destination); }catch(_){ return false; } };

// 直接 destination へ出す版（チェーン完全迂回）
window.playSfzNowDirect = function(midi=60, dur=0.5){
    try{
        ensureAudio();
        const when=audioCtx.currentTime+0.03;
        return simplePlaySfz(midi, when, dur, audioCtx.destination);
    }catch(_){ return false; }
};

// 状態の要約ダンプ
window.debugSummary = function(){
    try{
        const map = (instrumentMaps.Piano&&Object.keys(instrumentMaps.Piano).length)? instrumentMaps.Piano : (instrumentMaps.Flute&&Object.keys(instrumentMaps.Flute).length? instrumentMaps.Flute : pianoSampleMap);
        const keys = map? Object.keys(map).length: 0;
        const notes = (currentTracks||[]).reduce((a,t)=> a + ((t?.notes?.length)||0), 0);
        const out = {
            audioState: audioCtx? audioCtx.state: 'noctx',
            SIMPLE_SFZ_MODE,
            tracks: (currentTracks||[]).length,
            notes,
            sampleKeys: keys,
            voices: { synth: activeVoices.length, sample: activeSampleVoices.length },
            scheduledUntil,
            playback: { pos: playbackPosition, startPos: playbackStartPos }
        };
        console.table(out);
        return out;
    }catch(e){ console.warn('debugSummary failed', e); return null; }
};
// 直結の多重接続を避けるためのフラグ
let _directRouteOn=false;
window._directRoute=function(on=true){
    if(!audioCtx||!masterGain) return;
    try{
        if(on){
            if(_directRouteOn) { console.warn('Direct route: already ON'); return; }
            // 既存の経路を一旦外して、masterGain を直接 destination へ
            try{ masterGain.disconnect(); }catch(_){ }
            masterGain.connect(audioCtx.destination);
            _directRouteOn=true;
            console.warn('Direct route: ON (masterGain -> destination ONLY)');
        } else {
            if(!_directRouteOn){ console.warn('Direct route: already OFF'); return; }
            // 直結を外し、既定のチェーンへ戻す
            try{ masterGain.disconnect(); }catch(_){ }
            // 既定チェーンの再構築（preOutMergeGain 等を考慮）
            if(preOutMergeGain){
                try{ masterGain.connect(preOutMergeGain); }catch(_){ }
            }else if(compressor){
                try{ masterGain.connect(compressor); }catch(_){ }
            }
            // 念のため付帯エフェクトの配線も確保
            try{ ensureConvolver(); }catch(_){ }
            _directRouteOn=false;
            console.warn('Direct route: OFF (restored default chain)');
        }
    }catch(e){ console.warn('direct route toggle failed',e); }
};
// 出力レベルの簡易モニタ（RMS）。無音化の原因切り分け用。
let _levelAnalyser=null, _levelTimer=null, _recentRMS=[];
function _computeRMS(buf){
    let sum=0; for(let i=0;i<buf.length;i++){ const v=buf[i]; sum+=v*v; }
    const rms=Math.sqrt(sum/Math.max(1,buf.length));
    const db = 20*Math.log10(Math.max(1e-7, rms));
    return db;
}
window._enableLevelMeter=function(on=true){
    ensureAudio();
    try{
        if(on){
            if(!_levelAnalyser){
                _levelAnalyser=audioCtx.createAnalyser();
                _levelAnalyser.fftSize=2048; _levelAnalyser.smoothingTimeConstant=0.2;
                // 出力の分岐接続（直結バイパス時でも拾えるよう masterGain も接続）
                let connected=false;
                try{ if(limiter){ limiter.connect(_levelAnalyser); connected=true; } }catch(_){ }
                try{ if(!connected && compressor){ compressor.connect(_levelAnalyser); connected=true; } }catch(_){ }
                try{ if(!connected && masterGain){ masterGain.connect(_levelAnalyser); connected=true; } }catch(_){ }
            }
            const buf=new Float32Array(_levelAnalyser.fftSize);
            if(_levelTimer) clearInterval(_levelTimer);
            _levelTimer=setInterval(()=>{
                try{
                    _levelAnalyser.getFloatTimeDomainData(buf);
                    const db=_computeRMS(buf);
                    _recentRMS.push({t:performance.now(), db});
                    if(_recentRMS.length>200) _recentRMS.splice(0,_recentRMS.length-200);
                    // 500ms毎に概況を出す（スパム防止）
                    if(Math.floor(performance.now()/500)!==Math.floor((performance.now()-100)/500)){
                        console.log('[level]', db.toFixed(1),'dB', 'isPlaying=',isPlaying);
                    }
                }catch(e){ /* ignore */ }
            }, 100);
            console.warn('Level meter: ON');
        }else{
            if(_levelTimer){ clearInterval(_levelTimer); _levelTimer=null; }
            // _levelAnalyser は残しても副作用なし（接続は監視のみ）
            console.warn('Level meter: OFF');
        }
    }catch(e){ console.warn('level meter failed',e); }
};
window._dumpRecentRMS=function(n=30){
    const arr=_recentRMS.slice(-n).map(x=>({dt:((x.t-(_recentRMS[0]?.t||x.t))/1000).toFixed(2)+'s', db:x.db.toFixed(1)}));
    console.table(arr);
};
// ---- Environment / Debug Helpers ----
function showFileProtocolWarning(){ /* 何もしない（ダイアログ非表示） */ }
window.playTestTone=function(){ ensureAudio(); const t=audioCtx.currentTime; try{ const osc=audioCtx.createOscillator(); const g=audioCtx.createGain(); osc.type='sine'; osc.frequency.setValueAtTime(440,t); g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.4,t+0.02); g.gain.exponentialRampToValueAtTime(0.0001,t+1.2); osc.connect(g); g.connect(masterGain||audioCtx.destination); osc.start(t); osc.stop(t+1.25); console.log('Test tone scheduled'); }catch(e){ console.warn('test tone failed',e); } };
window.showSchedStat=function(){ console.log('scheduledCounter',scheduledCounter,'playbackPosition',playbackPosition.toFixed(3)); };
// ================= ZIP Piano Loader (Skeleton) =================
// Store(無圧縮) 専用 簡易 unzip フォールバック (mini pack 用)
function unzipStoreOnly(u8){
    const files={};
    let p=0; const dv=new DataView(u8.buffer,u8.byteOffset,u8.byteLength);
    function readStr(off,len){ return new TextDecoder().decode(u8.subarray(off,off+len)); }
    while(p+4<=u8.length){
        const sig=dv.getUint32(p,true);
        if(sig===0x04034b50){ // local file header
            if(p+30>u8.length) break;
            const compMethod=dv.getUint16(p+8,true); // 0=store
            const compSize=dv.getUint32(p+18,true);
            const uncompSize=dv.getUint32(p+22,true);
            const nameLen=dv.getUint16(p+26,true);
            const extraLen=dv.getUint16(p+28,true);
            const nameStart=p+30;
            const dataStart=nameStart+nameLen+extraLen;
            if(dataStart+compSize>u8.length){ console.warn('ZIP fallback: data overflow'); break; }
            const name=readStr(nameStart,nameLen);
            if(compMethod!==0){ console.warn('ZIP fallback: 非対応圧縮 method',compMethod,'名前',name); return null; }
            const data=u8.slice(dataStart,dataStart+compSize); // store なのでそのまま
            files[name]=data;
            p=dataStart+compSize; // 次へ
            continue;
        }
        if(sig===0x02014b50 || sig===0x06054b50){ // central directory or end
            break; // local 部終了
        }
        // 不明シグネチャ -> 中断
        break;
    }
    return Object.keys(files).length? files:null;
}
async function loadPianoZipFile(f){
    if(!f){ return; }
    setPianoZipStatus('読み込み中...');
    let ab; try{ ab=await f.arrayBuffer(); }catch(e){ setPianoZipStatus('読み込み失敗'); console.warn(e); return; }
    // 依存: fflate
    let files=null; let usedFallback=false;
    const bufU8=new Uint8Array(ab);
    if(fflate && typeof fflate.unzipSync==='function' && !/本物のライブラリ/.test(fflate.unzipSync.toString())){
        try{ files=fflate.unzipSync(bufU8); }
        catch(e){ console.warn('fflate unzip 失敗, fallback 試行',e); }
    }
    if(!files){
        files=unzipStoreOnly(bufU8); usedFallback=true;
    }
    if(!files){ setPianoZipStatus('ZIP展開失敗'); return; }
    // manifest 探索
    let manifestEntry=null; for(const k in files){ if(/manifest\.json$/i.test(k)){ manifestEntry=k; break; } }
    if(!manifestEntry){ setPianoZipStatus('manifest.json 不在'); return; }
    try{ const txt=new TextDecoder().decode(files[manifestEntry]); pianoZipManifest=JSON.parse(txt); }catch(e){ setPianoZipStatus('manifest解析失敗'); console.warn(e); return; }
    pianoZipFiles=files; setPianoZipStatus('manifest読み込み完了'+(usedFallback?' (fallback unzip)':''));
    prepareInitialSampleQueue();
    startProgressiveDecode();
}
function prepareInitialSampleQueue(){
    if(!pianoZipManifest || !pianoZipManifest.files) return;
    // 中心 (manifest.center または 60) ±6 の mf 層を優先。無ければ他層。
    const center=pianoZipManifest.center||60; const mfLayer=(pianoZipManifest.layers||[]).includes('mf')? 'mf': (pianoZipManifest.layers? pianoZipManifest.layers[0]: null);
    const essential=[]; const others=[];
    pianoZipManifest.files.forEach(e=>{
        if(e.release) return; // 後回し
        if(!e.layer) e.layer=mfLayer;
        const dist=Math.abs((e.m??e.midi??e.note)-center);
        if(e.layer===mfLayer && dist<=6) essential.push(e); else others.push(e);
    });
    essential.sort((a,b)=>Math.abs((a.m??a.midi)-center)-Math.abs((b.m??b.midi)-center));
    pianoZipDecodeQueue=[...essential,...others];
}
function startProgressiveDecode(){ if(pianoZipDecoding) return; pianoZipDecoding=true; decodeNextInQueue(); }
function decodeNextInQueue(){
    if(!pianoZipDecodeQueue.length){ pianoZipDecoding=false; setPianoZipStatus('サンプル準備完了'); return; }
    if(pianoZipDecodePaused || isPlaying){ return decodeNextLater(); }
    const entry=pianoZipDecodeQueue.shift();
    const file=entry.file; if(!file){ decodeNextLater(); return; }
    const u8=findZipFile(file);
    if(!u8){ decodeNextLater(); return; }
    ensureAudio();
    audioCtx.decodeAudioData(u8.buffer.slice(u8.byteOffset,u8.byteOffset+u8.byteLength),buf=>{
        // 登録: midi 値と layer で辞書化 (簡易: pianoSampleBuffers を再利用するが layer無視)
    const midi=entry.m||entry.midi||entry.note;
        if(typeof midi==='number'){
            if(!pianoSampleMap[midi]) pianoSampleMap[midi]={layers:{},release:null,gains:{}};
            if(entry.release){ pianoSampleMap[midi].release=buf; }
            else {
                const layer=entry.layer||'mf';
        pianoSampleMap[midi].layers[layer]={ buffer:buf, root: midi, loop: entry.loop };
                if(typeof entry.gain==='number') pianoSampleMap[midi].gains[layer]=entry.gain;
                // 互換: 従来検索用に代表を pianoSampleBuffers へ
                pianoSampleBuffers[midi]=buf;
            }
        }
    if(entry.impulse || (pianoZipManifest && pianoZipManifest.impulse===entry.file)){ pianoIRBuffer=buf; ensureConvolver(); }
    // 統計
    if(typeof midi==='number' && !entry.release){ SAMPLE_USE_STATS[midi]={ lastUse:performance.now(), size:buf.length }; }
        setPianoZipStatus('デコード '+(Object.keys(pianoSampleBuffers).length)+' / ' + pianoZipManifest.files.length);
        decodeNextLater();
    },err=>{ console.warn('decode失敗',file,err); decodeNextLater(); });
}
function decodeNextLater(){ setTimeout(decodeNextInQueue, 30); }
function findZipFile(path){ if(!pianoZipFiles) return null; for(const k in pianoZipFiles){ if(k.endsWith(path)) return pianoZipFiles[k]; } return pianoZipFiles[path]||null; }
// UIイベント紐付け
if(pianoZipBtn && pianoZipInput){ pianoZipBtn.onclick=()=>pianoZipInput.click(); }
if(pianoZipInput){ pianoZipInput.onchange=e=>{ const f=e.target.files[0]; if(f) loadPianoZipFile(f); }; }
// SFZ フォルダ読込
if(sfzDirBtn && sfzDirInput){ sfzDirBtn.onclick=()=>sfzDirInput.click(); }
if(sfzDirInput){ sfzDirInput.onchange=async e=>{
    const files=[...e.target.files]; if(!files.length){ return; }
    setPianoZipStatus(`SFZ解析中... (入力:${files.length}件)`);
    if(files.length<=2){ console.warn('選択されたファイル数が極端に少ないです。フォルダ全体が選択されていない可能性があります。');
        if(sfzStatus) sfzStatus.textContent='入力が少なすぎます。フォルダ選択時は「フォルダを開く」で最上位の楽器フォルダを選んでください。WindowsではChrome/Edge推奨。';
    }
    if(sfzStatus) sfzStatus.textContent='読み込み中...';
    // 選択フォルダ内の .sfz を全て対象
    const sfzFiles=files.filter(f=>/\.sfz$/i.test(f.name));
    // 参考ログ: サンプル候補数
    const sampleCandidates=files.filter(f=>/\.(wav|ogg|m4a|mp3)$/i.test(f.name)).length;
    if(window.DEBUG_SAMPLE_NOTE){ console.log('SFZ入力ファイル: sfz=', sfzFiles.length, ' samples=', sampleCandidates, ' total=', files.length); }
    if(sfzStatus){ sfzStatus.textContent = `検出: 全${files.length}件 / sfz ${sfzFiles.length}件 / サンプル ${sampleCandidates}件`; }
    if(sampleCandidates===0){ if(sfzStatus) sfzStatus.textContent += '（サンプル0件：samplesフォルダごと最上位を選択してください）'; }
    if(!sfzFiles.length){ setPianoZipStatus('sfzが見つかりません'); if(sfzStatus) sfzStatus.textContent='読み込み失敗(sfzなし)'; return; }
    ensureAudio();
    // ファイルマップ（相対パス→File）と小文字正規化インデックス
    const fileMap={};
    const fileMapLower=new Map();
    const nameIndexLower=new Map(); // basename(lower) -> File（重複時は配列にする）
    files.forEach(f=>{
        const p=f.webkitRelativePath.replace(/\\/g,'/');
        fileMap[p]=f; fileMap[f.name]=f;
        const pl=p.toLowerCase(); fileMapLower.set(pl, f);
        const base=f.name.toLowerCase();
        if(!nameIndexLower.has(base)) nameIndexLower.set(base, f); else {
            const cur=nameIndexLower.get(base);
            if(Array.isArray(cur)) cur.push(f); else nameIndexLower.set(base, [cur, f]);
        }
    });
    // サンプルデコードキャッシュ
    const decodeCache=new Map(); // key: relPath -> AudioBuffer
    // 結果格納
    const loadedInstruments=[];
    // ログ統計
    const stats={ ok:0, fail:0, notFound:0, byExt:{} };

    // 共通ヘルパ: SFZテキスト→regions（<region>ブロックをマルチライン対応で抽出）
    function parseSfzRegions(sfzText){
        const regions=[]; let cur=null;
        const lines=sfzText.split(/\r?\n/);
        const addRegion=()=>{ if(cur && cur.sample){ regions.push(cur); } cur=null; };
        const globalKVs=Object.create(null);
        let groupKVs=Object.create(null);
        let currentSection='global'; // 'global' | 'group' | 'region' | other
        // sample= の拡張抽出: 次の「 空白+key= 」が来る直前までを値として採用（未引用の空白含み対応）
        function extractSampleFromLine(str){
            const m = str.match(/\bsample\s*=\s*/i);
            if(!m) return null;
            const start = str.search(/\bsample\s*=\s*/i) + m[0].length;
            let s = str.slice(start);
            if(!s) return null;
            // 引用されていればそのまま
            if(s[0]==='"' || s[0]==="'"){
                const q=s[0];
                const end=s.indexOf(q,1);
                if(end>0) return s.slice(1,end);
                return s.slice(1).trim();
            }
            // 未引用: 次の 「 空白+単語= 」 の直前まで
            const re=/\s+\w+\s*=\s*/g;
            const nxt=re.exec(s);
            const raw = (nxt? s.slice(0, nxt.index): s).trim();
            return raw;
        }
        const parseKVs=(str, target)=>{
            // 通常の key=value を一括抽出（引用対応）
            str.replace(/(\w+)=((?:"[^"]*"|'[^']*'|[^\s]+))/g,(_,k,v)=>{ if(v && (v[0]==='"' || v[0]==="'")) v=v.slice(1,-1); target[k]=v; return ''; });
            // sample= が未引用で空白を含んでいる場合の補正
            const ext = extractSampleFromLine(str);
            if(ext && target){ target.sample = ext; }
        };
        for(let raw of lines){
            let line=raw.replace(/\s*\/\/.*$/,'').trim(); // // コメント除去
            if(!line) continue;
            if(line.startsWith('<')){
                // 新しいヘッダ
                if(/<region/i.test(line)){
                    addRegion();
                    // region生成時に global と group のデフォルトを継承
                    cur=Object.assign(Object.create(null), globalKVs, groupKVs);
                    currentSection='region';
                    parseKVs(line, cur);
                } else {
                    // 別セクション開始で regionを確定
                    addRegion(); cur=null;
                    if(/<group/i.test(line)){
                        currentSection='group'; groupKVs=Object.create(null);
                        parseKVs(line, groupKVs);
                    } else if(/<control/i.test(line)){
                        currentSection='global';
                        parseKVs(line, globalKVs);
                    } else {
                        currentSection='global';
                        parseKVs(line, globalKVs);
                    }
                }
            } else {
                // ヘッダなし連続行。sample= を含む行は新しいregion開始とみなす
                if(/\bsample\s*=/.test(line)){
                    if(cur && cur.sample){ addRegion(); }
                    if(!cur){
                        // 現在がregion外で sample= 行に遭遇: 新規regionをglobal+groupから継承して開始
                        cur=Object.assign(Object.create(null), globalKVs, groupKVs);
                        currentSection='region';
                    }
                    parseKVs(line, cur);
                } else if(cur){
                    parseKVs(line, cur);
                } else {
                    // region外の行は、直近セクションに応じて格納
                    if(currentSection==='group') parseKVs(line, groupKVs);
                    else parseKVs(line, globalKVs);
                }
            }
        }
        addRegion();
        // 正規化
        function noteVal(v){
            if(v==null) return undefined; if(typeof v==='number') return v; const n=parseInt(v); if(!Number.isNaN(n)) return n; const s=String(v).trim(); const m=s.match(/^([A-Ga-g])([#bB]?)(-?\d+)$/); if(!m) return undefined; const step=m[1].toUpperCase(); const base={C:0,D:2,E:4,F:5,G:7,A:9,B:11}[step]; const accCh=m[2]; const acc=accCh==='#'?1:(accCh==='b'||accCh==='B'?-1:0); const oct=parseInt(m[3]); return (oct+1)*12 + base + acc; }
    const out = regions.map(m=>({ sample:m.sample, lokey:(noteVal(m.lokey) ?? noteVal(m.key)), hikey:(noteVal(m.hikey) ?? noteVal(m.key)), lovel:m.lovel?parseInt(m.lovel):0, hivel:m.hivel?parseInt(m.hivel):127, loop_start:m.loop_start?parseInt(m.loop_start):undefined, loop_end:m.loop_end?parseInt(m.loop_end):undefined, trigger:m.trigger||undefined, pitch_keycenter:(noteVal(m.pitch_keycenter) ?? noteVal(m.key)), loop_mode:m.loop_mode||undefined }));
        // default_path を regions メタとして付与
        if(globalKVs.default_path){
            let dp = String(globalKVs.default_path).replace(/\\/g,'/');
            if(!/\/$/.test(dp)) dp = dp + '/';
            out._defaultPath = dp;
        }
    if(window.DEBUG_SAMPLE_NOTE){ console.log('SFZ regions parsed:', out.length); }
    return out;
    }

    // 各SFZを処理
    const totalSfz=sfzFiles.length;
    for(let _i=0; _i<sfzFiles.length; _i++){
        const sfzFile=sfzFiles[_i];
        if(sfzStatus) sfzStatus.textContent=`読み込み中... (${_i+1}/${totalSfz})`;
        const sfzText=await sfzFile.text();
        const basePath=sfzFile.webkitRelativePath.replace(/[^\/]*$/,'').replace(/\\/g,'/').replace(/\/$/,'');
    const regions=parseSfzRegions(sfzText);
    const regionCount = regions.length;
        if(!regions.length) continue;
        // 新しいマップを構築
        const map={};
        // デコード関数（キャッシュ付き）
        function normJoinResolve(base, rel){
            // 正規化: base/rel を結合し ./ .. を解決
            const raw=(rel.startsWith('/')? rel.slice(1): (base? base.replace(/\/?$/,'/')+rel: rel))
                .replace(/\\/g,'/').replace(/\/\//g,'/');
            const parts=[]; raw.split('/').forEach(seg=>{
                if(!seg||seg==='.') return; if(seg==='..'){ if(parts.length) parts.pop(); return; } parts.push(seg);
            });
            return parts.join('/');
        }
        function buildCandidates(base, defp, samp){
            const cands=[];
            const dp = defp? String(defp).replace(/\\/g,'/').replace(/^\/+|\/+$/g,'') : '';
            const s = String(samp||'').replace(/\\/g,'/');
            const tryPush=(p)=>{ if(p && !cands.includes(p)) cands.push(p); };
            // 1) base + defp + sample
            tryPush(normJoinResolve(base, (dp? dp+'/' : '') + s));
            // 2) base + sample
            tryPush(normJoinResolve(base, s));
            // 3) base + samples/ + sample（よくある配置）
            tryPush(normJoinResolve(base, 'samples/'+s));
            // 4) defp が 'samples'で、二重を避けた variants
            if(dp && !/^samples\//i.test(dp)){
                tryPush(normJoinResolve(base, 'samples/'+dp+'/'+s));
            }
            return cands;
        }
        function resolveFile(rel){
            // 候補列挙
            const cand=[];
            const c1=rel; cand.push(c1);
            const c2=rel.replace(/^\.\//,''); if(c2!==c1) cand.push(c2);
            const c3=normJoinResolve('', rel); if(cand.indexOf(c3)<0) cand.push(c3);
            // exact
            for(const c of cand){ if(fileMap[c]) return fileMap[c]; }
            // lower-case
            for(const c of cand){ const f=fileMapLower.get(c.toLowerCase()); if(f) return f; }
            // basename一致（ユニーク時のみ）
            const base=rel.split('/').pop().toLowerCase();
            const hit=nameIndexLower.get(base);
            if(hit && !Array.isArray(hit)) return hit;
            return null;
        }
        async function decodeByPath(relOrList){
            const list = Array.isArray(relOrList)? relOrList : [relOrList];
            // 1つの候補パスにつき、拡張子フォールバックを試す
            function buildExtVariants(p){
                const seen=new Set(); const out=[];
                const m=p.match(/^(.*)\.([A-Za-z0-9]+)$/);
                if(m){
                    const base=m[1]; const ext=m[2].toLowerCase();
                    getAltSampleExts().forEach(e=>{ const q=base+'.'+e; if(!seen.has(q)){ seen.add(q); out.push(q); } });
                    if(!seen.has(p)) out.push(p);
                    return out;
                } else {
                    getAltSampleExts().forEach(e=>{ const q=p+'.'+e; if(!seen.has(q)){ seen.add(q); out.push(q); } });
                    if(!seen.has(p)) out.push(p); return out;
                }
            }
            for(const rel of list){
                const variants=buildExtVariants(rel);
                for(const v of variants){
                    const key=v; if(decodeCache.has(key)) return decodeCache.get(key);
                    const f=resolveFile(v);
                    if(!f){ continue; }
                    let ab; try{ ab=await f.arrayBuffer(); }catch(_){ stats.fail++; continue; }
                    const buf=await new Promise(res=> audioCtx.decodeAudioData(ab, b=>res(b), ()=>res(null)));
                    if(buf){ decodeCache.set(key, buf); stats.ok++; const ext=(f.name.split('.').pop()||'').toLowerCase(); stats.byExt[ext]=(stats.byExt[ext]||0)+1; return buf; }
                    else { stats.fail++; continue; }
                }
                if(window.DEBUG_SAMPLE_NOTE){ console.warn('sample not found/decoded for any ext', rel); }
                stats.notFound++;
            }
            return null;
        }
        // ファイル名からMIDIを推定するヘルパ
        function inferMidiFromFilename(samplePath){
            try{
                const base = String(samplePath||'').split('/')?.pop()||'';
                const name = base.replace(/\.[A-Za-z0-9]+$/,'');
                // パターン1: 音名 + オクターブ (C#4, Db3 など)
                const m1 = name.match(/(^|[^A-Za-z])([A-Ga-g])([#b]{1,2})?(-?\d)($|[^A-Za-z0-9])/);
                if(m1){
                    const step=m1[2].toUpperCase();
                    const baseIdx={C:0,D:2,E:4,F:5,G:7,A:9,B:11}[step];
                    const accStr=m1[3]||''; let acc=0; if(accStr){ if(/##/.test(accStr)) acc=2; else if(/#/.test(accStr)) acc=1; else if(/bb/.test(accStr)) acc=-2; else if(/b/.test(accStr)) acc=-1; }
                    const oct=parseInt(m1[4]);
                    const midi=(oct+1)*12 + baseIdx + acc; if(midi>=0 && midi<=127) return midi;
                }
                // パターン2: 裸の番号 0..127 （m60, _60, -60- 等を許容）
                const m2 = name.match(/(?:^|[^0-9])(1[01][0-9]|12[0-7]|\d?\d)(?:[^0-9]|$)/);
                if(m2){ const n=parseInt(m2[1]||m2[0]); if(n>=0 && n<=127) return n; }
            }catch(_){ }
            return null;
        }
    let swapCount = 0;
    for(const r of regions){
            // default_path サポート + 複数候補の正規化解決
            const defp = (regions && regions._defaultPath)? String(regions._defaultPath): '';
            const candPaths = buildCandidates(basePath, defp, r.sample);
            const buf=await decodeByPath(candPaths);
            if(!buf) continue;
            // WAVメタ（ループ）
            let meta={ sampleRate:0, loopStart:null, loopEnd:null };
            try{
                // 解析用に最初に解決できたファイルを再取得
                const f=resolveFile(candPaths[0]);
                if(f){ const ab=await f.arrayBuffer(); meta=readWavMeta(ab); }
            }catch(_){ }
            // キー範囲の補完/スワップ: lokey/hikey 未指定時は pitch_keycenter→ファイル名から推定。逆転時は入れ替え。
            let lo = (r.lokey!=null? r.lokey: undefined);
            let hi = (r.hikey!=null? r.hikey: undefined);
            if(lo==null && hi==null){
                const rootGuess = (r.pitch_keycenter!=null? r.pitch_keycenter: inferMidiFromFilename(r.sample));
                if(rootGuess!=null){ lo=hi=rootGuess; }
            }
            if(lo==null) lo = (hi!=null? hi: 60);
            if(hi==null) hi = lo;
            lo = Math.max(0, Math.min(127, lo));
            hi = Math.max(0, Math.min(127, hi));
            if(hi < lo){ const tmp=lo; lo=hi; hi=tmp; swapCount++; }
            const velLo=r.lovel??0, velHi=r.hivel??127;
            const layer = velHi<=50? 'pp': velLo>=90? 'ff': 'mf';
            const root = (r.pitch_keycenter!=null? r.pitch_keycenter: Math.round((lo+hi)/2));
            for(let m=lo; m<=hi; m++){
                if(!map[m]) map[m]={layers:{},release:null,gains:{}};
                if(r.trigger==='release'){ map[m].release=buf; continue; }
                if(!map[m].layers[layer]){
                    let loopSec;
                    if(r.loop_start!=null && r.loop_end!=null){
                        const sr=(meta.sampleRate||buf.sampleRate);
                        loopSec={ s:r.loop_start/sr, e:r.loop_end/sr };
                    } else if(meta.loopStart!=null && meta.loopEnd!=null){
                        const sr=(meta.sampleRate||buf.sampleRate);
                        loopSec={ s: meta.loopStart/ sr, e: meta.loopEnd/ sr };
                    } else if(r.loop_mode==='loop_continuous'){
                        loopSec={ s: Math.min(0.02, Math.max(0, buf.duration*0.02)), e: Math.max(0.05, buf.duration-0.02) };
                    }
                    map[m].layers[layer]={ buffer:buf, root, loop: undefined, loopSec };
                }
            }
        }
        // 楽器推定と割当
        const dirName=(basePath.split('/')?.pop()||'').toLowerCase();
        const fileName=sfzFile.name.toLowerCase();
        const isFlute = /flute/.test(dirName) || /flute/.test(fileName);
        const isPiano = /piano/.test(dirName) || /piano/.test(fileName);
    const keyCount=Object.keys(map).length; if(window.DEBUG_SAMPLE_NOTE){ console.log('SFZ built map', {file:sfzFile.name, keys:keyCount}); }
    if(window.DEBUG_SAMPLE_NOTE){
        const byExtStr = Object.entries(stats.byExt).map(([k,v])=>`${k}:${v}`).join(',');
        console.log(`[SFZ] ${sfzFile.name} regions=${regionCount} keys=${keyCount} swaps=${swapCount} ok=${stats.ok} fail=${stats.fail} notFound=${stats.notFound} byExt={${byExtStr}}`);
        console.log('SFZ decode summary', {file:sfzFile.name, ok:stats.ok, fail:stats.fail, notFound:stats.notFound, byExt:stats.byExt});
    }
        if(isFlute){ instrumentMaps.Flute=map; loadedInstruments.push('Flute'); }
        if(isPiano){ instrumentMaps.Piano=map; pianoSampleMap=map; loadedInstruments.push('Piano'); }
        if(!isFlute && !isPiano){
            // 指定なし: Pianoにフォールバック
            instrumentMaps.Piano=map; pianoSampleMap=map; loadedInstruments.push('Piano?');
        }
    }
    useSamplePiano=true; pianoSamplesLoaded=true;
    const label = loadedInstruments.length? loadedInstruments.join(', '): 'Unknown';
    const fmt = SELECTED_SAMPLE_PRIMARY? ' [fmt: '+SELECTED_SAMPLE_PRIMARY+']' : '';
    setPianoZipStatus('SFZロード完了('+label+')'+fmt); if(sfzStatus) sfzStatus.textContent='準備OK('+label+')'+fmt;
    // 単音自動選択とセンタリング（GUIのメロディ選択に反映）
    autoSelectMelodyTrackIfMonophonic(); autoCenterMelodyTrack();
    // 新しいマップを反映して再スケジュール
    scheduleAll(); if(isPlaying){ pausePlayback(); startPlayback(); }
}; }
// ===============================================================
// ZIPサンプル再生 (ベロシティ推定は簡易: 同時発音数で層切替)
function playFromZipPiano(midi,when,dur,outGain, inst){
    // 楽器切替: inst='Flute' の場合は fluteMap を参照、デフォは piano
    const map = inst==='Flute'? (instrumentMaps.Flute||pianoSampleMap) : (instrumentMaps.Piano||pianoSampleMap);
    if(map && map!==pianoSampleMap){ /* instrument-specific */ }
    const sampleMap = map || pianoSampleMap;
    if(!sampleMap[midi]){
        // 広範囲の最近傍キー探索（全キーから最近距離）
        let bestKey=null, bestDist=1e9; const keys=Object.keys(sampleMap);
        for(const k of keys){ const km=parseInt(k); if(!sampleMap[km]) continue; const d=Math.abs(km-(midi)); if(d<bestDist){ bestDist=d; bestKey=km; if(d===0) break; } }
        if(bestKey!=null){ if(window.DEBUG_SAMPLE_NOTE){ console.log('map-miss fallback ->', {req:midi, hit:bestKey, dist:bestDist}); }
            midi=bestKey;
        } else {
            if(window.DEBUG_SAMPLE_NOTE){ console.warn('map-miss no-fallback', {req:midi}); }
            return false;
        }
    }
    const info=sampleMap[midi];
    // 近傍同時発音数を"開始時刻の近傍"で推定（先読みで無限大にならないよう）
    try{
        const cutoff = when - (POLY_WINDOW||0.025);
        // 古い開始記録を除去（配列先頭からカット）
        let idx=0; while(idx<RECENT_STARTS.length && RECENT_STARTS[idx] < cutoff) idx++;
        if(idx>0) RECENT_STARTS.splice(0, idx);
    }catch(_){ }
    const nearCount = (()=>{
        try{ const w=POLY_WINDOW||0.025; let c=0; for(let i=0;i<RECENT_STARTS.length;i++){ const t=RECENT_STARTS[i]; if(Math.abs(t-when)<=w) c++; } return c; }catch(_){ return 0; }
    })();
    const conc = 1 + nearCount; // このノート自身を含む
    const strengthBase = (conc/6) + (dur>1?0.4:0) + (sustainPedal?0.25:0);
    const layers=Object.keys(info.layers);
    if(!layers.length) return false;
    let targetLayer='mf';
    if(layers.length===1) targetLayer=layers[0];
    else {
        if(strengthBase<0.4 && layers.includes('pp')) targetLayer='pp';
        else if(strengthBase>1.1 && layers.includes('ff')) targetLayer='ff';
        else if(layers.includes('mf')) targetLayer='mf';
        else targetLayer=layers[0];
    }
    const layerObj=info.layers[targetLayer]; if(!layerObj) return false;
    const buf=layerObj.buffer||layerObj; if(!buf) return false;
    // ルートからの半音差でレート調整
    const root=layerObj.root??midi; const semis=(midi - root); const rate=Math.pow(2, semis/12);
    // クリック抑制: 現在時刻に極端に近い場合のみ +2ms 先送り（遠い将来のノートは元のwhenを維持）
    const slop = 0.002;
    const startAt = (when - audioCtx.currentTime) < slop ? (audioCtx.currentTime + slop) : when;
    // 過負荷防止: 直前で整理
    try{ cleanupSampleVoices(audioCtx.currentTime); sampleVoiceStealIfNeeded(); }catch(_){ }
    const src=audioCtx.createBufferSource(); src.buffer=buf; try{ src.playbackRate.setValueAtTime(rate, startAt);}catch(_){ src.playbackRate.value=rate; }
    // DC/低域トランジェントのクリック低減
    const hp=audioCtx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=20; hp.Q.value=0.707;
    const g=audioCtx.createGain();
    // gain 正規化 (dB→線形)
    const db = info.gains[targetLayer]||0; const baseGain=Math.pow(10, db/20);
    // 多発音時のピーク抑制: 動的スケーリング（~1/sqrt(N)）
    const dynScale = 1/Math.sqrt(Math.max(1, conc));
    const targetAmp = Math.min(0.85, Math.max(0.05, 0.65 * baseGain * dynScale));
    if(g.gain.cancelAndHoldAtTime){ try{ g.gain.cancelAndHoldAtTime(startAt); }catch(_){ } }
    g.gain.setValueAtTime(0.0001,startAt);
    // フェードイン時間はノート長に応じて可変
    const desiredHold = Math.max(0.03, dur); // ノート本来の長さ（最小 30ms）
    const fadeInDur = Math.max(0.008, Math.min(0.03, desiredHold*0.4));
    try{ g.gain.linearRampToValueAtTime(targetAmp, startAt+fadeInDur); }catch(_){ g.gain.setValueAtTime(targetAmp, startAt+fadeInDur); }
    // 再生長計算 & ループ対応: ノートの長さ dur を反映（後段で十分なリリースを確保）
    let loopable=false; let loopConf=null; let playDur;
    const raw = buf.duration / Math.max(0.0001, rate); // ピッチシフト後に実際に鳴る最大長
    const manifestFiles = (pianoZipManifest && pianoZipManifest.files)? pianoZipManifest.files: [];
    const meta = manifestFiles.find(e=> (e.m===midi||e.midi===midi||e.note===midi) && e.layer===targetLayer);
    const loopMeta = layerObj.loop || meta?.loop;
    if(layerObj.loopSec && typeof layerObj.loopSec.s==='number' && typeof layerObj.loopSec.e==='number' && layerObj.loopSec.e>layerObj.loopSec.s){
        loopable=true; src.loop=true; src.loopStart=layerObj.loopSec.s; src.loopEnd=layerObj.loopSec.e;
    } else if(loopMeta && typeof loopMeta.s==='number' && typeof loopMeta.e==='number' && loopMeta.e>loopMeta.s+1000){
        loopable=true; loopConf=loopMeta; src.loop=true; src.loopStart=loopConf.s / (pianoZipManifest.sampleRate||48000); src.loopEnd=loopConf.e / (pianoZipManifest.sampleRate||48000);
    }
    // desiredHold は上で定義済み。ぶつ切り回避のため、十分なリリースを確保する。
    // 楽器に応じてリリースを長めに（Fluteは特に長め）
    const isFlute = (inst==='Flute');
    const tc = sustainPedal? (isFlute? 0.60: 0.50) : (isFlute? 0.50: 0.35); // setTargetAtTime の時定数(微増)
    const minExtra = sustainPedal? (isFlute? 1.2: 0.9) : (isFlute? 0.7: 0.5); // 最低余韻（微増）
    // ループ有無で最大長を制限
    if(loopable){
        playDur = desiredHold; // ループはnote長に忠実（リリースは別途）
    } else {
        playDur = Math.min(raw, desiredHold);
    }
    if(!playDur || !isFinite(playDur)) playDur = Math.min(raw, desiredHold);
    if(window.DEBUG_SAMPLE_NOTE){ console.log('zipPlay', {midi,layer:targetLayer,loopable,playDur:playDur.toFixed(3),dur}); }
    // リリースは dur 経過から。指数(目標0)で緩やかに減衰。
    const fadeStart = startAt + playDur;
    try{ g.gain.setValueAtTime(targetAmp, fadeStart); g.gain.setTargetAtTime(0.0001, fadeStart, tc); }catch(_){ }
    src.connect(hp); hp.connect(g); g.connect(outGain);
    try { src.start(startAt); } catch(_){ src.start(startAt); }
    // setTargetAtTime は漸近的に0へ向かうため、4×時定数 + 最低余韻 で停止（ほぼ無音）
    let stopAt = fadeStart + Math.max(minExtra, tc*4) + 0.02;
    // ループ無し時も、生バッファ終端に軽いテール余裕（+20ms）を許容
    if(!loopable){ stopAt = Math.min(startAt + raw + 0.02, stopAt); }
    try{ src.stop(stopAt); }catch(_){ }
    activeSampleVoices.push({end: stopAt + 0.2, g, src});
    // この開始を記録（将来の同時発音推定用）
    try{
        RECENT_STARTS.push(startAt);
        if(RECENT_STARTS.length>4096){ RECENT_STARTS.splice(0, RECENT_STARTS.length-2048); }
    }catch(_){ }
    if(SAMPLE_USE_STATS[midi]) SAMPLE_USE_STATS[midi].lastUse=performance.now();
    // リリースサンプル (ペダルOFF && 指定あり)
    if(info.release && !sustainPedal){
        const rsrc=audioCtx.createBufferSource(); rsrc.buffer=info.release; const rg=audioCtx.createGain(); const rt=startAt+dur+0.005; 
        rg.gain.setValueAtTime(0.0001,rt); 
        try{ rg.gain.linearRampToValueAtTime(0.45,rt+0.008);}catch(_){ rg.gain.setValueAtTime(0.45,rt+0.008);} 
        rg.gain.setTargetAtTime(0,rt+0.25,0.25); 
        rsrc.connect(rg); rg.connect(outGain); 
        rsrc.start(rt); 
        const rStop = rt+Math.min(1.2, info.release.duration+0.4);
        rsrc.stop(rStop);
        // リリースノードも追跡（強制停止用）
        activeSampleVoices.push({end: rStop + 0.2, g: rg, rsrc});
    }
    return true;
}

// ================== Simple SFZ Playback (Isolated path) ==================
// 最小構成: 1 BufferSource -> Gain -> (optional) HPF -> out
// レイヤ選択: vel相当は無視し mf 優先、ルートからの半音差で rate だけ調整
function simpleSfzMap(){
    // Pianoを優先、無ければFlute、それも無ければ pianoSampleMap
    if(instrumentMaps.Piano && Object.keys(instrumentMaps.Piano).length) return instrumentMaps.Piano;
    if(instrumentMaps.Flute && Object.keys(instrumentMaps.Flute).length) return instrumentMaps.Flute;
    return pianoSampleMap;
}
function simpleFindNearestKey(map, midi){
    if(map[midi]) return midi;
    let best=null,bd=1e9; for(const k of Object.keys(map)){ const m=parseInt(k); if(!map[m]) continue; const d=Math.abs(midi-m); if(d<bd){ bd=d; best=m; if(d===0) break; } }
    return best;
}
function simplePlaySfz(midi, when, dur, out){
    try{
        const map = simpleSfzMap(); if(!map||!audioCtx) return false;
        let key = (map[midi]? midi: simpleFindNearestKey(map, midi)); if(key==null) return false;
        const info = map[key];
        // 層は mf優先→他の1つ
        const layers = Object.keys(info.layers||{}); if(!layers.length) return false;
        const layer = layers.includes('mf')? 'mf': layers[0]; const entry = info.layers[layer];
        const buf = entry.buffer||entry; if(!buf) return false;
        const root = entry.root ?? key; const rate = Math.pow(2, (midi-root)/12);
        const startAt = Math.max(audioCtx.currentTime+0.002, when||audioCtx.currentTime+0.002);
        const g = audioCtx.createGain(); g.gain.setValueAtTime(0.0001, startAt); g.gain.linearRampToValueAtTime(0.6, startAt+0.01);
        const src = audioCtx.createBufferSource(); src.buffer=buf; try{ src.playbackRate.setValueAtTime(rate, startAt);}catch(_){ src.playbackRate.value=rate; }
        // 簡易テール
        const playHold = Math.max(0.05, dur||0.2);
        const stopAt = startAt + Math.min(buf.duration/Math.max(0.001,rate), playHold+0.5);
        g.gain.setValueAtTime(0.6, stopAt);
        g.gain.setTargetAtTime(0.0001, stopAt, 0.25);
        src.connect(g); g.connect(out||masterGain||audioCtx.destination);
        src.start(startAt); src.stop(stopAt+0.05);
        // 強制停止のために追跡
        activeSampleVoices.push({end: stopAt+0.2, g, src});
        return true;
    }catch(_){ return false; }
}
function scheduleMoreSimple(){
    if(!isPlaying||!audioCtx||!currentTracks.length) return;
    const now=audioCtx.currentTime;
    const gvEl=document.getElementById('guideVolumeSlider');
    const avEl=document.getElementById('accompVolumeSlider');
    const enableMel = gvEl? (parseFloat(gvEl.value)>0.01) : true;
    const enableAcc = avEl? (parseFloat(avEl.value)>0.01) : true;
    const isTrackEnabled=(ti)=>{ const isMel=(ti===melodyTrackIndex); if((isMel && !enableMel) || (!isMel && !enableAcc)) return false; return (currentTracks[ti]?.notes?.length>0); };
    const baseAhead = 0.4; // さらに短い先読み
    let from = isFinite(scheduledUntil)? scheduledUntil: (playbackPosition||0);
    let target = Math.max(from+baseAhead, (playbackPosition||0)+baseAhead);
    let scheduled=0; const limit=80;
    if(window.DEBUG_SIMPLE){ try{ console.log('[sched-simple] win from',from.toFixed(3),'target',target.toFixed(3),'pos', (playbackPosition||0).toFixed(3)); }catch(_){ } }
    for(let ti=0; ti<currentTracks.length && scheduled<limit; ti++){
        if(!isTrackEnabled(ti)) continue;
        const out = (ti===melodyTrackIndex)? (melodyGain||masterGain||audioCtx.destination): (accompGain||masterGain||audioCtx.destination);
        const notes=currentTracks[ti].notes;
        for(const n of notes){ const st=n.time, en=st+n.duration; if(en<=from) continue; if(st>=target) break; let when = (playbackStartTime||audioCtx.currentTime) + (st - (playbackStartPos||0)); if(btLatencyEnabled) when -= btLatencySec; if(when < now - 0.01) when = now + 0.002; if(simplePlaySfz(n.midi, when, n.duration, out)){ scheduled++; scheduledCounter++; if(window.DEBUG_SIMPLE){ try{ console.log('[sched-simple] note', {ti, midi:n.midi, when:(when-audioCtx.currentTime).toFixed(3)}); }catch(_){ } } } if(scheduled>=limit) break; }
    }
    scheduledUntil = target;
    if(window.DEBUG_SIMPLE){ try{ console.log('[sched-simple] scheduled:',scheduled,'scheduledUntil->',target.toFixed(3)); }catch(_){ } }
    // 休符が続いてスケジュール0件なら、次ノートへ最大30秒までジャンプ
    if(scheduled===0){
        let nextT=Infinity;
        for(let ti=0; ti<currentTracks.length; ti++){
            if(!isTrackEnabled(ti)) continue;
            const notes=currentTracks[ti].notes;
            for(const n of notes){ const st=n.time; if(st>from+1e-6){ if(st<nextT) nextT=st; break; } }
        }
        if(isFinite(nextT)){
            const jumpTo = Math.min(nextT, from + 30);
            scheduledUntil = jumpTo;
            if(window.DEBUG_SIMPLE){ try{ console.log('[sched-simple] rest-jump from', from.toFixed(3),'->', jumpTo.toFixed(3)); }catch(_){ } }
        }
    }
}
// LRU 開放 (デコード数が閾値超過時 古い & 遠音域層を削除)
function maybeRunLru(){ const now=performance.now(); if(now-lastLruCheck < LRU_CHECK_INTERVAL) return; lastLruCheck=now; const keys=Object.keys(pianoSampleMap); if(keys.length < MAX_DECODED_SAMPLES_SOFT) return; const arr=[]; keys.forEach(k=>{ const midi=parseInt(k); const stat=SAMPLE_USE_STATS[midi]; if(!stat) return; const dist=Math.abs(midi- (pianoZipManifest?.center||60)); arr.push({midi,last:stat.lastUse,dist}); }); arr.sort((a,b)=> (a.last-b.last)|| (b.dist-a.dist)); // 古く & 遠い優先
    const removeCount=Math.min(10, Math.max(0, keys.length-MAX_DECODED_SAMPLES_SOFT)); for(let i=0;i<removeCount;i++){ const target=arr[i]; const info=pianoSampleMap[target.midi]; if(!info) continue; // 解放
        Object.values(info.layers).forEach(buf=>{ /* GC任せ */ }); if(info.release){ /* ignore */ }
        delete pianoSampleMap[target.midi]; delete pianoSampleBuffers[target.midi]; delete SAMPLE_USE_STATS[target.midi]; }
}

// ===== Responsive layout helpers: 端末幅に合わせてUIを調整（横スクロール抑止＆固定バー重なり回避） =====
let __resizeTimer = null;
function adjustForFixedBar(){
    try{
        const bar = document.getElementById('mic-permission-bar');
        const top = document.getElementById('top-bar');
        if(!bar || !top) return;
        // トップバー内の通常フローのため、JSによる位置補正は不要
        // 念のため折返しが効くようだけ整える
        bar.style.display = 'inline-flex';
        bar.style.flexWrap = 'wrap';
    }catch(_){ /* no-op */ }
}
function clampToViewport(){
    try{
        const ids = ['top-bar','transportBar','markers','controls','timelineScrollBar','chartContainer'];
        for(const id of ids){
            const el = document.getElementById(id);
            if(!el) continue;
            el.style.width = '100%';
            el.style.maxWidth = '100%';
            el.style.overflowX = 'clip';
        }
        // 長いファイル名ラベル等は折返し優先
        const labels = ['melodyAudioLabel','accompAudioLabel'];
        for(const id of labels){
            const el = document.getElementById(id);
            if(!el) continue;
            el.style.whiteSpace = 'normal';
            el.style.overflow = 'hidden';
            el.style.textOverflow = 'clip';
            el.style.maxWidth = '100%';
        }
        // ドキュメント全体にも横オーバーフロー抑止
        try{ document.documentElement.style.overflowX = 'hidden'; document.body.style.overflowX = 'hidden'; }catch(_){ }

        // 実測: ビューポート超過要素を検出し、その場でクランプ
        const vw = Math.max(0, window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth || 0);
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
        while(walker.nextNode()){
            const el = walker.currentNode;
            if(!(el instanceof HTMLElement)) continue;
            // スクロール幅がクライアント幅を超えている要素のみ対象
            const sw = el.scrollWidth;
            const cw = el.clientWidth;
            if(sw > cw || sw > vw){
                // 例外: canvas は親幅に依存するため width:100% を優先
                if(el.tagName.toLowerCase() === 'canvas'){
                    el.style.maxWidth = '100%';
                    el.style.width = '100%';
                } else {
                    el.style.maxWidth = '100%';
                    // 固定幅を持つ場合は柔軟に
                    if(el.style.width && !el.style.width.includes('%')){
                        el.style.width = '100%';
                    }
                }
                el.style.overflowX = 'hidden';
            }
        }
    }catch(_){ /* no-op */ }
}
function adjustResponsiveLayout(){
    adjustForFixedBar();
    clampToViewport();
    fitMainAreaHeight();
}

// 画面の高さいっぱいに「チャート＋タイムライン＋再生ボタン群」が収まるように、
// チャートエリア(#chartContainer)の高さを動的に算出して設定（モバイル/タブレット対象）。
function fitMainAreaHeight(){
    // CSSのフレックスレイアウトで自動的に残り高さを割り当てるため、JSでは高さをいじらない
}

window.addEventListener('load',()=>{
    warnIfInsecureContext();
    resizeCanvas();
    updateMicGateVisual();
    autoCenterMelodyTrack();
    updateTimelineScrollRange();
    drawChart(); /* file:// 警告は表示しない */
    autoLoadSfzInstruments();
    // 初回にレイアウトを端末幅へフィット
    adjustResponsiveLayout();
    // レイアウト確定直後にももう一度サイズを確定させる（初回0px対策）
    setTimeout(()=>{ try{ resizeCanvas(); updateTimelineScrollRange(); drawChart(); }catch(_){ } }, 0);
    // ページ読み込み時は一切プロンプトしない。既に granted のときのみ静かに初期化する。
    (async()=>{
        try{
            const state = await getMicPermissionState();
            if(state==='granted' && !micAnalyser){ await initMic(false).catch(()=>{}); }
            // granted 以外は何もしない（フォールバックも装着しない）
        }catch(_){ /* 何もしない */ }
    })();
    // 入力デバイスが変わった際は自動で再初期化
    try{
        if(navigator.mediaDevices && navigator.mediaDevices.addEventListener){
            navigator.mediaDevices.addEventListener('devicechange', async()=>{
                try{ if(await canInitMicWithoutPrompt()){ await initMic(false).catch(()=>{}); } }catch(_){ }
            });
        }
    }catch(_){ }
    // 『赤点削除』ボタンのイベント
    try{
        const btn=document.getElementById('clearDotsButton');
        if(btn){ btn.onclick=()=>{ pitchHistory.length=0; drawChart(); }; }
    }catch(_){ }
    // 基礎練習UIのイベント
    try{
        if(practiceModeOn && practiceModeOff){
    practiceModeOn.onclick=()=>{
            activateAudioOnce();
            // 編集ツールバーは必ず隠す（排他）
            try{ if(editToolbar){ editToolbar.classList.add('hidden'); editToolbar.style.display='none'; } }catch(_){ }
                    // 既存データがある場合は保存を促す
                    const hasAudio = !!(window.melodyOrigBytes||window.accompOrigBytes||melodyBuffer||accompBuffer);
                    const hasDots = !!(pitchHistory && pitchHistory.length>0);
                    if(hasAudio || hasDots){
                        const ok = confirm('基礎練習モードに移行します。現在の内容を記録（保存）しますか？\n（キャンセルすると保存せずに続行）');
                        if(ok){ try{ saveSessionZip(); }catch(_){ } }
                    }
                    // 練習UIをフローティングツールバーへ移設して表示
                    if(practiceToolbar){
                        const frg=document.createDocumentFragment();
            if(practicePatternSelect){ practicePatternSelect.style.display=''; frg.appendChild(practicePatternSelect); }
            if(practiceRangeWrap){ practiceRangeWrap.style.display='inline-flex'; frg.appendChild(practiceRangeWrap); }
            if(practiceStartBtn){ practiceStartBtn.style.display=''; frg.appendChild(practiceStartBtn); }
            if(practicePauseBtn){ practicePauseBtn.style.display=''; frg.appendChild(practicePauseBtn); }
            if(practiceStopBtn){ practiceStopBtn.style.display=''; frg.appendChild(practiceStopBtn); }
            if(practiceVolWrap){ practiceVolWrap.style.display='inline-flex'; frg.appendChild(practiceVolWrap); }
                        practiceToolbar.appendChild(frg);
                        practiceToolbar.classList.remove('hidden');
                        practiceToolbar.style.display='flex';
                        if(practiceCloseBtn){ practiceCloseBtn.style.display='none'; }
                        // ボタン配線（重複防止のため毎回最新ハンドラに張り替え）
                        if(practiceCloseBtn){
                            practiceCloseBtn.onclick = ()=>{
                                // 通常モードへ戻すのと同等の処理を呼ぶ
                                if(practiceModeOff && typeof practiceModeOff.onclick==='function'){
                                    practiceModeOff.onclick();
                                } else {
                                    // フォールバック: 直接最低限の復帰
                                    if(isPracticing) stopBasicPractice(true);
                                    if(practiceToolbar){ practiceToolbar.classList.add('hidden'); practiceToolbar.style.display='none'; }
                                    if(practiceTopGroup){
                                        if(practicePatternSelect){ practicePatternSelect.style.display='none'; practiceTopGroup.appendChild(practicePatternSelect); }
                                        if(practiceRangeWrap){ practiceRangeWrap.style.display='none'; practiceTopGroup.appendChild(practiceRangeWrap); }
                                        if(practiceStartBtn){ practiceStartBtn.style.display='none'; practiceTopGroup.appendChild(practiceStartBtn); }
                                        if(practicePauseBtn){ practicePauseBtn.style.display='none'; practiceTopGroup.appendChild(practicePauseBtn); }
                                        if(practiceStopBtn){ practiceStopBtn.style.display='none'; practiceTopGroup.appendChild(practiceStopBtn); }
                                        if(practiceVolWrap){ practiceVolWrap.style.display='none'; practiceTopGroup.appendChild(practiceVolWrap); }
                                    }
                                    practiceMode='off';
                                    try{
                                        if(melodyAudioBtn){ melodyAudioBtn.disabled = false; melodyAudioBtn.title = 'メロディ音声を選択'; }
                                        if(accompAudioBtn){ accompAudioBtn.disabled = false; accompAudioBtn.title = '伴奏音声を選択'; }
                                    }catch(_){ }
                                }
                            };
                        }
                    }
                    practiceModeOff && (practiceModeOff.style.display='');
                    practiceModeOn && (practiceModeOn.style.display='none');
                    practiceMode='basic';
                    // 左＋/－のツールチップを練習用に更新
                    updateGlobalOctButtonsTooltip();
                    // 練習モード中は音声ファイル選択を無効化（ダイアログ抑止）
                    try{
                        if(melodyAudioBtn){ melodyAudioBtn.disabled = true; melodyAudioBtn.title = '練習モード中は無効'; }
                        if(accompAudioBtn){ accompAudioBtn.disabled = true; accompAudioBtn.title = '練習モード中は無効'; }
                    }catch(_){ }
                    // まっさらスタート（トラックは触らない。必要ならユーザが読込）
                    try{ if(isPlaying) pausePlayback(); }catch(_){ }
                    midiGhostNotes=null; drawChart();
            };
            practiceModeOff.onclick=()=>{
                activateAudioOnce();
                if(isPracticing) stopBasicPractice(true);
                // ツールバーを隠しつつ、各UIを元のトップグループに戻して非表示化
                if(practiceToolbar){ practiceToolbar.classList.add('hidden'); practiceToolbar.style.display='none'; }
                if(practiceTopGroup){
                    if(practicePatternSelect){ practicePatternSelect.style.display='none'; practiceTopGroup.appendChild(practicePatternSelect); }
                    if(practiceRangeWrap){ practiceRangeWrap.style.display='none'; practiceTopGroup.appendChild(practiceRangeWrap); }
                    if(practiceStartBtn){ practiceStartBtn.style.display='none'; practiceTopGroup.appendChild(practiceStartBtn); }
                    if(practicePauseBtn){ practicePauseBtn.style.display='none'; practiceTopGroup.appendChild(practicePauseBtn); }
                    if(practiceStopBtn){ practiceStopBtn.style.display='none'; practiceTopGroup.appendChild(practiceStopBtn); }
                    if(practiceVolWrap){ practiceVolWrap.style.display='none'; practiceTopGroup.appendChild(practiceVolWrap); }
                }else{
                    // フォールバック: 親が取得できない場合でも最低限非表示
                    practicePatternSelect && (practicePatternSelect.style.display='none');
                    practiceRangeWrap && (practiceRangeWrap.style.display='none');
                    practiceStartBtn && (practiceStartBtn.style.display='none');
                    practicePauseBtn && (practicePauseBtn.style.display='none');
                    practiceStopBtn && (practiceStopBtn.style.display='none');
                    practiceVolWrap && (practiceVolWrap.style.display='none');
                }
                practiceModeOff && (practiceModeOff.style.display='none');
                practiceModeOn && (practiceModeOn.style.display='');
                if(practiceCloseBtn){ practiceCloseBtn.style.display='none'; }
                practiceMode='off';
                // 表示用シフトをリセットし、ツールチップも戻す
                practiceCallDisplayOctShift = 0;
                updateGlobalOctButtonsTooltip();
                // 無効化解除
                try{
                    if(melodyAudioBtn){ melodyAudioBtn.disabled = false; melodyAudioBtn.title = 'メロディ音声を選択'; }
                    if(accompAudioBtn){ accompAudioBtn.disabled = false; accompAudioBtn.title = '伴奏音声を選択'; }
                }catch(_){ }
            };
        }
    if(practiceStartBtn){ practiceStartBtn.onclick=()=>{ activateAudioOnce(); if(practiceMode==='basic'){ if(practicePaused){ resumeBasicPractice(); } else { startBasicPractice(); } } } }
    if(practicePauseBtn){ practicePauseBtn.onclick=()=>{ activateAudioOnce(); if(isPracticing){ pauseBasicPractice(); } } }
    if(practiceStopBtn){
        let _prStopClick=0, _prStopTimer=null;
        practiceStopBtn.onclick=()=>{
            activateAudioOnce();
            _prStopClick++;
            if(_prStopClick===1){
                // 1回目: 練習の停止のみ
                if(isPracticing) stopBasicPractice(true);
                // 2回目待ちのヒントを短時間表示（ボタンタイトルを変更）
                try{ practiceStopBtn.title = 'もう一度押すと通常モードへ戻ります'; }catch(_){ }
                _prStopTimer = setTimeout(()=>{ _prStopClick=0; try{ practiceStopBtn.title=''; }catch(_){ } }, 900);
            } else if(_prStopClick>=2){
                if(_prStopTimer){ clearTimeout(_prStopTimer); _prStopTimer=null; }
                _prStopClick=0;
                // 通常モードへ戻る
                try{
                    if(practiceModeOff && typeof practiceModeOff.onclick==='function'){
                        practiceModeOff.onclick();
                    } else {
                        if(isPracticing) stopBasicPractice(true);
                        if(practiceToolbar){ practiceToolbar.classList.add('hidden'); practiceToolbar.style.display='none'; }
                        if(practiceTopGroup){
                            if(practicePatternSelect){ practicePatternSelect.style.display='none'; practiceTopGroup.appendChild(practicePatternSelect); }
                            if(practiceRangeWrap){ practiceRangeWrap.style.display='none'; practiceTopGroup.appendChild(practiceRangeWrap); }
                            if(practiceStartBtn){ practiceStartBtn.style.display='none'; practiceTopGroup.appendChild(practiceStartBtn); }
                            if(practicePauseBtn){ practicePauseBtn.style.display='none'; practiceTopGroup.appendChild(practicePauseBtn); }
                            if(practiceStopBtn){ practiceStopBtn.style.display='none'; practiceTopGroup.appendChild(practiceStopBtn); }
                            if(practiceVolWrap){ practiceVolWrap.style.display='none'; practiceTopGroup.appendChild(practiceVolWrap); }
                        }
                        practiceMode='off';
                        try{
                            if(melodyAudioBtn){ melodyAudioBtn.disabled = false; melodyAudioBtn.title = 'メロディ音声を選択'; }
                            if(accompAudioBtn){ accompAudioBtn.disabled = false; accompAudioBtn.title = '伴奏音声を選択'; }
                        }catch(_){ }
                    }
                }catch(_){ }
            }
        };
    }
        if(practiceCallVolEl){ practiceCallVolEl.oninput=()=>{ try{ ensureAudio(); if(practiceCallGain){ const v=Math.max(0, Math.min(1, parseFloat(practiceCallVolEl.value)||0.85)); practiceCallGain.gain.setValueAtTime(v, audioCtx.currentTime); } }catch(_){ } }; }
    }catch(_){ }

    // リサイズ時: デバウンスして描画＆レイアウト調整
    window.addEventListener('resize',()=>{
        if(__resizeTimer) clearTimeout(__resizeTimer);
        __resizeTimer = setTimeout(()=>{
            adjustResponsiveLayout();
            resizeCanvas();
            updateTimelineScrollRange();
            drawChart();
            // 念のため再計算（デバイスUI変動直後でも最大化）
            fitMainAreaHeight();
        }, 60);
    });
    // 親要素のサイズ変化（左パネル開閉等）にも追従
    try{
                // 練習モードでない時のみ、余計な重なりを避けるためツールバーを隠す
                try{ if(practiceToolbar && practiceMode!=='basic'){ practiceToolbar.classList.add('hidden'); practiceToolbar.style.display='none'; } }catch(_){ }
        const parent = document.getElementById('chartContainer')?.parentElement || document.getElementById('chartContainer');
        if(parent && 'ResizeObserver' in window){
            const ro = new ResizeObserver(()=>{
                if(__resizeTimer) clearTimeout(__resizeTimer);
                __resizeTimer = setTimeout(()=>{ resizeCanvas(); updateTimelineScrollRange(); drawChart(); }, 32);
            });
            ro.observe(parent);
        }
    }catch(_){ }
    // マイク描画モードセレクトのイベント
    try{
        if(micRenderModeSel){
            // 既定モードをUIにも反映
            try{ micRenderModeSel.value = 'graph'; }catch(_){ }
            micRenderModeSel.addEventListener('change', ()=>{
                const v = micRenderModeSel.value;
                micRenderMode = (v==='dot'||v==='graph')? v : 'line';
                try{ drawChart(); }catch(_){ }
            });
        }
    }catch(_){ }
});
// 初期にBT補正UIへ推定値を反映（AudioContext未生成時は既定値）
(()=>{ 
    const ms=Math.round(estimateOutputLatency()*1000); btLatencySec=ms/1000;
    if(btLatencySlider){ btLatencySlider.value=String(ms); btLatencySlider.disabled = !btLatencyEnabled; }
    if(btLatencyValue){ btLatencyValue.textContent=`${ms} ms`; }
    if(btLatencyToggle){ btLatencyToggle.checked = btLatencyEnabled; }
})();
// 初期共鳴スライダ反映
if(resonanceMixSlider){ resonanceMixSlider.value=String(resonanceMix); }

// ---- Auto-load SFZ instruments from ./sfz/Piano and ./sfz/Flute ----
async function autoLoadSfzInstruments(){
    // file:// の場合は黙ってスキップ（警告を出さない）
    if(location.protocol==='file:') return;
    try{
        await loadSfzFromFolder('sfz/Piano', 'Piano');
    }catch(e){ console.warn('Piano SFZ load failed',e); }
    try{
        await loadSfzFromFolder('sfz/Flute', 'Flute');
    }catch(e){ console.warn('Flute SFZ load failed',e); }
}

async function loadSfzFromFolder(baseUrl, instName){
    ensureAudio();
    // 1) フォルダ内の .sfz 名を推測: index.sfz or 同名フォルダ.sfz → なければ最初の.sfzを取る（簡易）
    // ディレクトリのリストはHTTPでそのまま取得できないため、約束: baseUrl/manifest.txt に .sfz と WAV列挙を置ける場合はそれを使う。
    // ここでは簡易に代表名を決める。
    const candidates=['index.sfz', instName+'.sfz', 'default.sfz'];
    let sfzText=null, sfzPath=null;
    for(const name of candidates){ try{ const r=await fetch(`${baseUrl}/${name}`); if(r.ok){ sfzText=await r.text(); sfzPath=`${baseUrl}/${name}`; break; } }catch(_){}}
    if(!sfzText){
        // フォールバック: 固定名で失敗したら諦め（サーバ側にリストがないと列挙できない）
        throw new Error('sfz not found in '+baseUrl);
    }
    // 解析は既存の SFZ パーサ簡易版を再利用
    const basePath=baseUrl; // 相対参照基準
    const regions=[];
    function parseNoteNameOrNumber(v){
        if(v==null) return undefined; if(typeof v==='number') return v; const n=parseInt(v); if(!Number.isNaN(n)) return n; const s=String(v).trim(); const m=s.match(/^([A-Ga-g])([#bB]?)(-?\d+)$/); if(!m) return undefined; const step=m[1].toUpperCase(); const base={C:0,D:2,E:4,F:5,G:7,A:9,B:11}[step]; const accCh=m[2]; const acc=accCh==='#'?1:(accCh==='b'||accCh==='B'?-1:0); const oct=parseInt(m[3]); return (oct+1)*12 + base + acc; }
    for(const lineRaw of sfzText.split(/\r?\n/)){
        const line=lineRaw.replace(/\s*\/\/.*$/,'').trim();
        if(!/\bregion\b/.test(line)) continue; const m=Object.create(null);
        line.replace(/(\w+)=((?:"[^"]*"|'[^']*'|[^\s]+))/g,(_,k,v)=>{ if(v && (v[0]==='"' || v[0]==="'")) v=v.slice(1,-1); m[k]=v; return ''; }); if(!m.sample) continue;
        regions.push({ sample:m.sample, lokey:(parseNoteNameOrNumber(m.lokey) ?? parseNoteNameOrNumber(m.key)), hikey:(parseNoteNameOrNumber(m.hikey) ?? parseNoteNameOrNumber(m.key)), lovel:m.lovel?parseInt(m.lovel):0, hivel:m.hivel?parseInt(m.hivel):127, loop_start:m.loop_start?parseInt(m.loop_start):undefined, loop_end:m.loop_end?parseInt(m.loop_end):undefined, trigger:m.trigger||undefined, pitch_keycenter:(parseNoteNameOrNumber(m.pitch_keycenter) ?? parseNoteNameOrNumber(m.key)), loop_mode: m.loop_mode||undefined });
    }
    if(!regions.length) throw new Error('no regions in '+sfzPath);
    // サンプル取得 & デコード
    const map={};
    // 簡易: ファイル名からMIDIを推定（fallback用）
    function inferMidiFromFilenameSimple(samplePath){
        try{
            const base = String(samplePath||'').split('/')?.pop()||'';
            const name = base.replace(/\.[A-Za-z0-9]+$/,'');
            const m1 = name.match(/(^|[^A-Za-z])([A-Ga-g])([#b]{1,2})?(-?\d)($|[^A-Za-z0-9])/);
            if(m1){
                const step=m1[2].toUpperCase();
                const baseIdx={C:0,D:2,E:4,F:5,G:7,A:9,B:11}[step];
                const accStr=m1[3]||''; let acc=0; if(accStr){ if(/##/.test(accStr)) acc=2; else if(/#/.test(accStr)) acc=1; else if(/bb/.test(accStr)) acc=-2; else if(/b/.test(accStr)) acc=-1; }
                const oct=parseInt(m1[4]); const midi=(oct+1)*12 + baseIdx + acc; if(midi>=0 && midi<=127) return midi;
            }
            const m2 = name.match(/(?:^|[^0-9])(1[01][0-9]|12[0-7]|\d?\d)(?:[^0-9]|$)/);
            if(m2){ const n=parseInt(m2[1]||m2[0]); if(n>=0 && n<=127) return n; }
        }catch(_){ }
        return null;
    }
    // 拡張子フォールバック（端末能力に応じた優先順を使用）
    function urlWithAltExts(path){
        const seen=new Set(); const out=[]; const m=path.match(/^(.*)\.([A-Za-z0-9]+)$/);
        if(m){
            const base=m[1];
            getAltSampleExts().forEach(e=>{ const q=base+'.'+e; if(!seen.has(q)){ seen.add(q); out.push(q); } });
            if(!seen.has(path)) out.push(path); return out;
        }
        getAltSampleExts().forEach(e=>{ const q=path+'.'+e; if(!seen.has(q)){ seen.add(q); out.push(q); } });
        if(!seen.has(path)) out.push(path); return out;
    }
    for(const r of regions){
        // Windows区切り -> URL区切り
        const normalizedSample = String(r.sample||'').replace(/\\/g,'/');
        const urls = urlWithAltExts(`${basePath}/${normalizedSample}`);
    let ab=null; for(const u of urls){ try{ const res=await fetch(u); if(res.ok){ ab=await res.arrayBuffer(); break; } }catch(_){} }
    if(!ab) continue;
    // WAVメタ
    const meta=readWavMeta(ab);
    const origRate= meta.sampleRate||0;
        const buf=await new Promise(res=> audioCtx.decodeAudioData(ab, b=>res(b), ()=>res(null)));
        if(!buf) continue;
        // キー範囲の補完/スワップ
        let lo=r.lokey, hi=r.hikey;
        if(lo==null && hi==null){
            const rootGuess = (r.pitch_keycenter!=null? r.pitch_keycenter: inferMidiFromFilenameSimple(r.sample));
            if(rootGuess!=null){ lo=hi=rootGuess; }
        }
        if(lo==null) lo = (hi!=null? hi: 60);
        if(hi==null) hi = lo;
        lo=Math.max(0, Math.min(127, lo));
        hi=Math.max(0, Math.min(127, hi));
        if(hi<lo){ const t=lo; lo=hi; hi=t; }
        const layer = (r.hivel??127)<=50? 'pp': (r.lovel??0)>=90? 'ff': 'mf';
        const root=(r.pitch_keycenter!=null)? r.pitch_keycenter: Math.round((lo+hi)/2);
        for(let m=lo;m<=hi;m++){
            if(!map[m]) map[m]={layers:{},release:null,gains:{}};
            if(r.trigger==='release'){ map[m].release=buf; continue; }
            if(!map[m].layers[layer]){
                let loopSec;
                if(r.loop_start!=null && r.loop_end!=null){
                    loopSec={ s:(r.loop_start/(origRate||buf.sampleRate)), e:(r.loop_end/(origRate||buf.sampleRate)) };
                } else if(meta.loopStart!=null && meta.loopEnd!=null){
                    const sr=(origRate||buf.sampleRate);
                    loopSec={ s: meta.loopStart/ sr, e: meta.loopEnd/ sr };
                } else if(r.loop_mode==='loop_continuous'){
                    loopSec={ s: Math.min(0.02, Math.max(0, buf.duration*0.02)), e: Math.max(0.05, buf.duration-0.02) };
                }
                map[m].layers[layer]={ buffer:buf, root, loop: undefined, loopSec };
            }
        }
    }
    instrumentMaps[instName]=map;
    // 既定ピアノにも反映（後方互換）
    if(instName==='Piano') pianoSampleMap=map;
    useSamplePiano=true; pianoSamplesLoaded=true; setPianoZipStatus(instName+' SFZロード完了' + (SELECTED_SAMPLE_PRIMARY? ' [fmt: '+SELECTED_SAMPLE_PRIMARY+']': ''));
    // 反映のため再スケジュール
    scheduleAll(); if(isPlaying){ pausePlayback(); startPlayback(); }
}
// EOF cleanup
