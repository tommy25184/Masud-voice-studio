import { GoogleGenAI, Modality } from "@google/genai";

const splitTextIntoChunks = (text: string, maxWords: number = 200): string[] => {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  let currentChunk: string[] = [];

  for (const word of words) {
    currentChunk.push(word);
    // Split at sentence boundaries if we've reached the target size
    if (currentChunk.length >= maxWords && (word.endsWith('.') || word.endsWith('!') || word.endsWith('?') || word.endsWith('\n'))) {
      chunks.push(currentChunk.join(' '));
      currentChunk = [];
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join(' '));
  }

  return chunks;
};

const concatenateWavs = (wavs: Uint8Array[]): Uint8Array => {
  if (wavs.length === 0) return new Uint8Array(0);
  if (wavs.length === 1) return wavs[0];

  // Assume all wavs have the same format (16-bit mono 24kHz)
  // Header is 44 bytes
  let totalDataLength = 0;
  for (const wav of wavs) {
    totalDataLength += wav.length - 44;
  }

  const combined = new Uint8Array(44 + totalDataLength);
  
  // Copy header from first wav
  combined.set(wavs[0].subarray(0, 44));
  
  // Update file size (offset 4)
  const view = new DataView(combined.buffer);
  view.setUint32(4, 36 + totalDataLength, true);
  
  // Update data size (offset 40)
  view.setUint32(40, totalDataLength, true);

  // Copy data sections
  let offset = 44;
  for (const wav of wavs) {
    const dataSection = wav.subarray(44);
    combined.set(dataSection, offset);
    offset += dataSection.length;
  }

  return combined;
};

export const generateVoice = async (
  prompt: string, 
  voiceName: string = 'Kore',
  settings?: { rate?: number; pitch?: number; volume?: number },
  onProgress?: (current: number, total: number) => void
) => {
  const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Gemini API Key is missing. Please select an API key using the key icon or configure it in the Secrets panel.");
  }

  const ai = new GoogleGenAI({ apiKey });
  
  // Pre-process the prompt for pauses, breaths, and emphasis
  let processedPrompt = prompt;
  
  // 1. Handle Pauses: Replace '...' with explicit pause instructions
  processedPrompt = processedPrompt.replace(/\.\.\./g, " (pause for 2 seconds) ");
  
  // 2. Handle Emphasis: Detect text wrapped in double asterisks or specific markers
  processedPrompt = processedPrompt.replace(/\*\*(.*?)\*\*/g, "[speak with more depth, slightly louder and slower for emphasis] $1 [resume normal tone]");

  // Extract performance style if provided in the structured format
  let performanceStyle = "";
  let scriptText = processedPrompt;
  
  const styleCount = (processedPrompt.match(/PERFORMANCE STYLE:/g) || []).length;
  
  if (styleCount > 0) {
    if (styleCount > 1) {
      performanceStyle = "Follow the specific emotional styles and performance instructions indicated for each segment of the script below. Do NOT read the 'PERFORMANCE STYLE:' or 'SCRIPT:' labels aloud.";
      scriptText = processedPrompt;
    } else {
      const styleMatch = processedPrompt.match(/PERFORMANCE STYLE: ([\s\S]*?)\nSCRIPT: ([\s\S]*)/);
      if (styleMatch) {
        performanceStyle = styleMatch[1].trim();
        scriptText = styleMatch[2].trim();
      }
    }
  }

  // Construct the final instruction-heavy prompt
  const baseInstructions = [
    "Perform this script as a professional voice actor",
    "Maintain a natural, conversational flow with realistic prosody",
    "Incorporate subtle, natural human breaths and slight hesitations where appropriate to avoid a robotic feel",
    "Vary pitch and pacing naturally to reflect the emotional subtext",
    "Avoid a monotonous or robotic tone; keep the delivery dynamic and engaging throughout.",
    "Ensure smooth transitions between sentences",
    "IMPORTANT: Do NOT read any instructions, labels, or metadata aloud. Only read the actual script content."
  ];
  
  if (performanceStyle) {
    baseInstructions.push(`SPECIFIC STYLE: ${performanceStyle}`);
  }
  
  if (settings) {
    const { rate, pitch, volume } = settings;
    if (rate && rate !== 1) baseInstructions.push(rate > 1 ? "Speak slightly faster" : "Speak slightly slower");
    if (pitch && pitch !== 1) baseInstructions.push(pitch > 1 ? "Use a slightly higher pitch" : "Use a slightly lower pitch");
    if (volume && volume !== 1) baseInstructions.push(volume > 1 ? "Speak slightly louder" : "Speak slightly softer");
  }

  // Split the script into manageable chunks to prevent robotic voice and cutoffs
  const textChunks = splitTextIntoChunks(scriptText);
  const wavChunks: Uint8Array[] = [];

  for (let i = 0; i < textChunks.length; i++) {
    const chunk = textChunks[i];
    if (onProgress) onProgress(i + 1, textChunks.length);
    
    // Construct the final instruction-heavy prompt for this chunk
    const finalPrompt = `PERFORMANCE GUIDELINES:
${baseInstructions.map(i => "- " + i).join("\n")}
${textChunks.length > 1 ? `- This is part ${i + 1} of ${textChunks.length} of the script. Maintain consistent tone and energy.` : ""}

SCRIPT TO PERFORM:
${chunk}

(Note: Deliver a high-quality, professional voice performance. Ensure natural pacing and emotional depth.)`;

    const maxRetries = 3;
    let retryCount = 0;

    const callModel = async (): Promise<any> => {
      try {
        return await ai.models.generateContent({
          model: "gemini-2.5-flash-preview-tts",
          contents: [{ parts: [{ text: finalPrompt }] }],
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: voiceName },
              },
            },
          },
        });
      } catch (error: any) {
        const isRateLimit = error?.message?.includes("429") || error?.status === "RESOURCE_EXHAUSTED";
        const isInvalidKey = error?.message?.includes("Requested entity was not found");
        
        if (isInvalidKey && window.aistudio) {
          console.warn("Invalid API key. Prompting for re-selection.");
          await window.aistudio.openSelectKey();
          // The next attempt will use the new key because we create a new GoogleGenAI instance in each generateVoice call
        }

        if (isRateLimit && retryCount < maxRetries) {
          retryCount++;
          const delay = Math.pow(2, retryCount) * 1000; // Exponential backoff
          console.warn(`Rate limit hit. Retrying in ${delay}ms... (Attempt ${retryCount}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          return callModel();
        }
        throw error;
      }
    };

    const response = await callModel();
    const parts = response.candidates?.[0]?.content?.parts;
    
    if (!parts || parts.length === 0) {
      throw new Error(`No response parts received for chunk ${i + 1}.`);
    }

    // Add a small delay between chunks to avoid hitting rate limits too quickly
    if (i < textChunks.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    let chunkBytes = new Uint8Array(0);
    for (const part of parts) {
      if (part.inlineData?.data) {
        const binaryString = atob(part.inlineData.data);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let j = 0; j < len; j++) {
          bytes[j] = binaryString.charCodeAt(j);
        }
        
        const newCombined = new Uint8Array(chunkBytes.length + bytes.length);
        newCombined.set(chunkBytes);
        newCombined.set(bytes, chunkBytes.length);
        chunkBytes = newCombined;
      }
    }

    if (chunkBytes.length === 0) {
      throw new Error(`No audio data received for chunk ${i + 1}.`);
    }

    // Ensure it's a WAV or add header
    const isWav = chunkBytes.length > 12 && 
                  chunkBytes[0] === 0x52 && chunkBytes[1] === 0x49 && 
                  chunkBytes[2] === 0x46 && chunkBytes[3] === 0x46;

    if (!isWav) {
      const sampleRate = 24000;
      const numChannels = 1;
      const bitsPerSample = 16;
      const header = new ArrayBuffer(44);
      const view = new DataView(header);
      view.setUint32(0, 0x52494646, false);
      view.setUint32(4, 36 + chunkBytes.length, true);
      view.setUint32(8, 0x57415645, false);
      view.setUint32(12, 0x666d7420, false);
      view.setUint16(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, numChannels, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true);
      view.setUint16(32, numChannels * (bitsPerSample / 8), true);
      view.setUint16(34, bitsPerSample, true);
      view.setUint32(36, 0x64617461, false);
      view.setUint32(40, chunkBytes.length, true);
      
      const wavWithHeader = new Uint8Array(44 + chunkBytes.length);
      wavWithHeader.set(new Uint8Array(header));
      wavWithHeader.set(chunkBytes, 44);
      wavChunks.push(wavWithHeader);
    } else {
      wavChunks.push(chunkBytes);
    }
  }

  const combinedWav = concatenateWavs(wavChunks);

  // Convert to base64 for compatibility
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64data = reader.result as string;
      resolve(base64data.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(new Blob([combinedWav], { type: 'audio/wav' }));
  });
};

export const generateVoiceStream = async (
  prompt: string,
  voiceName: string = 'Kore',
  settings?: { rate?: number; pitch?: number; volume?: number },
  onChunk?: (base64Chunk: string) => void
) => {
  // For streaming, we'll use the chunked generateVoice to ensure quality and duration support
  // while still providing a base64 result at the end.
  return await generateVoice(prompt, voiceName, settings);
};
