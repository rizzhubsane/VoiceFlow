import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GeminiService } from './services/gemini';
import { SpeechService } from './services/speech';
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

export default function App() {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [files, setFiles] = useState<FileSystem>(INITIAL_FILES);
  const [selectedFile, setSelectedFile] = useState<string | null>('index.html');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [lastTranscript, setLastTranscript] = useState('');
  
  const geminiRef = useRef<GeminiService | null>(null);
  const speechRef = useRef<SpeechService | null>(null);

  // Initialize Services
  useEffect(() => {
    geminiRef.current = new GeminiService();
    
    speechRef.current = new SpeechService(
      (text) => {
        setLastTranscript(text);
      },
      () => {
        // On End is handled by manual stop logic mostly
      },
      (error) => {
        console.error("Speech Error:", error);
        setAppState(AppState.ERROR);
        addLog('error', `Microphone: ${error}`);
      }
    );

    addLog('system', 'VoiceFlow initialized. Ready.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addLog = (type: 'user' | 'system' | 'error', message: string) => {
    setLogs(prev => [...prev, { id: Date.now().toString(), timestamp: Date.now(), type, message }]);
  };

  const processCommand = async (text: string) => {
    if (!text.trim() || !geminiRef.current) return;

    setAppState(AppState.PROCESSING);
    addLog('user', text);

    try {
      const operations = await geminiRef.current.generateEdits(text, files);
      
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
      console.error(error);
      setAppState(AppState.ERROR);
      addLog('error', 'Failed to process command.');
      if (geminiRef.current) {
        // Attempt to speak error, but don't block
        geminiRef.current.speak("I encountered an error.").catch(() => {});
      }
      // Reset after a delay so user can try again
      setTimeout(() => setAppState(AppState.IDLE), 2000);
    }
  };

  const handleMicClick = useCallback(() => {
    if (appState === AppState.IDLE || appState === AppState.ERROR || appState === AppState.SPEAKING) {
      setLastTranscript('');
      setAppState(AppState.LISTENING);
      speechRef.current?.start();
    } else if (appState === AppState.LISTENING) {
      speechRef.current?.stop();
      // Allow transcript to settle
      setTimeout(() => {
        if (lastTranscript) {
          processCommand(lastTranscript);
        } else {
            setAppState(AppState.IDLE);
        }
      }, 500);
    }
  }, [appState, lastTranscript, files]); // Added dependencies

  const handleTextSubmit = useCallback((text: string) => {
    processCommand(text);
  }, [files]);

  return (
    <div className="flex flex-col h-screen bg-black text-gray-100 font-sans">
      {/* Header / HUD */}
      <VoiceHud 
        appState={appState} 
        onMicClick={handleMicClick} 
        onTextSubmit={handleTextSubmit}
        lastTranscript={lastTranscript}
      />

      {/* Main Workspace */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* Left: File Explorer & Logs */}
        <div className="w-80 flex flex-col border-r border-gray-800 bg-gray-900">
           <div className="flex-1 overflow-hidden">
             <FileViewer 
                files={files} 
                selectedFile={selectedFile} 
                onSelectFile={setSelectedFile} 
             />
           </div>
           
           {/* Activity Log */}
           <div className="h-1/3 border-t border-gray-800 bg-black p-2 overflow-y-auto text-xs font-mono">
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

        {/* Center: Code View (Read Only) */}
        <div className="flex-1 flex flex-col border-r border-gray-800 bg-[#1e1e1e]">
          <div className="p-2 bg-gray-800 text-sm text-gray-300 flex justify-between">
            <span>{selectedFile || 'No file selected'}</span>
            <span className="text-xs opacity-50">Read-Only View</span>
          </div>
          <div className="flex-1 overflow-auto p-4 font-mono text-sm whitespace-pre text-gray-300">
            {selectedFile && files[selectedFile] 
              ? files[selectedFile].content 
              : <div className="text-gray-600 flex items-center justify-center h-full">Select a file to view content</div>}
          </div>
        </div>

        {/* Right: Live Preview */}
        <div className="w-1/3 min-w-[300px] flex flex-col">
          <PreviewFrame files={files} />
        </div>

      </div>
    </div>
  );
}