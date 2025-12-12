import { IWindow } from '../types';

export class SpeechService {
  private recognition: any;
  private isListening: boolean = false;

  constructor(
    onResult: (text: string) => void,
    onEnd: () => void,
    onError: (error: string) => void
  ) {
    const win = window as unknown as IWindow;
    const SpeechRecognition = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (SpeechRecognition) {
      try {
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = false;
        this.recognition.interimResults = false;
        this.recognition.lang = 'en-US';

        this.recognition.onresult = (event: any) => {
          const text = event.results[0][0].transcript;
          onResult(text);
        };

        this.recognition.onend = () => {
          this.isListening = false;
          onEnd();
        };

        this.recognition.onerror = (event: any) => {
          this.isListening = false;
          onError(event.error);
        };
      } catch (e) {
        console.error("Error initializing SpeechRecognition:", e);
        onError("initialization-failed");
      }
    } else {
      console.warn("SpeechRecognition not supported in this browser");
      onError("not-supported");
    }
  }

  start() {
    if (this.recognition && !this.isListening) {
      try {
        this.recognition.start();
        this.isListening = true;
      } catch (e) {
        console.error("Failed to start speech recognition", e);
      }
    }
  }

  stop() {
    if (this.recognition && this.isListening) {
      try {
        this.recognition.stop();
      } catch (e) {
        console.warn("Failed to stop speech recognition", e);
      }
      this.isListening = false;
    }
  }
}