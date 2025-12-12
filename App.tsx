import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GeminiService } from './services/gemini';
import { AudioRecorder } from './services/recorder';
import { WakeWordService } from './services/wake-word';
import { AppState, FileSystem, LogEntry } from './types';
import { VoiceHud } from './components/VoiceHud';
import { FileViewer } from './components/FileViewer';
import { PreviewFrame } from './components/PreviewFrame';

const INITIAL_FILES: FileSystem = {
  'index.html': {
    path: 'index.html',
    language: 'html',
    content: `<!DOCTYPE html>
<html>
<head>
  <title>VoiceFlow Project</title>
  <style>
    body { font-family: system-ui; padding: 2rem; background: #111; color: #eee; }
    h1 { color: #3b82f6; }
    .feature { margin: 1rem 0; padding: 1rem; background: #222; border-radius: 8px; }
  </style>
</head>
<body>
  <h1>🎙️ Welcome to VoiceFlow</h1>
  <p>Voice-activated AI coding assistant supporting ALL programming languages!</p>
  
  <div class="feature">
    <h3>🚀 Quick Start:</h3>
    <ul>
      <li>Enable "Hands-Free" toggle (Top Right)</li>
      <li>Say "Hey VoiceFlow" to activate</li>
      <li>Try: "Create a Python calculator"</li>
      <li>Try: "Explain this code" (to understand any file)</li>
    </ul>
  </div>
</body>
</html>`
  }
};

type DragTarget = 'hud' | 'sidebar' | 'logs' | 'preview' | null;

export default function App() {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [files, setFiles] = useState<FileSystem>(INITIAL_FILES);
  const [selectedFile, setSelectedFile] = useState<string | null>('index.html');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [lastTranscript, setLastTranscript] = useState('');
  const [isHandsFree, setIsHandsFree] = useState(false);
  
  // Layout State
  const [layout, setLayout] = useState({
    hudHeight: 300,
    sidebarWidth: 320,
    logsHeight: 200,
    previewWidth: 400
  });
  
  const [dragging, setDragging] = useState<DragTarget>(null);
  
  const geminiRef = useRef<GeminiService | null>(null);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const wakeWordRef = useRef<WakeWordService | null>(null);
  const appContainerRef = useRef<HTMLDivElement>(null);
  
  const wakeWordHandlerRef = useRef<() => void>(() => {});

  // --- Helper Functions ---

  const addLog = useCallback((type: 'user' | 'system' | 'error', message: string) => {
    setLogs(prev => [...prev, { 
      id: Date.now().toString(), 
      timestamp: Date.now(), 
      type, 
      message 
    }]);
  }, []);

  // Forward declarations
  const startRecording = useCallback(async (autoStop: boolean = false) => {
      setLastTranscript(''); 
      setAppState(AppState.LISTENING);
      try {
        await recorderRef.current?.start(autoStop ? () => {
            // Silence callback
            stopRecording();
        } : undefined);
        addLog('system', autoStop ? 'Listening...' : 'Recording...');
      } catch (e) {
        setAppState(AppState.ERROR);
        addLog('error', 'Could not access microphone.');
        // If mic fails, go back to idle
        setTimeout(() => setAppState(AppState.IDLE), 2000);
      }
  }, [addLog]); // Dependencies handled below via ref or stability

  const processCommand = useCallback(async (input: string | { audioData: string, mimeType: string }) => {
    if (!geminiRef.current) return;

    setAppState(AppState.PROCESSING);
    
    if (typeof input === 'string') {
        addLog('user', input);
    } else {
        addLog('user', '[Audio Command Sent]');
    }

    try {
      const operations = await geminiRef.current.generateEdits(input, files, selectedFile || undefined);
      
      let summaryText = "I didn't catch that.";

      if (operations.length > 0) {
        const newFiles = { ...files };
        for (const op of operations) {
            if (op.action === 'create' || op.action === 'edit') {
               const extension = op.path.split('.').pop() || 'text';
               const language = op.language || extension;
               newFiles[op.path] = {
                 path: op.path,
                 content: op.content || '',
                 language: language
               };
            } else if (op.action === 'delete') {
              delete newFiles[op.path];
            }
            if (op.summary) summaryText = op.summary;
        }
        setFiles(newFiles);
        if (operations[0].path !== 'response.txt') {
            setSelectedFile(operations[0].path);
        }
      }

      setAppState(AppState.SPEAKING);
      addLog('system', summaryText);
      
      // Wait for speech to finish
      await geminiRef.current.speak(summaryText);
      
      // Loop logic: if hands-free is on, listen again unless user said "stop"
      // We do a rough check on summary to see if it was a goodbye, or just keep going
      if (isHandsFree) {
          // Small delay to prevent echo
          setTimeout(() => startRecording(true), 150);
      } else {
          setAppState(AppState.IDLE);
      }

    } catch (error) {
      console.error('Process command error:', error);
      setAppState(AppState.ERROR);
      addLog('error', 'Processing failed.');
      setTimeout(() => setAppState(AppState.IDLE), 2000);
    }
  }, [files, selectedFile, addLog, isHandsFree, startRecording]);

  const stopRecording = useCallback(async () => {
      setAppState(AppState.PROCESSING);
      try {
        const audioResult = await recorderRef.current?.stop();
        if (audioResult && audioResult.base64) {
            await processCommand({
                audioData: audioResult.base64,
                mimeType: audioResult.mimeType
            });
        } else {
            setAppState(AppState.IDLE);
            addLog('system', 'No audio heard.');
        }
      } catch (e) {
        setAppState(AppState.ERROR);
      }
  }, [processCommand, addLog]);

  const handleMicClick = useCallback(async () => {
    if (appState === AppState.LISTENING) {
        stopRecording();
    } else if (appState === AppState.IDLE || appState === AppState.ERROR || appState === AppState.SPEAKING) {
        // If clicking mic manually, we can treat it as a single turn or enable loop.
        // Let's assume manual click = single turn unless hands-free is explicitly ON.
        startRecording(isHandsFree); 
    }
  }, [appState, stopRecording, startRecording, isHandsFree]);

  const handleTextSubmit = useCallback((text: string) => {
    processCommand(text);
  }, [processCommand]);

  // --- Wake Word Logic ---
  const handleWakeWordDetected = useCallback(async () => {
      if (appState !== AppState.IDLE) return;
      
      setAppState(AppState.SPEAKING);
      addLog('system', "🎙️ Wake word detected!");

      try {
        // Short acknowledgement
        await geminiRef.current?.speak("Yes?");
      } catch(e) {}
      
      startRecording(true);
  }, [appState, addLog, startRecording]);

  // Ref update
  useEffect(() => {
    wakeWordHandlerRef.current = handleWakeWordDetected;
  }, [handleWakeWordDetected]);

  // Initialize
  useEffect(() => {
     geminiRef.current = new GeminiService();
     recorderRef.current = new AudioRecorder();
     wakeWordRef.current = new WakeWordService(
         () => wakeWordHandlerRef.current(),
         (err) => addLog('error', err)
     );
     return () => {
         wakeWordRef.current?.stop();
     };
  }, []);

  // Hands-free Effect
  useEffect(() => {
      if (!wakeWordRef.current) return;
      
      // Only listen for wake word if hands-free is ON and we are IDLE.
      if (isHandsFree && appState === AppState.IDLE) {
          wakeWordRef.current.start();
      } else {
          wakeWordRef.current.stop();
      }
  }, [isHandsFree, appState]);


  // Layout Handlers
  const handleMouseDown = (target: DragTarget) => (e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(target);
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging) return;

    if (dragging === 'hud') {
      setLayout(prev => ({ ...prev, hudHeight: Math.max(150, Math.min(e.clientY, 600)) }));
    } else if (dragging === 'sidebar') {
      setLayout(prev => ({ ...prev, sidebarWidth: Math.max(200, Math.min(e.clientX, 600)) }));
    } else if (dragging === 'logs') {
      const newHeight = window.innerHeight - e.clientY;
      setLayout(prev => ({ ...prev, logsHeight: Math.max(50, Math.min(newHeight, window.innerHeight - prev.hudHeight - 100)) }));
    } else if (dragging === 'preview') {
       const newWidth = window.innerWidth - e.clientX;
       setLayout(prev => ({ ...prev, previewWidth: Math.max(200, Math.min(newWidth, window.innerWidth - prev.sidebarWidth - 100)) }));
    }
  }, [dragging]);

  const handleMouseUp = useCallback(() => setDragging(null), []);

  useEffect(() => {
    if (dragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    } else {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, handleMouseMove, handleMouseUp]);


  return (
    <div className={`flex flex-col h-screen bg-black text-gray-100 font-sans overflow-hidden ${dragging ? 'cursor-grabbing select-none' : ''}`} ref={appContainerRef}>
      {/* HUD Section */}
      <div style={{ height: layout.hudHeight }} className="flex-shrink-0 relative">
        <VoiceHud 
          appState={appState} 
          onMicClick={handleMicClick} 
          onTextSubmit={handleTextSubmit}
          lastTranscript={lastTranscript}
          isHandsFree={isHandsFree}
          onToggleHandsFree={() => setIsHandsFree(!isHandsFree)}
        />
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-gray-800 hover:bg-blue-500 cursor-row-resize z-20 group" onMouseDown={handleMouseDown('hud')}>
          <div className="absolute top-[-3px] bottom-[-3px] left-0 right-0 bg-transparent group-hover:bg-blue-500/20"></div>
        </div>
      </div>

      {/* Main Workspace */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Sidebar */}
        <div style={{ width: layout.sidebarWidth }} className="flex flex-col border-r border-gray-800 bg-gray-900 relative flex-shrink-0">
           <div className="absolute top-0 bottom-0 right-[-2px] w-1 bg-transparent hover:bg-blue-500 cursor-col-resize z-20 group" onMouseDown={handleMouseDown('sidebar')}>
             <div className="absolute left-[-3px] right-[-3px] top-0 bottom-0 bg-transparent group-hover:bg-blue-500/20"></div>
           </div>
           <div className="flex-1 overflow-hidden">
             <FileViewer files={files} selectedFile={selectedFile} onSelectFile={setSelectedFile} />
           </div>
           <div className="h-1 bg-gray-800 hover:bg-blue-500 cursor-row-resize z-20 relative group flex-shrink-0" onMouseDown={handleMouseDown('logs')}>
             <div className="absolute top-[-3px] bottom-[-3px] left-0 right-0 bg-transparent group-hover:bg-blue-500/20"></div>
           </div>
           <div style={{ height: layout.logsHeight }} className="bg-black p-2 overflow-y-auto text-xs font-mono flex-shrink-0">
             <div className="text-gray-500 uppercase font-bold mb-2">System Logs</div>
             {logs.map(log => (
               <div key={log.id} className={`mb-1 break-words ${log.type === 'user' ? 'text-green-400' : log.type === 'error' ? 'text-red-400' : 'text-blue-400'}`}>
                 <span className="opacity-50">[{new Date(log.timestamp).toLocaleTimeString()}]</span> {log.type === 'user' ? '>' : '#'} {log.message}
               </div>
             ))}
           </div>
        </div>

        {/* Editor */}
        <div className="flex-1 flex flex-col border-r border-gray-800 bg-[#1e1e1e] min-w-0">
          <div className="p-2 bg-gray-800 text-sm text-gray-300 flex justify-between shrink-0">
            <span>{selectedFile || 'No file selected'}</span>
            <span className="text-xs opacity-50">{selectedFile && files[selectedFile] ? `Language: ${files[selectedFile].language}` : 'Read-Only View'}</span>
          </div>
          <div className="flex-1 overflow-auto p-4 font-mono text-sm whitespace-pre text-gray-300">
            {selectedFile && files[selectedFile] ? files[selectedFile].content : <div className="text-gray-600 flex items-center justify-center h-full"><div>Select a file to view</div></div>}
          </div>
        </div>

        <div className="w-1 bg-gray-800 hover:bg-blue-500 cursor-col-resize z-20 group relative flex-shrink-0" onMouseDown={handleMouseDown('preview')}>
          <div className="absolute left-[-3px] right-[-3px] top-0 bottom-0 bg-transparent group-hover:bg-blue-500/20"></div>
        </div>

        {/* Preview */}
        <div style={{ width: layout.previewWidth }} className="flex flex-col flex-shrink-0">
          <PreviewFrame files={files} isResizing={dragging !== null} />
        </div>
      </div>
    </div>
  );
}