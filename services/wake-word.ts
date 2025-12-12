import { IWindow } from '../types';

const WAKE_WORD_VARIATIONS = [
  'voiceflow', 'voice flow', 
  'hey voice', 'hey voiceflow', 
  'voice flo', 'voice low', 
  'boys flow', 'voice blow',
  'force flow', 'okay voice',
  'hi voice'
];

export class WakeWordService {
  private recognition: any;
  private isListening: boolean = false;
  private shouldRestart: boolean = false;
  private onWake: () => void;
  private onError: (err: any) => void;

  constructor(onWake: () => void, onError: (err: any) => void) {
    this.onWake = onWake;
    this.onError = onError;
    const win = window as unknown as IWindow;
    const SpeechRecognition = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (SpeechRecognition) {
      this.recognition = new SpeechRecognition();
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.lang = 'en-US';

      this.recognition.onresult = (event: any) => {
        // Debounce slightly? No, immediate reaction is better.
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const result = event.results[i];
          const transcript = result[0].transcript.toLowerCase().trim();
          
          const hasKeyword = WAKE_WORD_VARIATIONS.some(w => transcript.includes(w));
          
          // Lower confidence acceptance for keywords
          if (hasKeyword && (result.isFinal || result[0].confidence > 0.4)) {
             this.stop(); // Stop listening immediately
             this.onWake();
             return; 
          }
        }
      };

      this.recognition.onend = () => {
        if (this.shouldRestart) {
           try { 
             this.recognition.start(); 
           } catch (e) {
             console.warn("Wake word auto-restart failed", e);
             this.isListening = false;
           }
        } else {
            this.isListening = false;
        }
      };
      
      this.recognition.onerror = (event: any) => {
          if (event.error === 'not-allowed') {
              this.shouldRestart = false;
              this.isListening = false;
              this.onError('Microphone blocked.');
          } else if (event.error === 'aborted') {
              // Intentionally stopped
              this.isListening = false;
          } else {
             // For other errors (no-speech, network), we might want to keep trying
             // but let onend handle the restart check
          }
      };
    } else {
        this.onError('Wake word detection not supported.');
    }
  }

  start() {
    if (this.recognition && !this.isListening) {
      this.shouldRestart = true;
      this.isListening = true;
      try { 
          this.recognition.start(); 
      } catch (e) {
          console.warn("Wake word start failed:", e);
      }
    }
  }

  stop() {
    this.shouldRestart = false; // Prevent auto-restart
    if (this.recognition && this.isListening) {
      try { 
          this.recognition.abort(); 
      } catch (e) {
          // Ignore
      }
    }
    this.isListening = false;
  }
}