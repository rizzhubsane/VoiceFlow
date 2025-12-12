import { GoogleGenAI, Type, Modality } from "@google/genai";
import { EditOperation, FileSystem } from "../types";

// Helper to decode base64 audio
const decode = (base64: string) => {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

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
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

export class GeminiService {
  private ai: GoogleGenAI;

  constructor() {
    const apiKey = process.env.API_KEY || '';
    if (!apiKey) {
      console.error("API_KEY is missing from environment variables");
    }
    this.ai = new GoogleGenAI({ apiKey });
  }

  async generateEdits(userPrompt: string, currentFiles: FileSystem): Promise<EditOperation[]> {
    const fileContext = Object.entries(currentFiles)
      .map(([path, file]) => `File: ${path}\n\`\`\`${file.language}\n${file.content}\n\`\`\``)
      .join('\n\n');

    const systemPrompt = `
      You are VoiceFlow, an AI coding engine.
      Your goal is to modify the provided codebase based on user voice commands.
      
      Current Project Files:
      ${fileContext}

      Rules:
      1. Analyze the user's intent.
      2. Return a strictly valid JSON array of edit operations.
      3. Operations can be 'create', 'edit', or 'delete'.
      4. For 'edit' or 'create', provide the FULL content of the file. Do not use diffs.
      5. Include a 'summary' field that is a short, spoken-language explanation of what you did.
      6. If the user asks a question, use a virtual file named 'response.txt' to answer, or just provide the answer in the 'summary' field if no code change is needed.
      7. Assume a simple HTML/CSS/JS or React structure.
      
      Output Schema:
      Array of objects with: action, path, content, summary.
    `;

    const response = await this.ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: userPrompt,
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
        throw new Error("Invalid response format from AI");
      }
    }
    return [];
  }

  async speak(text: string): Promise<void> {
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
         throw new Error("No audio data received");
      }

      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({sampleRate: 24000});
      const audioBuffer = await decodeAudioData(
        decode(base64Audio),
        audioContext,
        24000,
        1
      );

      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.destination);
      source.start();

    } catch (e) {
      console.warn("Gemini TTS failed, falling back to browser TTS", e);
      const utterance = new SpeechSynthesisUtterance(text);
      window.speechSynthesis.speak(utterance);
    }
  }
}