import React, { useState, useRef } from 'react';
import { 
  Mic2, 
  Plus, 
  Trash2, 
  Play, 
  Download, 
  Loader2, 
  Settings2, 
  Volume2,
  FileText,
  Sparkles,
  ChevronDown,
  ChevronUp,
  History,
  Save,
  Clock,
  Bookmark,
  Library,
  Clipboard,
  X
} from 'lucide-react';

declare global {
  interface Window {
    aistudio: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from "@google/genai";
import { generateVoice, generateVoiceStream } from './lib/gemini';
import { cn } from './lib/utils';

interface ScriptBlock {
  id: string;
  text: string;
  instruction: string;
  customInstruction?: string;
  previewUrl?: string;
  isPreviewing?: boolean;
}

interface Draft {
  id: string;
  name: string;
  blocks: ScriptBlock[];
  voice: string;
  settings: any;
  timestamp: number;
}

interface HistoryItem {
  id: string;
  prompt: string;
  voice: string;
  audioUrl: string;
  timestamp: number;
}

const VOICES = [
  { id: 'Kore', name: 'Kore', gender: 'Female', accent: 'Professional', description: 'Clear and balanced' },
  { id: 'Puck', name: 'Puck', gender: 'Male', accent: 'Youthful', description: 'Bright and energetic' },
  { id: 'Charon', name: 'Charon', gender: 'Male', accent: 'Authoritative', description: 'Deep and calm' },
  { id: 'Fenrir', name: 'Fenrir', gender: 'Male', accent: 'Friendly', description: 'Warm and inviting' },
  { id: 'Zephyr', name: 'Zephyr', gender: 'Female', accent: 'Soothing', description: 'Gentle and soft' },
];

const EMOTIONS = [
  "Neutral",
  "Cheerful",
  "Sad",
  "Angry",
  "Whispering",
  "Excited",
  "Serious",
  "Sarcastic",
  "Fearful",
  "Friendly",
  "Inspirational",
  "Storytelling",
  "Custom"
];

const AudioVisualizer = ({ isPlaying }: { isPlaying: boolean }) => {
  return (
    <div className="flex items-center gap-1 h-6">
      {[...Array(12)].map((_, i) => (
        <motion.div
          key={i}
          animate={isPlaying ? {
            height: [4, 16, 8, 20, 4],
          } : {
            height: 4
          }}
          transition={{
            duration: 0.8,
            repeat: Infinity,
            delay: i * 0.05,
            ease: "easeInOut"
          }}
          className="w-1 bg-indigo-500/60 rounded-full"
        />
      ))}
    </div>
  );
};

export default function App() {
  const [blocks, setBlocks] = useState<ScriptBlock[]>([
    { id: '1', text: '', instruction: 'Cheerful', isPreviewing: false }
  ]);
  const [selectedVoice, setSelectedVoice] = useState('Kore');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<{ current: number; total: number } | null>(null);
  const [isPlayingSample, setIsPlayingSample] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState({
    rate: 1,
    pitch: 1,
    volume: 1
  });
  const [exportFormat, setExportFormat] = useState('wav');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamAudioUrl, setStreamAudioUrl] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>(() => {
    const saved = localStorage.getItem('voice_studio_drafts');
    return saved ? JSON.parse(saved) : [];
  });
  const [history, setHistory] = useState<HistoryItem[]>(() => {
    const saved = localStorage.getItem('voice_studio_history');
    return saved ? JSON.parse(saved) : [];
  });
  const [activeTab, setActiveTab] = useState<'editor' | 'library'>('editor');
  const [isPasteModalOpen, setIsPasteModalOpen] = useState(false);
  const [isVoiceGalleryOpen, setIsVoiceGalleryOpen] = useState(false);
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);
  const [isSaveDraftOpen, setIsSaveDraftOpen] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [pastedText, setPastedText] = useState('');
  const [lastSaved, setLastSaved] = useState<number | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-save current state
  React.useEffect(() => {
    const timer = setTimeout(() => {
      localStorage.setItem('voice_studio_current_blocks', JSON.stringify(blocks));
      localStorage.setItem('voice_studio_current_voice', selectedVoice);
      localStorage.setItem('voice_studio_current_settings', JSON.stringify(settings));
      setLastSaved(Date.now());
    }, 2000);
    return () => clearTimeout(timer);
  }, [blocks, selectedVoice, settings]);

  // Load auto-saved state
  React.useEffect(() => {
    const savedBlocks = localStorage.getItem('voice_studio_current_blocks');
    const savedVoice = localStorage.getItem('voice_studio_current_voice');
    const savedSettings = localStorage.getItem('voice_studio_current_settings');
    
    if (savedBlocks) setBlocks(JSON.parse(savedBlocks));
    if (savedVoice) setSelectedVoice(savedVoice);
    if (savedSettings) setSettings(JSON.parse(savedSettings));
  }, []);

  React.useEffect(() => {
    localStorage.setItem('voice_studio_drafts', JSON.stringify(drafts));
  }, [drafts]);

  React.useEffect(() => {
    localStorage.setItem('voice_studio_history', JSON.stringify(history));
  }, [history]);

  const clearEditor = () => {
    setBlocks([{ id: '1', text: '', instruction: 'Cheerful', isPreviewing: false }]);
    setAudioUrl(null);
    setStreamAudioUrl(null);
    localStorage.removeItem('voice_studio_current_blocks');
    setIsClearConfirmOpen(false);
  };

  const saveDraft = () => {
    if (!draftName.trim()) return;
    
    const newDraft: Draft = {
      id: Math.random().toString(36).substr(2, 9),
      name: draftName.trim(),
      blocks,
      voice: selectedVoice,
      settings,
      timestamp: Date.now()
    };
    setDrafts([newDraft, ...drafts]);
    setIsSaveDraftOpen(false);
    setDraftName('');
  };

  const loadDraft = (draft: Draft) => {
    setBlocks(draft.blocks);
    setSelectedVoice(draft.voice);
    setSettings(draft.settings);
    setActiveTab('editor');
  };

  const deleteDraft = (id: string) => {
    setDrafts(drafts.filter(d => d.id !== id));
  };

  const clearHistory = () => {
    if (confirm("Clear all history?")) {
      setHistory([]);
    }
  };

  const handlePlaySample = async (voiceId: string) => {
    setIsPlayingSample(voiceId);
    try {
      const sampleText = "This is a sample of how I sound with your current settings.";
      const base64 = await generateVoice(sampleText, voiceId, settings);
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.play();
    } catch (err: any) {
      setError(`Sample failed: ${err.message}`);
    } finally {
      setIsPlayingSample(null);
    }
  };

  const addBlock = () => {
    setBlocks([...blocks, { id: Math.random().toString(36).substr(2, 9), text: '', instruction: 'Neutral', isPreviewing: false }]);
  };

  const removeBlock = (id: string) => {
    if (blocks.length > 1) {
      setBlocks(blocks.filter(block => block.id !== id));
    }
  };

  const updateBlock = (id: string, field: keyof ScriptBlock, value: any) => {
    setBlocks(blocks.map(block => block.id === id ? { ...block, [field]: value } : block));
  };

  const getBlockPrompt = (block: ScriptBlock) => {
    const tone = block.instruction === 'Custom' ? block.customInstruction : block.instruction;
    
    if (tone && tone !== 'Neutral') {
      return `PERFORMANCE STYLE: ${tone}\nSCRIPT: ${block.text}`;
    }
    
    return block.text;
  };

  const handlePreviewBlock = async (block: ScriptBlock) => {
    if (!block.text.trim()) return;

    updateBlock(block.id, 'isPreviewing', true);
    try {
      const prompt = getBlockPrompt(block);
      
      const base64 = await generateVoice(prompt, selectedVoice, settings);
      const res = await fetch(`data:audio/wav;base64,${base64}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      updateBlock(block.id, 'previewUrl', url);
    } catch (err: any) {
      setError(`Preview failed: ${err.message}`);
    } finally {
      updateBlock(block.id, 'isPreviewing', false);
    }
  };

  const moveBlock = (index: number, direction: 'up' | 'down') => {
    const newBlocks = [...blocks];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex >= 0 && targetIndex < newBlocks.length) {
      [newBlocks[index], newBlocks[targetIndex]] = [newBlocks[targetIndex], newBlocks[index]];
      setBlocks(newBlocks);
    }
  };

  const handleGenerate = async () => {
    if (blocks.some(b => !b.text.trim())) {
      setError("Please fill in all script blocks.");
      return;
    }

    setIsGenerating(true);
    setGenerationProgress(null);
    setError(null);
    setAudioUrl(null);

    try {
      const prompt = blocks.map(block => getBlockPrompt(block)).join('\n\n');
      const base64 = await generateVoice(prompt, selectedVoice, settings, (current, total) => {
        setGenerationProgress({ current, total });
      });
      const res = await fetch(`data:audio/wav;base64,${base64}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);

      const historyItem: HistoryItem = {
        id: Math.random().toString(36).substr(2, 9),
        prompt,
        voice: selectedVoice,
        audioUrl: url,
        timestamp: Date.now()
      };
      setHistory(prev => [historyItem, ...prev].slice(0, 20));
    } catch (err: any) {
      const isRateLimit = err.message?.includes("429") || err.message?.includes("RESOURCE_EXHAUSTED");
      
      if (isRateLimit) {
        setError("API Quota exceeded. Please wait a few minutes before trying again.");
      } else {
        setError(err.message || "Failed to generate voice. Please try again.");
      }
    } finally {
      setIsGenerating(false);
      setGenerationProgress(null);
    }
  };

  const handleStreamPreview = async () => {
    if (blocks.some(b => !b.text.trim())) {
      setError("Please fill in all script blocks.");
      return;
    }

    setIsStreaming(true);
    setError(null);
    setStreamAudioUrl(null);

    try {
      const prompt = blocks.map(block => getBlockPrompt(block)).join('\n\n');
      let accumulatedBase64 = "";
      
      // We'll use a simple approach: accumulate and play at the end for now, 
      // but the function supports chunking if we wanted to implement a real-time buffer player.
      const fullBase64 = await generateVoiceStream(prompt, selectedVoice, settings, (chunk) => {
        // In a real streaming player, we'd feed this to an AudioWorklet or similar.
        // For this demo, we'll show the "Streaming" state to the user.
      });

      const res = await fetch(`data:audio/wav;base64,${fullBase64}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setStreamAudioUrl(url);
      
      const audio = new Audio(url);
      audio.play();
    } catch (err: any) {
      setError(`Streaming failed: ${err.message}`);
    } finally {
      setIsStreaming(false);
    }
  };

  const analyzeScriptWithAI = async (text: string) => {
    setIsAnalyzing(true);
    setError(null);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{
          parts: [{
            text: `Analyze the following script for a high-quality, professional Text-to-Speech system. Your task is to split it into logical segments based on timestamps (like [00:10]) or natural paragraph breaks while deeply understanding the overall context and subtext.

            CRITICAL RULES:
            1. DO NOT change the core meaning or omit ANY part of the original narration text.
            2. PRESERVE every single word of the narration, but you MAY improve punctuation (commas, periods, question marks) to ensure a natural, human-like flow and better realism.
            3. STRIP OUT the following elements from the final 'text' field:
               - Timestamps (e.g., remove '[00:10]').
               - Chapter Headings (e.g., 'Chapter 1: The Beginning').
               - Voice Over labels or markers (e.g., 'VO:', 'Narrator:', '[Voice Over]').
            4. For each segment, provide a HIGHLY NUANCED and REALISTIC vocal performance instruction. 
               - Identify subtle emotional cues and subtext (e.g., 'A hint of underlying anxiety despite the calm words' or 'A suppressed chuckle beneath the surface').
               - Specify vocal textures and techniques: breathiness, vocal fry, slight hesitations, micro-pauses, or specific word emphasis.
               - Describe the pacing and pitch shifts relative to the surrounding context (e.g., 'Start with a higher pitch and gradually drop to a more intimate, lower tone').
               - Include natural human elements like audible breaths, sighs, or soft clicks where they enhance realism.
               - Aim for 15-25 words of extremely detailed instruction per segment to guide the TTS model precisely.
            
            Return the result ONLY as a JSON array of objects: [{"text": "full segment text here", "instruction": "Detailed vocal instruction"}]

            Script:
            ${text}`
          }]
        }],
        config: {
          responseMimeType: "application/json"
        }
      });

      const result = JSON.parse(response.text || "[]");
      if (Array.isArray(result) && result.length > 0) {
        setBlocks(result.map(item => ({
          id: Math.random().toString(36).substr(2, 9),
          text: item.text,
          instruction: EMOTIONS.includes(item.instruction) ? item.instruction : 'Custom',
          customInstruction: EMOTIONS.includes(item.instruction) ? undefined : item.instruction
        })));
      } else {
        throw new Error("Invalid AI response format");
      }
    } catch (err: any) {
      console.error("AI Analysis failed:", err);
      // Fallback to simple split
      const lines = text.split(/\n\s*\n/).filter(l => l.trim());
      setBlocks(lines.map(line => ({
        id: Math.random().toString(36).substr(2, 9),
        text: line.trim(),
        instruction: 'Neutral'
      })));
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      
      // Check if it looks like it needs AI analysis (timestamps or just long)
      const hasTimestamps = /\[?\d{1,2}:\d{2}\]?/.test(content);
      
      if (hasTimestamps || content.length > 300) {
        analyzeScriptWithAI(content);
      } else {
        const lines = content.split(/\n\s*\n/).filter(l => l.trim());
        if (lines.length > 0) {
          setBlocks(lines.map(line => ({
            id: Math.random().toString(36).substr(2, 9),
            text: line.trim(),
            instruction: 'Neutral'
          })));
        }
      }
    };
    reader.readAsText(file);
  };

  const handlePasteSubmit = () => {
    if (!pastedText.trim()) return;
    
    const content = pastedText.trim();
    const hasTimestamps = /\[?\d{1,2}:\d{2}\]?/.test(content);
    
    if (hasTimestamps || content.length > 300) {
      analyzeScriptWithAI(content);
    } else {
      const lines = content.split(/\n\s*\n/).filter(l => l.trim());
      if (lines.length > 0) {
        setBlocks(lines.map(line => ({
          id: Math.random().toString(36).substr(2, 9),
          text: line.trim(),
          instruction: 'Neutral'
        })));
      }
    }
    
    setIsPasteModalOpen(false);
    setPastedText('');
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-slate-200 font-sans selection:bg-indigo-500/30">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-[#0a0a0f]/80 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Mic2 className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400 tracking-tight">
                VoiceStudio
              </h1>
            </div>
          </div>
          
          <div className="hidden md:flex items-center gap-2">
            <button 
              onClick={() => setActiveTab('editor')}
              className={cn(
                "px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200",
                activeTab === 'editor' ? "bg-white/10 text-white" : "text-slate-400 hover:text-white hover:bg-white/5"
              )}
            >
              Editor
            </button>
            <button 
              onClick={() => setActiveTab('library')}
              className={cn(
                "px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200",
                activeTab === 'library' ? "bg-white/10 text-white" : "text-slate-400 hover:text-white hover:bg-white/5"
              )}
            >
              Library
            </button>
          </div>

          <div className="flex items-center gap-3">
            <button 
              onClick={() => setIsClearConfirmOpen(true)}
              className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-medium text-slate-400 hover:text-white transition-all flex items-center gap-2"
              title="New Project"
            >
              <Plus className="w-4 h-4" />
              New
            </button>
            <button 
              onClick={() => {
                setDraftName(`Draft ${new Date().toLocaleString()}`);
                setIsSaveDraftOpen(true);
              }}
              className="p-2 text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
              title="Save Draft"
            >
              <Save className="w-5 h-5" />
            </button>
            <button 
              onClick={() => setShowAdvanced(!showAdvanced)}
              className={cn(
                "p-2 rounded-lg transition-all duration-200",
                showAdvanced ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/30" : "text-slate-400 hover:text-white hover:bg-white/5"
              )}
              title="Settings"
            >
              <Settings2 className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 pb-32 md:pb-12 relative z-10">
        <AnimatePresence mode="wait">
          {activeTab === 'editor' ? (
            <motion.div 
              key="editor"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              {/* Top Actions */}
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setIsPasteModalOpen(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-sm font-medium transition-all"
                  >
                    <Clipboard className="w-4 h-4 text-indigo-400" />
                    Paste Script
                  </button>
                  <label className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-sm font-medium transition-all cursor-pointer">
                    <FileText className="w-4 h-4 text-purple-400" />
                    Upload File
                    <input type="file" className="hidden" accept=".txt,.doc,.docx" onChange={handleFileUpload} />
                  </label>
                  {lastSaved && (
                    <span className="text-[10px] text-slate-500 font-mono ml-2 hidden sm:inline">
                      Auto-saved {new Date(lastSaved).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </div>
                
                <div className="flex items-center gap-4">
                  <div className="hidden lg:flex items-center gap-4 px-4 py-2 bg-white/5 border border-white/10 rounded-xl">
                    <div className="flex flex-col">
                      <span className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">Words</span>
                      <span className="text-sm font-mono text-indigo-400">
                        {blocks.reduce((acc, b) => acc + b.text.trim().split(/\s+/).filter(w => w).length, 0)}
                      </span>
                    </div>
                    <div className="w-px h-6 bg-white/10" />
                    <div className="flex flex-col">
                      <span className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">Est. Time</span>
                      <span className="text-sm font-mono text-purple-400">
                        {Math.ceil(blocks.reduce((acc, b) => acc + b.text.trim().split(/\s+/).filter(w => w).length, 0) / 2.5)}s
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setIsClearConfirmOpen(true)}
                      className="p-2 text-slate-500 hover:text-red-400 transition-colors"
                      title="Clear Editor"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                    <span className="text-xs text-slate-500 font-medium uppercase tracking-wider">Voice:</span>
                    <button
                      onClick={() => setIsVoiceGalleryOpen(true)}
                      className="flex items-center gap-2 px-3 py-1.5 bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 rounded-lg text-xs font-bold transition-all"
                    >
                      <Library className="w-3 h-3" />
                      Gallery
                    </button>
                    <div className="relative group">
                      <select 
                        value={selectedVoice}
                        onChange={(e) => setSelectedVoice(e.target.value)}
                        className="appearance-none bg-white/5 border border-white/10 rounded-xl px-4 py-2 pr-10 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all cursor-pointer"
                      >
                        {VOICES.map(v => (
                          <option key={v.id} value={v.id} className="bg-[#1a1a24]">{v.name}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                    </div>
                    <button
                      onClick={() => handlePlaySample(selectedVoice)}
                      disabled={isPlayingSample !== null}
                      className="p-2 bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 rounded-xl transition-all disabled:opacity-50"
                    >
                      {isPlayingSample === selectedVoice ? <Loader2 className="w-5 h-5 animate-spin" /> : <Volume2 className="w-5 h-5" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Advanced Settings Panel */}
              <AnimatePresence>
                {showAdvanced && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="p-6 bg-white/5 border border-white/10 rounded-2xl grid grid-cols-1 md:grid-cols-3 gap-8">
                      <div className="space-y-4">
                        <div className="flex justify-between items-center">
                          <label className="text-sm font-medium text-slate-400">Speech Rate</label>
                          <span className="text-xs font-mono text-indigo-400">{settings.rate}x</span>
                        </div>
                        <input 
                          type="range" min="0.5" max="2" step="0.1" 
                          value={settings.rate} 
                          onChange={(e) => setSettings({...settings, rate: parseFloat(e.target.value)})}
                          className="w-full accent-indigo-500"
                        />
                      </div>
                      <div className="space-y-4">
                        <div className="flex justify-between items-center">
                          <label className="text-sm font-medium text-slate-400">Pitch</label>
                          <span className="text-xs font-mono text-purple-400">{settings.pitch}x</span>
                        </div>
                        <input 
                          type="range" min="0.5" max="2" step="0.1" 
                          value={settings.pitch} 
                          onChange={(e) => setSettings({...settings, pitch: parseFloat(e.target.value)})}
                          className="w-full accent-purple-500"
                        />
                      </div>
                      <div className="space-y-4">
                        <div className="flex justify-between items-center">
                          <label className="text-sm font-medium text-slate-400">Volume</label>
                          <span className="text-xs font-mono text-blue-400">{settings.volume}x</span>
                        </div>
                        <input 
                          type="range" min="0" max="2" step="0.1" 
                          value={settings.volume} 
                          onChange={(e) => setSettings({...settings, volume: parseFloat(e.target.value)})}
                          className="w-full accent-blue-500"
                        />
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Script Blocks */}
              <div className="space-y-4">
                {blocks.map((block, index) => (
                  <motion.div 
                    layout
                    key={block.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="group relative bg-white/5 hover:bg-white/[0.07] border border-white/10 rounded-2xl transition-all duration-300"
                  >
                    <div className="p-4 md:p-6 flex flex-col md:flex-row gap-4">
                      {/* Block Controls - Left */}
                      <div className="flex md:flex-col items-center justify-center gap-2 md:border-r md:border-white/5 md:pr-4">
                        <button 
                          onClick={() => moveBlock(index, 'up')}
                          disabled={index === 0}
                          className="p-1.5 text-slate-500 hover:text-white disabled:opacity-20 transition-colors"
                        >
                          <ChevronUp className="w-5 h-5" />
                        </button>
                        <span className="text-xs font-mono text-slate-600">{index + 1}</span>
                        <button 
                          onClick={() => moveBlock(index, 'down')}
                          disabled={index === blocks.length - 1}
                          className="p-1.5 text-slate-500 hover:text-white disabled:opacity-20 transition-colors"
                        >
                          <ChevronDown className="w-5 h-5" />
                        </button>
                      </div>

                      {/* Content Area */}
                      <div className="flex-1 space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <select 
                              value={block.instruction}
                              onChange={(e) => updateBlock(block.id, 'instruction', e.target.value)}
                              className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
                            >
                              {EMOTIONS.map(e => <option key={e} value={e} className="bg-[#1a1a24]">{e}</option>)}
                            </select>
                            {block.instruction === 'Custom' && (
                              <input 
                                type="text"
                                placeholder="e.g. Whispering, intense..."
                                value={block.customInstruction || ''}
                                onChange={(e) => updateBlock(block.id, 'customInstruction', e.target.value)}
                                className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500/50 w-40"
                              />
                            )}
                          </div>
                          
                          <div className="flex items-center gap-2">
                            {block.previewUrl && (
                              <button 
                                onClick={() => new Audio(block.previewUrl).play()}
                                className="p-2 bg-green-500/10 text-green-400 hover:bg-green-500/20 rounded-lg transition-all"
                              >
                                <Play className="w-4 h-4" />
                              </button>
                            )}
                            <button 
                              onClick={() => handlePreviewBlock(block)}
                              disabled={block.isPreviewing}
                              className="flex items-center gap-2 px-3 py-1.5 bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 rounded-lg text-xs font-medium transition-all disabled:opacity-50"
                            >
                              {block.isPreviewing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                              Preview
                            </button>
                            <button 
                              onClick={() => removeBlock(block.id)}
                              className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        <textarea 
                          value={block.text}
                          onChange={(e) => updateBlock(block.id, 'text', e.target.value)}
                          placeholder="Type or paste your script segment here..."
                          className="w-full bg-transparent border-none p-0 text-slate-200 placeholder:text-slate-600 focus:ring-0 resize-none min-h-[80px] text-lg leading-relaxed"
                        />
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>

              {/* Add Block Button */}
              <button 
                onClick={addBlock}
                className="w-full py-4 border-2 border-dashed border-white/5 hover:border-indigo-500/30 hover:bg-indigo-500/5 rounded-2xl flex items-center justify-center gap-2 text-slate-500 hover:text-indigo-400 transition-all group"
              >
                <Plus className="w-5 h-5 group-hover:scale-110 transition-transform" />
                <span className="font-medium">Add Script Segment</span>
              </button>

              {/* Main Actions Bar */}
              <div className="fixed bottom-20 md:bottom-8 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-2xl z-50">
                <div className="bg-[#1a1a24]/90 backdrop-blur-2xl border border-white/10 rounded-3xl p-3 shadow-2xl shadow-black/50 flex items-center gap-3">
                  <div className="hidden sm:flex items-center px-4 border-r border-white/5">
                    <AudioVisualizer isPlaying={isStreaming || isGenerating || isPlayingSample !== null} />
                  </div>
                  <button 
                    onClick={handleStreamPreview}
                    disabled={isStreaming || isGenerating}
                    className="flex-1 flex items-center justify-center gap-2 h-14 bg-white/5 hover:bg-white/10 text-white rounded-2xl font-bold transition-all disabled:opacity-50"
                  >
                    {isStreaming ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5 text-indigo-400" />}
                    <span className="hidden sm:inline">Stream Preview</span>
                    <span className="sm:hidden">Stream</span>
                  </button>
                  <button 
                    onClick={handleGenerate}
                    disabled={isGenerating || isStreaming}
                    className="flex-[1.5] flex items-center justify-center gap-2 h-14 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-2xl font-bold shadow-lg shadow-indigo-600/20 transition-all disabled:opacity-50"
                  >
                    {isGenerating ? (
                      <div className="flex items-center gap-2">
                        <Loader2 className="w-6 h-6 animate-spin" />
                        {generationProgress && (
                          <span className="text-xs font-mono">
                            {generationProgress.current}/{generationProgress.total}
                          </span>
                        )}
                      </div>
                    ) : <Sparkles className="w-6 h-6" />}
                    <span>{isGenerating ? 'Generating...' : 'Generate Full Audio'}</span>
                  </button>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div 
              key="library"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="grid grid-cols-1 lg:grid-cols-2 gap-8"
            >
              {/* Drafts */}
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-bold flex items-center gap-2">
                    <Bookmark className="w-5 h-5 text-indigo-400" />
                    Saved Drafts
                  </h2>
                </div>
                <div className="space-y-3">
                  {drafts.length === 0 ? (
                    <div className="p-12 bg-white/5 border border-white/10 border-dashed rounded-2xl text-center text-slate-500">
                      No saved drafts yet.
                    </div>
                  ) : (
                    drafts.map(draft => (
                      <div key={draft.id} className="p-4 bg-white/5 border border-white/10 rounded-2xl flex items-center justify-between group hover:bg-white/[0.07] transition-all">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 bg-indigo-500/10 rounded-xl flex items-center justify-center">
                            <FileText className="w-5 h-5 text-indigo-400" />
                          </div>
                          <div>
                            <h3 className="font-medium text-slate-200">{draft.name}</h3>
                            <p className="text-xs text-slate-500">{new Date(draft.timestamp).toLocaleDateString()}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all">
                          <button onClick={() => loadDraft(draft)} className="p-2 bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 rounded-lg transition-all">
                            <Play className="w-4 h-4" />
                          </button>
                          <button onClick={() => deleteDraft(draft.id)} className="p-2 text-slate-500 hover:text-red-400 transition-all">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* History */}
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-bold flex items-center gap-2">
                    <History className="w-5 h-5 text-purple-400" />
                    Recent Activity
                  </h2>
                  <button onClick={clearHistory} className="text-xs text-slate-500 hover:text-red-400 transition-colors">Clear All</button>
                </div>
                <div className="space-y-3">
                  {history.length === 0 ? (
                    <div className="p-12 bg-white/5 border border-white/10 border-dashed rounded-2xl text-center text-slate-500">
                      No history found.
                    </div>
                  ) : (
                    history.map(item => (
                      <div key={item.id} className="p-4 bg-white/5 border border-white/10 rounded-2xl flex items-center justify-between group hover:bg-white/[0.07] transition-all">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 bg-purple-500/10 rounded-xl flex items-center justify-center">
                            <Clock className="w-5 h-5 text-purple-400" />
                          </div>
                          <div className="max-w-[200px]">
                            <h3 className="font-medium text-slate-200 truncate">{item.prompt}</h3>
                            <p className="text-xs text-slate-500">{item.voice} • {new Date(item.timestamp).toLocaleTimeString()}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={() => new Audio(item.audioUrl).play()} className="p-2 bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 rounded-lg transition-all">
                            <Play className="w-4 h-4" />
                          </button>
                          <a href={item.audioUrl} download={`voice_${item.id}.wav`} className="p-2 text-slate-500 hover:text-white transition-all">
                            <Download className="w-4 h-4" />
                          </a>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Mobile Bottom Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-[60] bg-[#0a0a0f]/90 backdrop-blur-2xl border-t border-white/5 px-6 py-3">
        <div className="flex items-center justify-around">
          <button 
            onClick={() => setActiveTab('editor')}
            className={cn(
              "flex flex-col items-center gap-1 transition-all duration-200",
              activeTab === 'editor' ? "text-indigo-400" : "text-slate-500"
            )}
          >
            <Mic2 className="w-6 h-6" />
            <span className="text-[10px] font-bold uppercase tracking-widest">Editor</span>
          </button>
          <button 
            onClick={() => setActiveTab('library')}
            className={cn(
              "flex flex-col items-center gap-1 transition-all duration-200",
              activeTab === 'library' ? "text-indigo-400" : "text-slate-500"
            )}
          >
            <Library className="w-6 h-6" />
            <span className="text-[10px] font-bold uppercase tracking-widest">Library</span>
          </button>
        </div>
      </nav>

      {/* Voice Gallery Modal */}
      <AnimatePresence>
        {isVoiceGalleryOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsVoiceGalleryOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-4xl bg-[#1a1a24] border border-white/10 rounded-3xl overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-white/5 flex items-center justify-between bg-gradient-to-r from-indigo-500/10 to-purple-500/10">
                <div>
                  <h3 className="text-xl font-bold">Voice Gallery</h3>
                  <p className="text-xs text-slate-500 mt-1">Select a voice for your project</p>
                </div>
                <button onClick={() => setIsVoiceGalleryOpen(false)} className="p-2 text-slate-500 hover:text-white transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>
              <div className="p-6 max-h-[60vh] overflow-y-auto custom-scrollbar">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {VOICES.map(voice => (
                    <div 
                      key={voice.id}
                      className={cn(
                        "p-4 rounded-2xl border transition-all flex items-center justify-between group",
                        selectedVoice === voice.id 
                          ? "bg-indigo-500/10 border-indigo-500/50" 
                          : "bg-white/5 border-white/10 hover:border-white/20"
                      )}
                    >
                      <div className="flex items-center gap-4">
                        <div className={cn(
                          "w-12 h-12 rounded-xl flex items-center justify-center text-xl",
                          selectedVoice === voice.id ? "bg-indigo-500 text-white" : "bg-white/5 text-slate-400"
                        )}>
                          {voice.name[0]}
                        </div>
                        <div>
                          <h4 className="font-bold text-slate-200">{voice.name}</h4>
                          <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">{voice.gender} • {voice.accent}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handlePlaySample(voice.id)}
                          disabled={isPlayingSample !== null}
                          className="p-2 bg-white/5 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white transition-all"
                        >
                          {isPlayingSample === voice.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Volume2 className="w-4 h-4" />}
                        </button>
                        <button
                          onClick={() => {
                            setSelectedVoice(voice.id);
                            setIsVoiceGalleryOpen(false);
                          }}
                          className={cn(
                            "px-4 py-2 rounded-lg text-xs font-bold transition-all",
                            selectedVoice === voice.id 
                              ? "bg-indigo-500 text-white" 
                              : "bg-white/10 text-slate-300 hover:bg-white/20"
                          )}
                        >
                          {selectedVoice === voice.id ? "Selected" : "Select"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="p-6 bg-white/5 border-t border-white/5 flex justify-end">
                <button 
                  onClick={() => setIsVoiceGalleryOpen(false)}
                  className="px-6 py-2 bg-white/10 hover:bg-white/20 rounded-xl text-sm font-bold transition-all"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modals & Overlays */}
      <AnimatePresence>
        {isClearConfirmOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsClearConfirmOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-[#1a1a24] border border-white/10 rounded-3xl overflow-hidden shadow-2xl p-6 text-center"
            >
              <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <Trash2 className="w-8 h-8 text-red-500" />
              </div>
              <h3 className="text-xl font-bold mb-2">Clear Editor?</h3>
              <p className="text-slate-400 mb-6 text-sm">This will remove all script segments and reset the editor. This action cannot be undone.</p>
              <div className="flex gap-3">
                <button 
                  onClick={() => setIsClearConfirmOpen(false)}
                  className="flex-1 py-3 bg-white/5 hover:bg-white/10 rounded-xl font-bold transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={clearEditor}
                  className="flex-1 py-3 bg-red-500 hover:bg-red-400 text-white rounded-xl font-bold shadow-lg shadow-red-500/20 transition-all"
                >
                  Clear All
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {isSaveDraftOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSaveDraftOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-[#1a1a24] border border-white/10 rounded-3xl overflow-hidden shadow-2xl p-6"
            >
              <h3 className="text-xl font-bold mb-4">Save Draft</h3>
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1 block">Draft Name</label>
                  <input 
                    type="text"
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-slate-200 focus:ring-2 focus:ring-indigo-500/50 outline-none"
                    autoFocus
                  />
                </div>
                <div className="flex gap-3 pt-2">
                  <button 
                    onClick={() => setIsSaveDraftOpen(false)}
                    className="flex-1 py-3 bg-white/5 hover:bg-white/10 rounded-xl font-bold transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={saveDraft}
                    disabled={!draftName.trim()}
                    className="flex-1 py-3 bg-indigo-500 hover:bg-indigo-400 text-white rounded-xl font-bold shadow-lg shadow-indigo-500/20 transition-all disabled:opacity-50"
                  >
                    Save Draft
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {isPasteModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsPasteModalOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-2xl bg-[#1a1a24] border border-white/10 rounded-3xl overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-white/5 flex items-center justify-between">
                <h3 className="text-xl font-bold">Paste Your Script</h3>
                <button onClick={() => setIsPasteModalOpen(false)} className="p-2 text-slate-500 hover:text-white transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <textarea 
                  value={pastedText}
                  onChange={(e) => setPastedText(e.target.value)}
                  placeholder="Paste your long script here. AI will automatically split it into segments..."
                  className="w-full h-64 bg-white/5 border border-white/10 rounded-2xl p-4 text-slate-200 focus:ring-2 focus:ring-indigo-500/50 outline-none resize-none"
                />
                <div className="flex gap-3">
                  <button 
                    onClick={() => setIsPasteModalOpen(false)}
                    className="flex-1 py-3 bg-white/5 hover:bg-white/10 rounded-xl font-bold transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handlePasteSubmit}
                    disabled={!pastedText.trim() || isAnalyzing}
                    className="flex-1 py-3 bg-indigo-500 hover:bg-indigo-400 text-white rounded-xl font-bold shadow-lg shadow-indigo-500/20 transition-all disabled:opacity-50"
                  >
                    {isAnalyzing ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : "Analyze & Import"}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Error Toast */}
      <AnimatePresence>
        {error && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-36 md:bottom-28 left-1/2 -translate-x-1/2 z-[110] w-[calc(100%-2rem)] max-w-md"
          >
            <div className="bg-red-500/10 border border-red-500/20 backdrop-blur-xl p-4 rounded-2xl flex items-center gap-3 text-red-400 shadow-xl">
              <div className="w-8 h-8 bg-red-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
                <X className="w-5 h-5" />
              </div>
              <p className="text-sm font-medium flex-1">{error}</p>
              <button onClick={() => setError(null)} className="p-1 hover:bg-white/10 rounded-md transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

