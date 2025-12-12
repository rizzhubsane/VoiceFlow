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

  async generateEdits(input: string | { audioData: string, mimeType: string }, currentFiles: FileSystem): Promise<EditOperation[]> {
    const fileContext = Object.entries(currentFiles)
      .map(([path, file]) => `File: ${path}\n\`\`\`${file.language}\n${file.content}\n\`\`\``)
      .join('\n\n');

    const systemPrompt = `
      You are VoiceFlow, an AI coding engine that supports ALL programming languages.
      Your goal is to modify the provided codebase based on user voice commands or audio instructions.
      
      Current Project Files:
      ${fileContext}

      Supported Languages (but not limited to):
      - Web: HTML, CSS, JavaScript, TypeScript, React, Vue, Angular, Svelte
      - Backend: Python, Node.js, Java, Go, Rust, C++, C#, Ruby, PHP
      - Mobile: Swift, Kotlin, Dart (Flutter), React Native
      - Data Science: Python (NumPy, Pandas), R, Julia
      - Systems: C, C++, Rust, Assembly
      - Functional: Haskell, Scala, Elixir, F#
      - Database: SQL, MongoDB queries, GraphQL
      - Config: JSON, YAML, TOML, XML
      - Shell: Bash, PowerShell, Zsh
      - And ANY other programming language the user requests!

      Rules:
      1. Analyze the user's intent and detect the programming language they want to use.
      2. If the user mentions a specific language (e.g., "create a Python script", "write Java code"), use that language.
      3. If no language is specified, infer from context or file extensions.
      4. Return a strictly valid JSON array of edit operations.
      5. Operations can be 'create', 'edit', or 'delete'.
      6. For 'edit' or 'create', provide the FULL content of the file with proper syntax for that language.
      7. Include a 'summary' field that is a short, spoken-language explanation of what you did.
      8. Include a 'language' field in each operation to specify the programming language.
      9. If the user asks a question, use a virtual file named 'response.txt' to answer, or provide the answer in the 'summary' field.
      10. Follow best practices and conventions for each specific language.
      11. Add appropriate file extensions based on the language (e.g., .py for Python, .java for Java, .rs for Rust).
      
      Examples:
      - "Create a Python script to sort numbers" → creates main.py with Python code
      - "Write a Java class for user management" → creates User.java with Java code
      - "Make a Rust function for file handling" → creates file_handler.rs with Rust code
      - "Add a Go web server" → creates server.go with Go code
      
      Output Schema:
      Array of objects with: action, path, content, language, summary.
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
      parts.push({ text: "Listen to the audio command and modify the code accordingly. Detect the programming language from the user's request." });
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

      const audioContext = this.getAudioContext();
      
      // Ensure context is running (needed for some browsers if created before interaction)
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

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