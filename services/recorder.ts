export class AudioRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private silenceTimer: any = null;
  private animationFrame: number | null = null;

  async start(onSilence?: () => void): Promise<void> {
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') return;
    
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.mediaRecorder = new MediaRecorder(this.stream);
      this.chunks = [];

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.chunks.push(e.data);
      };

      this.mediaRecorder.start();

      if (onSilence) {
        this.detectSilence(this.stream, onSilence);
      }

    } catch (error) {
      console.error("Error accessing microphone:", error);
      throw error;
    }
  }

  private detectSilence(stream: MediaStream, onSilence: () => void) {
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const source = this.audioContext.createMediaStreamSource(stream);
    const analyser = this.audioContext.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    let silenceStart = Date.now();
    let hasSpoken = false; // Wait for user to speak at least once

    const checkSilence = () => {
      if (!this.mediaRecorder || this.mediaRecorder.state !== 'recording') return;

      analyser.getByteFrequencyData(dataArray);

      // Simple average volume
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const average = sum / bufferLength;

      // Thresholds (0-255)
      const SPEECH_THRESHOLD = 15; 
      const SILENCE_THRESHOLD = 10;
      const SILENCE_DURATION = 2000; // 2 seconds

      if (average > SPEECH_THRESHOLD) {
        hasSpoken = true;
        silenceStart = Date.now();
      } else if (hasSpoken && average < SILENCE_THRESHOLD) {
        if (Date.now() - silenceStart > SILENCE_DURATION) {
          onSilence();
          return; // Stop checking
        }
      } else if (!hasSpoken) {
          // Keep resetting start time until they speak
          silenceStart = Date.now();
      }

      this.animationFrame = requestAnimationFrame(checkSilence);
    };

    checkSilence();
  }

  async stop(): Promise<{ base64: string; mimeType: string }> {
    return new Promise((resolve, reject) => {
      if (this.animationFrame) {
        cancelAnimationFrame(this.animationFrame);
        this.animationFrame = null;
      }

      if (this.audioContext) {
        this.audioContext.close();
        this.audioContext = null;
      }

      if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
        this.cleanup();
        return resolve({ base64: '', mimeType: '' });
      }

      this.mediaRecorder.onstop = () => {
        const mimeType = this.mediaRecorder?.mimeType || 'audio/webm';
        const blob = new Blob(this.chunks, { type: mimeType });
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          // Extract base64 part
          const base64 = result.includes(',') ? result.split(',')[1] : result;
          this.cleanup();
          resolve({ base64, mimeType });
        };
        reader.onerror = (e) => reject(e);
        reader.readAsDataURL(blob);
      };

      this.mediaRecorder.stop();
    });
  }

  private cleanup() {
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
    this.mediaRecorder = null;
    this.chunks = [];
  }

  isRecording(): boolean {
    return !!this.mediaRecorder && this.mediaRecorder.state === 'recording';
  }
}