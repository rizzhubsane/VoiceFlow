export class AudioRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stream: MediaStream | null = null;

  async start(): Promise<void> {
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') return;
    
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.mediaRecorder = new MediaRecorder(this.stream);
      this.chunks = [];

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.chunks.push(e.data);
      };

      this.mediaRecorder.start();
    } catch (error) {
      console.error("Error accessing microphone:", error);
      throw error;
    }
  }

  async stop(): Promise<{ base64: string; mimeType: string }> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
        // If not recording, just resolve empty or reject. 
        // Resolving empty is safer to prevent crashes if double-stopped.
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