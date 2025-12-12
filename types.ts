export enum AppState {
  IDLE = 'IDLE',
  LISTENING = 'LISTENING',
  PROCESSING = 'PROCESSING',
  SPEAKING = 'SPEAKING',
  ERROR = 'ERROR'
}

export interface VirtualFile {
  path: string;
  content: string;
  language: string;
}

export interface FileSystem {
  [path: string]: VirtualFile;
}

export interface EditOperation {
  action: 'create' | 'edit' | 'delete';
  path: string;
  content?: string;
  summary: string;
}

export interface LogEntry {
  id: string;
  timestamp: number;
  type: 'user' | 'system' | 'error';
  message: string;
}

// Web Speech API Types
export interface IWindow extends Window {
  webkitSpeechRecognition: any;
  SpeechRecognition: any;
}
