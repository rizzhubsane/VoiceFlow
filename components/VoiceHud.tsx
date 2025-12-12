import React, { useState } from 'react';
import { AppState } from '../types';

interface VoiceHudProps {
  appState: AppState;
  onMicClick: () => void;
  onTextSubmit: (text: string) => void;
  lastTranscript: string;
  isHandsFree?: boolean;
  onToggleHandsFree?: () => void;
}

export const VoiceHud: React.FC<VoiceHudProps> = ({ 
  appState, 
  onMicClick, 
  onTextSubmit, 
  lastTranscript,
  isHandsFree = false,
  onToggleHandsFree 
}) => {
  const [inputText, setInputText] = useState('');

  const getStatusColor = () => {
    switch (appState) {
      case AppState.LISTENING: return 'bg-red-600 animate-pulse ring-4 ring-red-900 shadow-red-500/50';
      case AppState.PROCESSING: return 'bg-blue-600 animate-pulse-slow ring-4 ring-blue-900';
      case AppState.SPEAKING: return 'bg-green-600 ring-4 ring-green-900';
      case AppState.ERROR: return 'bg-orange-600 ring-4 ring-orange-900';
      default: return 'bg-gray-700 hover:bg-gray-600 hover:ring-4 hover:ring-gray-800';
    }
  };

  const getStatusText = () => {
    switch (appState) {
      case AppState.LISTENING: return 'Recording Audio...';
      case AppState.PROCESSING: return 'Analyzing Audio...';
      case AppState.SPEAKING: return 'Responding...';
      case AppState.ERROR: return 'Microphone Error';
      default: return isHandsFree ? "Listening for 'Hey VoiceFlow'..." : 'Tap to Record';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && inputText.trim()) {
      onTextSubmit(inputText);
      setInputText('');
    }
  };

  return (
    <div className="flex flex-col items-center justify-center p-6 bg-gray-900 relative h-full w-full overflow-hidden">
      {/* Hands-free Toggle */}
      {onToggleHandsFree && (
        <div className="absolute top-4 right-4 flex items-center space-x-2 z-20">
            <span className={`text-xs font-bold uppercase tracking-wider ${isHandsFree ? 'text-green-400' : 'text-gray-500'}`}>
                Hands-Free {isHandsFree ? 'ON' : 'OFF'}
            </span>
            <button 
                onClick={onToggleHandsFree}
                className={`w-12 h-6 rounded-full p-1 transition-colors duration-300 focus:outline-none ${isHandsFree ? 'bg-green-900' : 'bg-gray-700'}`}
                title="Toggle Hands-Free Mode"
            >
                <div className={`w-4 h-4 rounded-full bg-white shadow-md transform transition-transform duration-300 ${isHandsFree ? 'translate-x-6' : 'translate-x-0'}`} />
            </button>
        </div>
      )}

      <div className="flex flex-col items-center z-10 w-full max-w-2xl">
        <button
          onClick={onMicClick}
          className={`w-24 h-24 rounded-full flex items-center justify-center mb-4 transition-all duration-300 shadow-2xl shrink-0 ${getStatusColor()}`}
          aria-label={getStatusText()}
          title="Toggle Microphone"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            {appState === AppState.LISTENING ? (
              // Stop square icon when recording
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
            ) : (
              // Mic icon when idle
               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            )}
          </svg>
        </button>
        
        <h2 className={`text-xl font-bold mb-1 shrink-0 ${appState === AppState.ERROR ? 'text-orange-400' : 'text-white'}`} aria-live="polite">
          {getStatusText()}
        </h2>
        
        <p className="text-gray-400 text-center max-w-lg h-6 overflow-hidden text-sm italic mb-4 transition-all shrink-0">
          {appState === AppState.ERROR 
            ? "Microphone unavailable. Please type your command." 
            : appState === AppState.LISTENING 
                ? "Speak your instructions clearly..."
                : (lastTranscript || "Say 'Create a login page' or type below...")}
        </p>

        <div className="w-full max-w-md relative shrink-0">
          <input 
            type="text" 
            className="w-full bg-gray-800 border border-gray-700 text-white px-4 py-2 rounded-full focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 placeholder-gray-500 text-sm transition-all"
            placeholder="Type a command here (e.g., 'Add a navigation bar')..."
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={appState === AppState.PROCESSING || appState === AppState.SPEAKING}
          />
          <button 
             onClick={() => { if(inputText.trim()) { onTextSubmit(inputText); setInputText(''); } }}
             className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white p-1"
             disabled={!inputText.trim()}
             aria-label="Submit command"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};