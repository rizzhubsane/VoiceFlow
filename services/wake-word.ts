import { IWindow } from '../types';

const WAKE_WORD_VARIATIONS = [
  'voiceflow', 'voice flow', 
  'hey voice', 'hey voiceflow', 
  'voice flo', 'voice low', 
  'boys flow', 'voice blow',
  'force flow'
];

export class WakeWordService {
  private recognition: any;
  private isListening: boolean = false;
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
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const result = event.results[i];
          const transcript = result[0].transcript.toLowerCase().trim();
          
          // Debug log for tuning
          // console.log("Wake word transcript:", transcript, "Confidence:", result[0].confidence);

          const isFinal = result.isFinal;
          // Lower confidence threshold if it's a very close string match
          const hasKeyword = WAKE_WORD_VARIATIONS.some(w => transcript.includes(w));
          
          if (hasKeyword && (isFinal || result[0].confidence > 0.5)) {
             this.stop(); 
             this.onWake();
             return; 
          }
        }
      };

      this.recognition.onend = () => {
        if (this.isListening) {
           // Restart loop
           try { 
             this.recognition.start(); 
           } catch (e) {
             console.warn("Wake word auto-restart failed", e);
           }
        }
      };
      
      this.recognition.onerror = (event: any) => {
          if (event.error === 'not-allowed') {
              this.isListening = false;
              this.onError('Microphone permission denied for wake word.');
          } else if (event.error === 'aborted') {
              // Ignore
          } else {
             // console.log("Wake word error:", event.error);
          }
      };
    } else {
        this.onError('Wake word detection not supported in this browser.');
    }
  }

  start() {
    if (this.recognition && !this.isListening) {
      this.isListening = true;
      try { 
          this.recognition.start(); 
      } catch (e) {
          console.warn("Wake word start ignored:", e);
      }
    }
  }

  stop() {
    this.isListening = false;
    if (this.recognition) {
      try { 
          // Abort closes the connection immediately, freeing the mic
          this.recognition.abort(); 
      } catch (e) {
          // Ignore
      }
    }
  }
}