import { GoogleGenAI, Type, Modality } from "@google/genai";
import { EditOperation, FileSystem } from "../types";

// Helper to decode base64 string to byte array
const decode = (base64: string) => {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// Convert Raw PCM Int16 to AudioBuffer
const decodeAudioData = async (
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> => {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      // Normalize Int16 (-32768 to 32767) to Float32 (-1.0 to 1.0)
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

export class GeminiService {
  private ai: GoogleGenAI;
  private audioContext: AudioContext | null = null;

  constructor() {
    const apiKey = process.env.API_KEY || '';
    if (!apiKey) {
      console.error("API_KEY is missing from environment variables");
    }
    this.ai = new GoogleGenAI({ apiKey });
  }

  private getAudioContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({sampleRate: 24000});
    }
    return this.audioContext;
  }

  async generateEdits(input: string | { audioData: string, mimeType: string }, currentFiles: FileSystem, contextPath?: string): Promise<EditOperation[]> {
    const fileContext = Object.entries(currentFiles)
      .map(([path, file]) => `File: ${path}\n\`\`\`${file.language}\n${file.content}\n\`\`\``)
      .join('\n\n');

    const systemPrompt = `
      You are VoiceFlow, an ultra-responsive, enthusiastic AI pair programmer.
      You function like a high-speed voice assistant (similar to ChatGPT Voice Mode).
      
      Goal: Modify code based on voice commands, BUT maintain a continuous, fluid conversation.

      Current Project Files:
      ${fileContext}
      
      ${contextPath ? `User is currently viewing: ${contextPath}` : ''}

      Supported Languages: All major programming languages.

      Rules:
      1. **Conversational Summary**: Your 'summary' field is what you speak back to the user. 
         - Keep it SHORT, CASUAL, and ENERGETIC.
         - **CRITICAL**: ALWAYS end your summary with a short follow-up question to keep the flow going (e.g., "Done. What's next?", "Added that. Should we style it?", "Fixed. Anything else?").
         - If the user just says "Hello" or asks a question without code, use the 'summary' to chat and return an empty operation list (or a dummy edit).
      
      2. **Code Operations**:
         - Return a valid JSON array of edit operations (create, edit, delete).
         - Provide FULL content for files.
         - Use best practices.

      Output Schema:
      Array of objects: { action, path, content, language, summary }
    `;

    // Construct content parts based on input type
    const parts: any[] = [];
    if (typeof input === 'string') {
      parts.push({ text: input });
    } else {
      parts.push({
        inlineData: {
          mimeType: input.mimeType,
          data: input.audioData
        }
      });
      parts.push({ text: "Listen to the audio. If it's code, generate edits. If it's chat, just provide a conversational summary. Always end the summary with a short question to invite more input." });
    }

    const response = await this.ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: { parts },
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              action: { type: Type.STRING, enum: ["create", "edit", "delete"] },
              path: { type: Type.STRING },
              content: { type: Type.STRING },
              language: { type: Type.STRING },
              summary: { type: Type.STRING },
            },
            required: ["action", "path", "summary"],
          }
        }
      }
    });

    if (response.text) {
      try {
        let cleanText = response.text.trim();
        // Remove markdown fences if present
        if (cleanText.startsWith('```')) {
            cleanText = cleanText.replace(/^```(json)?/, '').replace(/```$/, '').trim();
        }
        return JSON.parse(cleanText) as EditOperation[];
      } catch (e) {
        console.error("Failed to parse Gemini response", e);
        return [{
            action: 'edit', 
            path: 'response.txt', 
            summary: "I heard you, but I got a bit confused with the data. Can you say that again?", 
            content: '', 
            language: 'text'
        }];
      }
    }
    return [];
  }

  // Returns a promise that resolves when the audio has FINISHED playing
  async speak(text: string): Promise<void> {
    return new Promise(async (resolve, reject) => {
      try {
        const response = await this.ai.models.generateContent({
          model: "gemini-2.5-flash-preview-tts",
          contents: [{ parts: [{ text }] }],
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: 'Kore' }, 
              },
            },
          },
        });

        const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        
        if (!base64Audio) {
           resolve();
           return;
        }

        const audioContext = this.getAudioContext();
        
        // Ensure context is running (browsers suspend it until user interaction)
        if (audioContext.state === 'suspended') {
          await audioContext.resume();
        }

        // Gemini TTS is 24kHz raw PCM mono
        const audioBuffer = await decodeAudioData(
          decode(base64Audio),
          audioContext,
          24000,
          1
        );

        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContext.destination);
        
        source.onended = () => {
            resolve();
        };

        source.start();

      } catch (e) {
        console.warn("Gemini TTS failed, falling back to browser TTS", e);
        // Fallback
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.1; 
        utterance.onend = () => resolve();
        utterance.onerror = () => resolve(); 
        window.speechSynthesis.speak(utterance);
      }
    });
  }
}