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
  </style>
</head>
<body>
  <h1>Welcome to VoiceFlow</h1>
  <p>Tap the mic or type to start building.</p>
  <p>Try saying: "Create a calculator app"</p>
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
  
  // Ref for the wake word handler to ensure stable identity for the service
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

  const processCommand = useCallback(async (input: string | { audioData: string, mimeType: string }) => {
    if (!geminiRef.current) return;

    setAppState(AppState.PROCESSING);
    
    if (typeof input === 'string') {
        addLog('user', input);
    } else {
        addLog('user', '[Audio Command Sent]');
    }

    try {
      const operations = await geminiRef.current.generateEdits(input, files);
      
      if (operations.length === 0) {
        setAppState(AppState.IDLE);
        const msg = "I didn't understand what to change.";
        addLog('system', msg);
        await geminiRef.current.speak(msg);
        return;
      }

      const newFiles = { ...files };
      let summaryText = "";

      for (const op of operations) {
        if (op.action === 'create' || op.action === 'edit') {
           newFiles[op.path] = {
             path: op.path,
             content: op.content || '',
             language: op.path.split('.').pop() || 'text'
           };
        } else if (op.action === 'delete') {
          delete newFiles[op.path];
        }
        summaryText = op.summary;
      }

      setFiles(newFiles);
      
      // Select the first modified file
      if (operations.length > 0) {
        setSelectedFile(operations[0].path);
      }

      setAppState(AppState.SPEAKING);
      addLog('system', summaryText);
      await geminiRef.current.speak(summaryText);
      
      setAppState(AppState.IDLE);

    } catch (error) {
      console.error('Process command error:', error);
      setAppState(AppState.ERROR);
      addLog('error', 'Failed to process command.');
      if (geminiRef.current) {
        geminiRef.current.speak("I encountered an error.").catch(() => {});
      }
      setTimeout(() => setAppState(AppState.IDLE), 2000);
    }
  }, [files, addLog]);

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
            addLog('system', 'No audio recorded.');
        }
      } catch (e) {
        console.error(e);
        setAppState(AppState.ERROR);
        addLog('error', 'Error processing audio.');
        setTimeout(() => setAppState(AppState.IDLE), 2000);
      }
  }, [processCommand, addLog]);

  const startRecording = useCallback(async (autoStop: boolean = false) => {
      setLastTranscript(''); 
      setAppState(AppState.LISTENING);
      try {
        // Pass the silence callback if hands-free is enabled (autoStop)
        await recorderRef.current?.start(autoStop ? () => {
            console.log("Silence detected, stopping...");
            stopRecording();
        } : undefined);
        addLog('system', autoStop ? 'Listening (will stop on silence)...' : 'Recording audio...');
      } catch (e) {
        setAppState(AppState.ERROR);
        addLog('error', 'Could not access microphone.');
      }
  }, [addLog, stopRecording]);


  const handleMicClick = useCallback(async () => {
    if (appState === AppState.LISTENING) {
        stopRecording();
    } else if (appState === AppState.IDLE || appState === AppState.ERROR || appState === AppState.SPEAKING) {
        // When manually clicking, we don't usually want auto-silence-stop unless users prefer it,
        // but let's keep manual control manual for now.
        startRecording(isHandsFree); 
    }
  }, [appState, stopRecording, startRecording, isHandsFree]);

  const handleTextSubmit = useCallback((text: string) => {
    processCommand(text);
  }, [processCommand]);

  // --- Wake Word Logic ---
  
  const handleWakeWordDetected = useCallback(async () => {
      // Must double check state here because the closure might be slightly stale if called rapidly
      setAppState(prev => {
        if (prev !== AppState.IDLE) return prev;
        
        console.log("Wake word detected!");
        addLog('system', "Wake word detected: 'Hey VoiceFlow'");
        
        // We need to trigger side effects. Since we can't do async inside setState updater,
        // we'll do the effects outside.
        // However, this callback is invoked by the service.
        return AppState.SPEAKING; 
      });

      // Execute flow
      // 1. Speak acknowledgement
      try {
        await geminiRef.current?.speak("I'm listening.");
      } catch(e) { console.error(e); }
      
      // 2. Start recording (will set state to LISTENING)
      startRecording(true);

  }, [addLog, startRecording]);

  // Update the ref whenever the handler changes, so the service always calls the fresh one
  useEffect(() => {
    wakeWordHandlerRef.current = handleWakeWordDetected;
  }, [handleWakeWordDetected]);

  // Initialize Services Once
  useEffect(() => {
     geminiRef.current = new GeminiService();
     recorderRef.current = new AudioRecorder();
     wakeWordRef.current = new WakeWordService(
         () => {
             // Use ref to avoid stale closures
             if (wakeWordHandlerRef.current) {
                 wakeWordHandlerRef.current();
             }
         },
         (err) => addLog('error', err)
     );
     addLog('system', 'VoiceFlow initialized.');

     return () => {
         wakeWordRef.current?.stop();
     };
  }, []); // Run once on mount

  // Manage Hands-Free State
  useEffect(() => {
      if (!wakeWordRef.current) return;
      
      // Only listen for wake word if hands-free is ON and we are IDLE
      if (isHandsFree && appState === AppState.IDLE) {
          wakeWordRef.current.start();
      } else {
          wakeWordRef.current.stop();
      }
  }, [isHandsFree, appState]);


  // --- Layout Handlers ---

  const handleMouseDown = (target: DragTarget) => (e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(target);
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging) return;

    if (dragging === 'hud') {
      setLayout(prev => ({
        ...prev,
        hudHeight: Math.max(150, Math.min(e.clientY, 600))
      }));
    } else if (dragging === 'sidebar') {
      setLayout(prev => ({
        ...prev,
        sidebarWidth: Math.max(200, Math.min(e.clientX, 600))
      }));
    } else if (dragging === 'logs') {
      const newHeight = window.innerHeight - e.clientY;
      setLayout(prev => ({
        ...prev,
        logsHeight: Math.max(50, Math.min(newHeight, window.innerHeight - prev.hudHeight - 100))
      }));
    } else if (dragging === 'preview') {
       const newWidth = window.innerWidth - e.clientX;
       setLayout(prev => ({
         ...prev,
         previewWidth: Math.max(200, Math.min(newWidth, window.innerWidth - prev.sidebarWidth - 100))
       }));
    }
  }, [dragging]);

  const handleMouseUp = useCallback(() => {
    setDragging(null);
  }, []);

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
    <div 
      className={`flex flex-col h-screen bg-black text-gray-100 font-sans overflow-hidden ${dragging ? 'cursor-grabbing select-none' : ''}`}
      ref={appContainerRef}
    >
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
        {/* HUD Resizer Handle */}
        <div 
          className="absolute bottom-0 left-0 right-0 h-1 bg-gray-800 hover:bg-blue-500 cursor-row-resize z-20 group"
          onMouseDown={handleMouseDown('hud')}
        >
          <div className="absolute top-[-3px] bottom-[-3px] left-0 right-0 bg-transparent group-hover:bg-blue-500/20"></div>
        </div>
      </div>

      {/* Main Workspace */}
      <div className="flex flex-1 overflow-hidden relative">
        
        {/* Left: File Explorer & Logs */}
        <div 
          style={{ width: layout.sidebarWidth }} 
          className="flex flex-col border-r border-gray-800 bg-gray-900 relative flex-shrink-0"
        >
           {/* Sidebar Resizer Handle */}
           <div 
             className="absolute top-0 bottom-0 right-[-2px] w-1 bg-transparent hover:bg-blue-500 cursor-col-resize z-20 group"
             onMouseDown={handleMouseDown('sidebar')}
           >
             <div className="absolute left-[-3px] right-[-3px] top-0 bottom-0 bg-transparent group-hover:bg-blue-500/20"></div>
           </div>

           {/* Files Section */}
           <div className="flex-1 overflow-hidden">
             <FileViewer 
                files={files} 
                selectedFile={selectedFile} 
                onSelectFile={setSelectedFile} 
             />
           </div>
           
           {/* Logs Resizer Handle */}
           <div 
             className="h-1 bg-gray-800 hover:bg-blue-500 cursor-row-resize z-20 relative group flex-shrink-0"
             onMouseDown={handleMouseDown('logs')}
           >
             <div className="absolute top-[-3px] bottom-[-3px] left-0 right-0 bg-transparent group-hover:bg-blue-500/20"></div>
           </div>

           {/* Logs Section */}
           <div 
             style={{ height: layout.logsHeight }} 
             className="bg-black p-2 overflow-y-auto text-xs font-mono flex-shrink-0"
           >
             <div className="text-gray-500 uppercase font-bold mb-2">System Logs</div>
             {logs.map(log => (
               <div key={log.id} className={`mb-1 break-words ${
                 log.type === 'user' ? 'text-green-400' : 
                 log.type === 'error' ? 'text-red-400' : 'text-blue-400'
               }`}>
                 <span className="opacity-50">[{new Date(log.timestamp).toLocaleTimeString()}]</span> {log.type === 'user' ? '>' : '#'} {log.message}
               </div>
             ))}
           </div>
        </div>

        {/* Center: Code View */}
        <div className="flex-1 flex flex-col border-r border-gray-800 bg-[#1e1e1e] min-w-0">
          <div className="p-2 bg-gray-800 text-sm text-gray-300 flex justify-between shrink-0">
            <span>{selectedFile || 'No file selected'}</span>
            <span className="text-xs opacity-50">Read-Only View</span>
          </div>
          <div className="flex-1 overflow-auto p-4 font-mono text-sm whitespace-pre text-gray-300">
            {selectedFile && files[selectedFile] 
              ? files[selectedFile].content 
              : <div className="text-gray-600 flex items-center justify-center h-full">Select a file to view content</div>}
          </div>
        </div>

        {/* Preview Resizer Handle */}
        <div 
          className="w-1 bg-gray-800 hover:bg-blue-500 cursor-col-resize z-20 group relative flex-shrink-0"
          onMouseDown={handleMouseDown('preview')}
        >
          <div className="absolute left-[-3px] right-[-3px] top-0 bottom-0 bg-transparent group-hover:bg-blue-500/20"></div>
        </div>

        {/* Right: Live Preview */}
        <div 
          style={{ width: layout.previewWidth }} 
          className="flex flex-col flex-shrink-0"
        >
          <PreviewFrame files={files} isResizing={dragging !== null} />
        </div>

      </div>
    </div>
  );
}