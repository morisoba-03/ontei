import { useState, useEffect, useCallback } from 'react';
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
import { PresetSongModal } from './components/PresetSongModal';
import { SaveSongModal } from './components/SaveSongModal';
import { ScalePracticeModal } from './components/ScalePracticeModal';
import { WelcomeModal } from './components/WelcomeModal';
import { MicPermissionModal } from './components/MicPermissionModal';
import { ResumeModal } from './components/ResumeModal';
import { storage } from './lib/storage';
import { Trophy, Trash2, BarChart3, BookOpen, FileMusic, FileAudio, Save, FolderOpen, Mic } from 'lucide-react';
import { cn } from './lib/utils';

const VISITED_KEY = 'ontei_visited';
const MIC_EXPLAINED_KEY = 'ontei_mic_explained';

function App() {
  const [engine] = useState(() => audioEngine);
  const [showSettings, setShowSettings] = useState(false);
  const [showPractice, setShowPractice] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showPresets, setShowPresets] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showScalePractice, setShowScalePractice] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [showMicPermission, setShowMicPermission] = useState(false);
  const [showResume, setShowResume] = useState(false);
  const [recordingBlob, setRecordingBlob] = useState<Blob | null>(null);
  const [state, setState] = useState(audioEngine.state);
  const [isMicOn, setIsMicOn] = useState(!!audioEngine.micStream);

  // Show welcome screen only on first visit
  useEffect(() => {
    if (!localStorage.getItem(VISITED_KEY)) {
      setShowWelcome(true);
    }
  }, []);

  const handleWelcomeClose = () => {
    localStorage.setItem(VISITED_KEY, '1');
    setShowWelcome(false);
  };

  // On mount: check if previous session data exists → show resume dialog
  useEffect(() => {
    storage.hasStoredMidi().then(has => {
      if (has) {
        setShowResume(true);
      }
    });
  }, []);

  // Auto-start mic on page load.
  // Silently fails if permission is denied — user can still toggle manually.
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        await audioEngine.initMic();
        localStorage.setItem(MIC_EXPLAINED_KEY, '1');
      } catch {
        // Permission denied or no mic available — ignore silently
      }
    }, 600);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    return engine.subscribe(() => {
      setState({ ...engine.state });
      setIsMicOn(!!audioEngine.micStream);
    });
  }, [engine]);

  const toggleMic = useCallback(async () => {
    if (audioEngine.micStream) {
      audioEngine.micStream.getTracks().forEach(t => t.stop());
      audioEngine.micStream = null;
      audioEngine.notify();
    } else {
      if (!localStorage.getItem(MIC_EXPLAINED_KEY)) {
        setShowMicPermission(true);
      } else {
        await audioEngine.initMic();
      }
    }
  }, []);

  const handleMicPermissionConfirm = async () => {
    localStorage.setItem(MIC_EXPLAINED_KEY, '1');
    setShowMicPermission(false);
    await audioEngine.initMic();
  };

  const handleMicPermissionCancel = () => {
    setShowMicPermission(false);
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = async (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return;

      if (e.code === 'Space') {
        e.preventDefault();
        if (audioEngine.state.isPlaying) {
          audioEngine.stopPlayback();
        } else {
          await audioEngine.ensureAudio();
          audioEngine.startPlayback();
        }
      } else if (e.code === 'KeyR' && !e.ctrlKey && !e.metaKey) {
        if (audioEngine.isRecording) {
          const blob = await audioEngine.stopRecording();
          if (blob) setRecordingBlob(blob);
        } else {
          await audioEngine.startRecording();
        }
      } else if (e.code === 'KeyM' && !e.ctrlKey && !e.metaKey) {
        await toggleMic();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [toggleMic]);

  return (
    <div className="w-screen h-[100dvh] bg-[#1a1a1a] text-white overflow-hidden flex flex-col">
      {/* Top Bar */}
      <div className="h-14 border-b border-white/10 flex items-center bg-white/5 backdrop-blur-sm z-10 overflow-hidden">

        {/* Left: scrollable file management buttons */}
        <div className="flex-1 flex items-center gap-2 overflow-x-auto no-scrollbar pl-2 min-w-0">
          <h1 className="font-bold text-sm md:text-base tracking-tight bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent shrink-0">
            Ontei
          </h1>

          <div id="top-bar-import-controls" className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => document.getElementById('hidden-import-guide')?.click()}
              className="h-11 w-12 md:w-14 rounded-lg bg-blue-500/20 text-blue-300 text-[9px] md:text-[10px] hover:bg-blue-500/30 transition-all border border-blue-500/30 flex flex-col items-center justify-center gap-0.5 leading-none p-1"
              title="ガイド(MIDI/音声)を読み込む"
            >
              <FileMusic className="w-5 h-5" /> <span>ガイド</span>
            </button>
            <input
              type="file" accept=".mid,.midi,.mp3,.wav,.ogg,.m4a"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (file.name.endsWith('.mid') || file.name.endsWith('.midi')) {
                  engine.loadMidiFile(file);
                } else {
                  engine.loadAudioFile(file);
                }
              }}
              className="hidden" id="hidden-import-guide"
            />

            <button
              onClick={() => document.getElementById('hidden-import-audio')?.click()}
              className="h-11 w-12 md:w-14 rounded-lg bg-purple-500/20 text-purple-300 text-[9px] md:text-[10px] hover:bg-purple-500/30 transition-all border border-purple-500/30 flex flex-col items-center justify-center gap-0.5 leading-none p-1"
              title="伴奏(MP3/WAV)を読み込む"
            >
              <FileAudio className="w-5 h-5" /> <span>伴奏</span>
            </button>
            <input
              type="file" accept=".mp3,.wav,.ogg,.m4a"
              onChange={(e) => e.target.files?.[0] && engine.importBackingFile(e.target.files[0])}
              className="hidden" id="hidden-import-audio"
            />

            <button
              onClick={() => setShowPresets(true)}
              className="h-11 w-12 md:w-14 rounded-lg bg-pink-500/20 text-pink-300 text-[9px] md:text-[10px] hover:bg-pink-500/30 transition-all border border-pink-500/30 flex flex-col items-center justify-center gap-0.5 leading-none p-1"
              title="練習曲ライブラリ"
            >
              <BookOpen className="w-5 h-5" /> <span>練習曲</span>
            </button>

            <button
              onClick={() => setShowSaveModal(true)}
              className="h-11 w-12 md:w-14 rounded-lg bg-green-500/20 text-green-300 text-[9px] md:text-[10px] hover:bg-green-500/30 transition-all border border-green-500/30 flex flex-col items-center justify-center gap-0.5 leading-none p-1"
              title="現在の状態を保存"
            >
              <Save className="w-5 h-5" /> <span>保存</span>
            </button>

            <button
              onClick={() => document.getElementById('hidden-import-json')?.click()}
              className="h-11 w-12 md:w-14 rounded-lg bg-white/5 text-white/70 text-[9px] md:text-[10px] hover:bg-white/10 transition-all border border-white/10 flex flex-col items-center justify-center gap-0.5 leading-none p-1"
              title="練習データを読み込む"
            >
              <FolderOpen className="w-5 h-5" /> <span>読込</span>
            </button>
            <input
              type="file" accept=".json"
              onChange={(e) => e.target.files?.[0] && engine.importSession(e.target.files[0])}
              className="hidden" id="hidden-import-json"
            />

            <button
              onClick={() => state.scoreResult && state.scoreResult.totalScore > 0 && setShowResult(true)}
              disabled={!state.scoreResult || state.scoreResult.totalScore <= 0}
              className={`h-11 w-12 md:w-14 rounded-lg text-[9px] md:text-[10px] transition-all border flex flex-col items-center justify-center gap-0.5 leading-none p-1 ${state.scoreResult && state.scoreResult.totalScore > 0
                ? "bg-yellow-500/20 text-yellow-300 border-yellow-500/30 hover:bg-yellow-500/30 cursor-pointer"
                : "bg-gray-800/50 text-gray-500 border-gray-700/50 cursor-not-allowed opacity-70"
                }`}
              title={state.scoreResult && state.scoreResult.totalScore > 0 ? "結果を見る" : "まだ結果がありません"}
            >
              <Trophy className={`w-5 h-5 ${state.scoreResult && state.scoreResult.totalScore > 0 ? 'text-yellow-300' : 'text-gray-500'}`} />
              <span>結果</span>
            </button>
          </div>
        </div>

        {/* Right: always-visible controls */}
        <div className="flex items-center gap-1.5 shrink-0 px-2 border-l border-white/10">
          {/* Mic Button */}
          <button
            onClick={toggleMic}
            className={cn(
              "h-11 w-11 rounded-lg text-[9px] transition-all border flex flex-col items-center justify-center gap-0.5 leading-none",
              isMicOn
                ? "bg-red-500 text-white border-red-500 shadow-lg shadow-red-500/30 animate-pulse"
                : "bg-white/5 border-white/10 text-white/70 hover:bg-white/10 hover:text-white"
            )}
            title={isMicOn ? "マイクOFF (M)" : "マイクON (M)"}
          >
            <Mic className="w-5 h-5" />
            <span>{isMicOn ? 'ON' : 'MIC'}</span>
          </button>

          {/* BPM - hidden on mobile */}
          <div className="hidden md:flex items-center gap-2 bg-black/20 rounded-full px-3 py-1 border border-white/10">
            <span className="text-xs text-white/60 font-medium">BPM: {state.bpm}</span>
          </div>

          {/* Stats Button */}
          <button
            onClick={() => setShowStats(true)}
            className="h-8 w-8 rounded-full bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-all border border-blue-500/20 flex items-center justify-center"
            title="練習統計"
          >
            <BarChart3 className="w-4 h-4" />
          </button>

          {/* Reset Button */}
          <button
            onClick={() => setShowReset(true)}
            className="h-8 w-8 rounded-full bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all border border-red-500/20 flex items-center justify-center"
            title="リセット"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
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
        {showScalePractice && <ScalePracticeModal audioEngine={engine} onClose={() => setShowScalePractice(false)} />}

        <PresetSongModal open={showPresets} onClose={() => setShowPresets(false)} />
        <SaveSongModal open={showSaveModal} onClose={() => setShowSaveModal(false)} />
        {recordingBlob && (
          <RecordingPlayer
            audioBlob={recordingBlob}
            onClose={() => setRecordingBlob(null)}
          />
        )}

        {showResult && (
          <ScoreResultModal
            result={state.scoreResult!}
            onClose={() => setShowResult(false)}
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
            <div className="w-64 h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-100 ease-out"
                style={{ width: `${state.loadingProgress}%` }}
              />
            </div>
          </div>
        )}

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
          onOpenScalePractice={() => setShowScalePractice(true)}
        />
      </div>

      {/* Modals */}
      {showResume && (
        <ResumeModal
          onResume={() => {
            audioEngine.initFromStorage();
            setShowResume(false);
          }}
          onNew={() => {
            storage.saveMidi(new ArrayBuffer(0)).catch(() => {});
            setShowResume(false);
          }}
        />
      )}
      {showWelcome && <WelcomeModal onClose={handleWelcomeClose} />}
      {showMicPermission && (
        <MicPermissionModal
          onConfirm={handleMicPermissionConfirm}
          onCancel={handleMicPermissionCancel}
        />
      )}
      {/* Toast Notifications */}
      <ToastContainer />
    </div>
  )
}

export default App
