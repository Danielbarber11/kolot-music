// Text-to-Speech & Voiceover Service
// Uses Web Speech API for zero-latency, high-quality multilingual narration directly in the browser
// Fallback supported for all modern browsers

export interface TTSState {
  isPlaying: boolean;
  isPaused: boolean;
  currentText: string;
  rate: number;
}

type TTSListener = (state: TTSState) => void;

class TTSService {
  private synth: SpeechSynthesis | null = null;
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private listeners: Set<TTSListener> = new Set();
  private state: TTSState = {
    isPlaying: false,
    isPaused: false,
    currentText: '',
    rate: 1.0,
  };

  constructor() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.synth = window.speechSynthesis;
    }
  }

  public isSupported(): boolean {
    return !!this.synth;
  }

  public subscribe(listener: TTSListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach((listener) => listener({ ...this.state }));
  }

  /**
   * Cleans text from markdown syntax, links, and code blocks before speaking
   */
  public cleanTextForSpeech(text: string): string {
    return text
      .replace(/```[\s\S]*?```/g, ' קטע קוד. ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[*_~#>]/g, '')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Speak arbitrary text
   */
  public speak(
    rawText: string,
    options?: {
      lang?: string;
      rate?: number;
      pitch?: number;
      onEnd?: () => void;
      onError?: () => void;
    }
  ) {
    if (!this.synth) {
      console.warn('Web Speech API is not supported in this environment');
      options?.onError?.();
      return;
    }

    // Cancel ongoing speech
    this.stop();

    const clean = this.cleanTextForSpeech(rawText);
    if (!clean) return;

    const utterance = new SpeechSynthesisUtterance(clean);
    this.currentUtterance = utterance;

    // Detect language or fallback
    const hasHebrew = /[\u0590-\u05FF]/.test(clean);
    utterance.lang = options?.lang || (hasHebrew ? 'he-IL' : 'en-US');
    utterance.rate = options?.rate ?? this.state.rate ?? 1.0;
    utterance.pitch = options?.pitch ?? 1.0;

    // Attempt to pick best matching voice
    const voices = this.synth.getVoices();
    if (voices.length > 0) {
      const preferred = voices.find((v) => v.lang.startsWith(utterance.lang.slice(0, 2)));
      if (preferred) {
        utterance.voice = preferred;
      }
    }

    utterance.onstart = () => {
      this.state.isPlaying = true;
      this.state.isPaused = false;
      this.state.currentText = clean;
      this.notify();
    };

    utterance.onend = () => {
      this.state.isPlaying = false;
      this.state.isPaused = false;
      this.state.currentText = '';
      this.notify();
      options?.onEnd?.();
    };

    utterance.onerror = (e) => {
      console.error('Speech synthesis error:', e);
      this.state.isPlaying = false;
      this.state.isPaused = false;
      this.notify();
      options?.onError?.();
    };

    this.synth.speak(utterance);
  }

  public pause() {
    if (this.synth && this.state.isPlaying && !this.state.isPaused) {
      this.synth.pause();
      this.state.isPaused = true;
      this.notify();
    }
  }

  public resume() {
    if (this.synth && this.state.isPaused) {
      this.synth.resume();
      this.state.isPaused = false;
      this.notify();
    }
  }

  public stop() {
    if (this.synth) {
      this.synth.cancel();
      this.state.isPlaying = false;
      this.state.isPaused = false;
      this.state.currentText = '';
      this.notify();
    }
  }

  public setRate(rate: number) {
    this.state.rate = rate;
    this.notify();
    if (this.state.isPlaying && this.state.currentText) {
      const text = this.state.currentText;
      this.speak(text, { rate });
    }
  }

  public getState(): TTSState {
    return { ...this.state };
  }
}

export const ttsService = new TTSService();
