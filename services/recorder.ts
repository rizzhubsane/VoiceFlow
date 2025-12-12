export class AudioRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private animationFrame: number | null = null;
  private silenceNode: ScriptProcessorNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;

  async start(onSilence?: () => void): Promise<void> {
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') return;
    
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const mimeType = this.getSupportedMimeType();
      this.mediaRecorder = new MediaRecorder(this.stream, { mimeType });
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

  private getSupportedMimeType(): string {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/ogg;codecs=opus',
      ''
    ];
    for (const type of types) {
      if (type === '' || MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    return '';
  }

  private detectSilence(stream: MediaStream, onSilence: () => void) {
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const analyser = this.audioContext.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.8;
    
    this.sourceNode = this.audioContext.createMediaStreamSource(stream);
    this.sourceNode.connect(analyser);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    let silenceStart = Date.now();
    let hasSpoken = false; 

    const checkSilence = () => {
      if (!this.mediaRecorder || this.mediaRecorder.state !== 'recording') return;

      analyser.getByteFrequencyData(dataArray);

      // Average volume calculation
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const average = sum / bufferLength;

      // Adjusted thresholds
      const SPEECH_THRESHOLD = 20; 
      const SILENCE_THRESHOLD = 12;
      const SILENCE_DURATION = 1500; // 1.5s silence

      if (average > SPEECH_THRESHOLD) {
        hasSpoken = true;
        silenceStart = Date.now();
      } else if (hasSpoken && average < SILENCE_THRESHOLD) {
        if (Date.now() - silenceStart > SILENCE_DURATION) {
          onSilence();
          return; 
        }
      } else if (!hasSpoken) {
          // Reset silence start until speech is detected
          silenceStart = Date.now();
      }

      this.animationFrame = requestAnimationFrame(checkSilence);
    };

    checkSilence();
  }

  async stop(): Promise<{ base64: string; mimeType: string }> {
    return new Promise((resolve, reject) => {
      // Cleanup silence detection
      if (this.animationFrame) {
        cancelAnimationFrame(this.animationFrame);
        this.animationFrame = null;
      }

      if (this.sourceNode) {
        this.sourceNode.disconnect();
        this.sourceNode = null;
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
          const base64 = result.includes(',') ? result.split(',')[1] : result;
          this.cleanup();
          resolve({ base64, mimeType });
        };
        reader.onerror = (e) => reject(e);
        reader.readAsDataURL(blob);
      };

      try {
        this.mediaRecorder.stop();
      } catch (e) {
        this.cleanup();
        resolve({ base64: '', mimeType: '' });
      }
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