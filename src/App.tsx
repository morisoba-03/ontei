import { useState, useEffect } from 'react';
import { CanvasView } from './components/CanvasView';
import { Controls } from './components/Controls';
import { SettingsPanel } from './components/SettingsPanel';
import { audioEngine } from './lib/AudioEngine';
import { PracticeControlPanel } from './components/PracticeControlPanel';
import { ScoreResultModal } from './components/ScoreResultModal';
import { HistoryPanel } from './components/HistoryPanel';
import { RecordingPlayer } from './components/RecordingPlayer';
import { ResetConfirmModal } from './components/ResetConfirmModal';
import { ToastContainer } from './components/Toast';
import { PitchIndicator } from './components/PitchIndicator';
import { StatsDashboard } from './components/StatsDashboard';
import { Trophy, Trash2, BarChart3 } from 'lucide-react';


function App() {
  const [engine] = useState(() => audioEngine);
  const [showSettings, setShowSettings] = useState(false);
  const [showPractice, setShowPractice] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [recordingBlob, setRecordingBlob] = useState<Blob | null>(null);
  const [state, setState] = useState(audioEngine.state);

  // Initialize from storage on mount
  useEffect(() => {
    audioEngine.initFromStorage();
  }, []);

  useEffect(() => {
    return engine.subscribe(() => {
      setState({ ...engine.state });
    });
  }, [engine]);

  return (
    <div className="w-screen h-[100dvh] bg-[#1a1a1a] text-white overflow-hidden flex flex-col">
      {/* Top Bar - Scrollable */}
      <div className="h-12 border-b border-white/10 flex items-center px-2 md:px-4 bg-white/5 backdrop-blur-sm z-10 overflow-x-auto no-scrollbar gap-2">
        <h1 className="font-bold text-base md:text-lg tracking-tight bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent truncate max-w-[120px] md:max-w-none">
          Ontei <span className="hidden md:inline text-xs text-white/40 font-normal ml-2">Legacy Refactor</span>
        </h1>

        {/* File Management Buttons */}
        <div id="top-bar-import-controls" className="flex items-center gap-2">

          {/* Import Guide (MIDI or Audio) */}
          <button
            onClick={() => document.getElementById('hidden-import-guide')?.click()}
            className="h-8 w-24 rounded-full bg-blue-500/20 text-blue-300 text-xs hover:bg-blue-500/30 transition-all border border-blue-500/30 flex items-center justify-center gap-1.5"
            title="ガイド(MIDI/音声)を読み込む"
          >
            <span className="text-lg md:text-base">🎼</span> <span className="hidden md:inline">ガイド読込</span>
          </button>
          <input
            type="file" accept=".mid,.midi,.mp3,.wav,.ogg,.m4a"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (file.name.endsWith('.mid') || file.name.endsWith('.midi')) {
                engine.loadMidiFile(file);
              } else {
                engine.loadAudioFile(file); // Audio Analysis
              }
            }}
            className="hidden" id="hidden-import-guide"
          />

          {/* Import Backing (Audio) */}
          <button
            onClick={() => document.getElementById('hidden-import-audio')?.click()}
            className="h-8 w-24 rounded-full bg-purple-500/20 text-purple-300 text-xs hover:bg-purple-500/30 transition-all border border-purple-500/30 flex items-center justify-center gap-1.5"
            title="伴奏(MP3/WAV)を読み込む"
          >
            <span className="text-lg md:text-base">🎵</span> <span className="hidden md:inline">伴奏</span>
          </button>
          <input
            type="file" accept=".mp3,.wav,.ogg,.m4a"
            onChange={(e) => e.target.files?.[0] && engine.importBackingFile(e.target.files[0])}
            className="hidden" id="hidden-import-audio"
          />

          {/* Save Session */}
          <button
            onClick={() => {
              const sessionData = audioEngine.exportSession();
              const blob = new Blob([sessionData], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `ontei-session-${new Date().toISOString().slice(0, 10)}.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="h-8 w-24 rounded-full bg-green-500/20 text-green-300 text-xs hover:bg-green-500/30 transition-all border border-green-500/30 flex items-center justify-center gap-1.5 ml-2"
            title="現在の状態を保存"
          >
            <span className="hidden md:inline">💾 SAVE</span><span className="md:hidden">💾</span>
          </button>

          {/* Load Project (JSON) */}
          <button
            onClick={() => document.getElementById('hidden-import-json')?.click()}
            className="h-8 w-24 rounded-full bg-white/5 text-white/70 text-xs hover:bg-white/10 transition-all border border-white/10 flex items-center justify-center gap-1.5 ml-2"
            title="練習データを読み込む"
          >
            <span className="text-lg md:text-base">📂</span> <span className="hidden md:inline">LOAD</span>
          </button>
          <input
            type="file" accept=".json"
            onChange={(e) => e.target.files?.[0] && engine.importSession(e.target.files[0])}
            className="hidden" id="hidden-import-json"
          />

          {/* Show Result Button */}
          <button
            onClick={() => state.scoreResult && state.scoreResult.totalScore > 0 && setShowResult(true)}
            disabled={!state.scoreResult || state.scoreResult.totalScore <= 0}
            className={`h-8 w-28 rounded-full text-xs transition-all border flex items-center justify-center gap-1.5 ml-4 ${state.scoreResult && state.scoreResult.totalScore > 0
              ? "bg-yellow-500/20 text-yellow-300 border-yellow-500/30 hover:bg-yellow-500/30 cursor-pointer"
              : "bg-gray-800/50 text-gray-500 border-gray-700/50 cursor-not-allowed opacity-70"
              }`}
            title={state.scoreResult && state.scoreResult.totalScore > 0 ? "結果を見る" : "まだ結果がありません"}
          >
            <Trophy className={`w-3 h-3 ${state.scoreResult && state.scoreResult.totalScore > 0 ? 'text-yellow-300' : 'text-gray-500'}`} />
            <span className="hidden md:inline">結果を見る</span>
          </button>

        </div>

        {/* BPM Control */}
        <div className="flex items-center gap-2 bg-black/20 rounded-full px-3 py-1 border border-white/10 shrink-0">
          <span className="text-xs text-white/60 font-medium">BPM: {state.bpm}</span>
        </div>

        {/* Stats Button */}
        <button
          onClick={() => setShowStats(true)}
          className="h-8 w-8 rounded-full bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-all border border-blue-500/20 flex items-center justify-center shrink-0 ml-auto"
          title="練習統計"
        >
          <BarChart3 className="w-4 h-4" />
        </button>

        {/* Reset Button */}
        <button
          onClick={() => setShowReset(true)}
          className="h-8 w-8 rounded-full bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all border border-red-500/20 flex items-center justify-center shrink-0"
          title="リセット"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Main Area */}
      <div className="flex-1 relative min-h-0">
        <CanvasView />

        {/* Real-time Pitch Indicator */}
        <PitchIndicator />

        {/* Overlays */}
        {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
        {showPractice && <PracticeControlPanel audioEngine={engine} isPracticing={state.isPracticing} onClose={() => {
          engine.stopPractice();
          setShowPractice(false);
        }} />}
        {showHistory && <HistoryPanel onClose={() => setShowHistory(false)} />}
        {showReset && (
          <ResetConfirmModal
            open={showReset}
            onClose={() => setShowReset(false)}
            onResetAll={() => engine.resetSession('all')}
            onResetPitchOnly={() => engine.resetSession('pitchOnly')}
          />
        )}
        <StatsDashboard open={showStats} onClose={() => setShowStats(false)} />
        {recordingBlob && (
          <RecordingPlayer
            audioBlob={recordingBlob}
            onClose={() => setRecordingBlob(null)}
          />
        )}

        {showResult && (
          <ScoreResultModal
            result={state.scoreResult!}
            onClose={() => {
              setShowResult(false);
            }}
          />
        )}



        {/* Loading Overlay */}
        {state.loadingProgress !== null && (
          <div className="absolute inset-0 z-[200] bg-black/80 backdrop-blur-md flex flex-col items-center justify-center gap-4 animate-in fade-in duration-300">
            <div className="w-16 h-16 border-4 border-white/20 border-t-blue-500 rounded-full animate-spin" />
            <div className="text-xl font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
              Analyzing Audio...
            </div>
            <div className="text-white/60 font-mono text-sm">
              {Math.round(state.loadingProgress)}%
            </div>
            {/* Progress Bar */}
            <div className="w-64 h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-100 ease-out"
                style={{ width: `${state.loadingProgress}%` }}
              />
            </div>
          </div>
        )}

        {/* Score Result Modal */}
        {showResult && state.scoreResult && (
          <ScoreResultModal result={state.scoreResult} onClose={() => setShowResult(false)} />
        )}

        {/* Result Button (Visible when stopped and result available) */}
        {/* Result Button Removed as per user request */}

        <Controls
          onOpenSettings={() => setShowSettings(true)}
          onOpenPractice={() => {
            if (showPractice || state.isPracticing) {
              engine.stopPractice();
              setShowPractice(false);
            } else {
              setShowPractice(true);
            }
          }}
          onOpenHistory={() => setShowHistory(true)}
          onRecordingComplete={(blob) => setRecordingBlob(blob)}

        />
      </div>

      {/* Toast Notifications */}
      <ToastContainer />
    </div>
  )
}

export default App
