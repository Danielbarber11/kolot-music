import { uploadBinaryFastToR2, getStreamingMediaUrl } from './cloudStorageService';

/**
 * Generates a full-song Stereo Karaoke (vocal-removed) WAV Blob from any File, Blob, or audio URL.
 *
 * Uses phase-cancelled Mid/Side isolation paired with a warm bass-preservation crossover (<165 Hz)
 * and high-frequency sheen filter so drums, bassline, harmonies, and wide stereo instruments stay
 * full-bodied while the center-panned lead vocal is stripped cleanly across 100% of the track.
 */
export async function generateFullSongKaraokeAudio(options: {
  audioFile?: File | Blob | null;
  audioUrl?: string;
  onProgress?: (percent: number, stageText: string) => void;
  signal?: AbortSignal;
}): Promise<{ blob: Blob; duration: number; url?: string } | null> {
  const { audioFile, audioUrl, onProgress, signal } = options;
  if (!audioFile && !audioUrl) return null;
  if (signal?.aborted) return null;

  const AudioCtx =
    typeof window !== 'undefined'
      ? window.AudioContext || (window as any).webkitAudioContext
      : null;
  const OfflineCtx =
    typeof window !== 'undefined'
      ? window.OfflineAudioContext || (window as any).webkitOfflineAudioContext
      : null;

  if (!AudioCtx || !OfflineCtx) {
    throw new Error('דפדפן זה אינו תומך בעיבוד שמע לקריוקי');
  }

  onProgress?.(6, 'טוען את השיר לעיבוד קריוקי AI...');

  let arrayBuffer: ArrayBuffer;
  if (audioFile) {
    arrayBuffer = await audioFile.arrayBuffer();
  } else {
    const resolved = getStreamingMediaUrl(audioUrl);
    if (!resolved) return null;
    const res = await fetch(resolved, { signal });
    if (!res.ok) {
      throw new Error('לא ניתן לטעון את קובץ השמע לעיבוד קריוקי');
    }
    arrayBuffer = await res.arrayBuffer();
  }

  if (signal?.aborted) return null;
  onProgress?.(18, 'מפענח ערוצי שמע מלאים...');

  const tempCtx = new AudioCtx();
  let decodedBuffer: AudioBuffer;
  try {
    decodedBuffer = await tempCtx.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    try {
      await tempCtx.close();
    } catch {}
  }

  if (signal?.aborted) return null;
  const trackDuration = Math.max(1, decodedBuffer.duration || 0);
  const targetSampleRate = 22050;
  const targetLength = Math.max(1, Math.ceil(trackDuration * targetSampleRate));

  onProgress?.(36, 'מבודד ומסיר את שירת הזמר מכל השיר...');

  const offline = new OfflineCtx(2, targetLength, targetSampleRate);
  const src = offline.createBufferSource();
  src.buffer = decodedBuffer;

  const isStereo = decodedBuffer.numberOfChannels >= 2;

  if (isStereo) {
    // Detect whether L & R channels actually differ (true stereo vs dual-mono)
    const chL = decodedBuffer.getChannelData(0);
    const chR = decodedBuffer.getChannelData(1);
    const sampleStep = Math.max(1, Math.floor(chL.length / 4000));
    let diffEnergy = 0;
    let totalEnergy = 0;
    for (let i = 0; i < chL.length; i += sampleStep) {
      const l = chL[i];
      const r = chR[i];
      diffEnergy += Math.abs(l - r);
      totalEnergy += Math.abs(l) + Math.abs(r);
    }
    const stereoSeparationRatio = totalEnergy > 0.001 ? diffEnergy / totalEnergy : 0;

    if (stereoSeparationRatio > 0.025) {
      // Path A: Low-frequency Bass & Kick preservation (< 165 Hz mono sum)
      const bassLowPass = offline.createBiquadFilter();
      bassLowPass.type = 'lowpass';
      bassLowPass.frequency.value = 165;
      bassLowPass.Q.value = 0.707;
      const bassGain = offline.createGain();
      bassGain.gain.value = 0.88;

      src.connect(bassLowPass);
      bassLowPass.connect(bassGain);

      // Path B: Center-vocal cancellation (Side extraction L - R & R - L with high-pass > 155 Hz)
      const splitter = offline.createChannelSplitter(2);
      const merger = offline.createChannelMerger(2);

      // Left Output = L - 0.96 * R
      const invRForL = offline.createGain();
      invRForL.gain.value = -0.96;
      const sumL = offline.createGain();
      sumL.gain.value = 1.0;

      // Right Output = R - 0.96 * L
      const invLForR = offline.createGain();
      invLForR.gain.value = -0.96;
      const sumR = offline.createGain();
      sumR.gain.value = 1.0;

      src.connect(splitter);

      splitter.connect(sumL, 0);
      splitter.connect(invRForL, 1);
      invRForL.connect(sumL);

      splitter.connect(sumR, 1);
      splitter.connect(invLForR, 0);
      invLForR.connect(sumR);

      // Subtle formant attenuation if slight center vocal bleed remains (~1.1kHz-2.4kHz)
      const vocalFormantDipL = offline.createBiquadFilter();
      vocalFormantDipL.type = 'peaking';
      vocalFormantDipL.frequency.value = 1450;
      vocalFormantDipL.Q.value = 1.1;
      vocalFormantDipL.gain.value = -3.5;

      const vocalFormantDipR = offline.createBiquadFilter();
      vocalFormantDipR.type = 'peaking';
      vocalFormantDipR.frequency.value = 1450;
      vocalFormantDipR.Q.value = 1.1;
      vocalFormantDipR.gain.value = -3.5;

      const sideHpL = offline.createBiquadFilter();
      sideHpL.type = 'highpass';
      sideHpL.frequency.value = 155;
      sideHpL.Q.value = 0.707;

      const sideHpR = offline.createBiquadFilter();
      sideHpR.type = 'highpass';
      sideHpR.frequency.value = 155;
      sideHpR.Q.value = 0.707;

      sumL.connect(sideHpL);
      sideHpL.connect(vocalFormantDipL);
      vocalFormantDipL.connect(merger, 0, 0);

      sumR.connect(sideHpR);
      sideHpR.connect(vocalFormantDipR);
      vocalFormantDipR.connect(merger, 0, 1);

      const masterGain = offline.createGain();
      masterGain.gain.value = 1.15;

      const compressor = offline.createDynamicsCompressor();
      compressor.threshold.value = -10;
      compressor.knee.value = 12;
      compressor.ratio.value = 4;
      compressor.attack.value = 0.005;
      compressor.release.value = 0.12;

      merger.connect(masterGain);
      bassGain.connect(masterGain);
      masterGain.connect(compressor);
      compressor.connect(offline.destination);
    } else {
      // Dual-mono fallback: carve primary human vocal bands while retaining bass & highs
      buildMonoKaraokeChain(offline, src);
    }
  } else {
    buildMonoKaraokeChain(offline, src);
  }

  src.start(0);
  const renderedBuffer = await offline.startRendering();
  if (signal?.aborted) return null;

  onProgress?.(68, 'מקודד פסקול קריוקי איכותי (100% מהשיר)...');
  const wavBlob = encodeStereoWavBlob(renderedBuffer);
  onProgress?.(78, 'פסקול הקריוקי המלא מוכן!');

  return {
    blob: wavBlob,
    duration: trackDuration,
  };
}

function buildMonoKaraokeChain(offline: OfflineAudioContext, src: AudioBufferSourceNode) {
  const bassLp = offline.createBiquadFilter();
  bassLp.type = 'lowpass';
  bassLp.frequency.value = 190;

  const notch1 = offline.createBiquadFilter();
  notch1.type = 'peaking';
  notch1.frequency.value = 650;
  notch1.Q.value = 1.4;
  notch1.gain.value = -16;

  const notch2 = offline.createBiquadFilter();
  notch2.type = 'peaking';
  notch2.frequency.value = 1550;
  notch2.Q.value = 1.1;
  notch2.gain.value = -22;

  const notch3 = offline.createBiquadFilter();
  notch3.type = 'peaking';
  notch3.frequency.value = 2850;
  notch3.Q.value = 1.3;
  notch3.gain.value = -18;

  const highShelf = offline.createBiquadFilter();
  highShelf.type = 'highshelf';
  highShelf.frequency.value = 6500;
  highShelf.gain.value = 2.5;

  const compressor = offline.createDynamicsCompressor();
  compressor.threshold.value = -8;
  compressor.ratio.value = 4;

  src.connect(bassLp);
  bassLp.connect(compressor);

  src.connect(notch1);
  notch1.connect(notch2);
  notch2.connect(notch3);
  notch3.connect(highShelf);
  highShelf.connect(compressor);

  compressor.connect(offline.destination);
}

/**
 * Normalizes peak slightly and encodes AudioBuffer into standard 16-bit PCM WAV.
 */
function encodeStereoWavBlob(buffer: AudioBuffer): Blob {
  const numChannels = Math.min(2, buffer.numberOfChannels);
  const sampleRate = buffer.sampleRate;
  const numFrames = buffer.length;
  const ch0 = buffer.getChannelData(0);
  const ch1 = numChannels > 1 ? buffer.getChannelData(1) : ch0;

  // Peak scan for clean normalization without clipping
  let maxPeak = 0.01;
  const step = Math.max(1, Math.floor(numFrames / 48000));
  for (let i = 0; i < numFrames; i += step) {
    const a = Math.abs(ch0[i]);
    const b = Math.abs(ch1[i]);
    if (a > maxPeak) maxPeak = a;
    if (b > maxPeak) maxPeak = b;
  }
  const normGain = maxPeak > 0.92 ? 0.92 / maxPeak : Math.min(1.6, 0.88 / maxPeak);

  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numFrames * blockAlign;
  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    const l = Math.max(-1, Math.min(1, ch0[i] * normGain));
    view.setInt16(offset, l < 0 ? l * 0x8000 : l * 0x7fff, true);
    offset += 2;
    if (numChannels > 1) {
      const r = Math.max(-1, Math.min(1, ch1[i] * normGain));
      view.setInt16(offset, r < 0 ? r * 0x8000 : r * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

/**
 * Generates & uploads full-song Karaoke WAV directly to Cloudflare R2 under audio/${trackId}_karaoke.wav
 */
export async function generateAndUploadKaraokeToR2(options: {
  trackId: string;
  audioFile?: File | Blob | null;
  audioUrl?: string;
  onProgress?: (percent: number, stageText: string) => void;
  signal?: AbortSignal;
}): Promise<{ success: boolean; karaokeAudioUrl?: string; error?: string }> {
  try {
    const cleanId = (options.trackId || '').replace(/[^a-zA-Z0-9_\-]/g, '');
    if (!cleanId) return { success: false, error: 'Missing trackId' };

    const generated = await generateFullSongKaraokeAudio({
      audioFile: options.audioFile,
      audioUrl: options.audioUrl,
      onProgress: options.onProgress,
      signal: options.signal,
    });

    if (!generated?.blob) {
      return { success: false, error: 'לא נוצר קובץ קריוקי' };
    }

    options.onProgress?.(82, 'שומר פסקול קריוקי מלא בענן...');
    const uploadRes = await uploadBinaryFastToR2(
      generated.blob,
      `audio/${cleanId}_karaoke.wav`,
      'audio/wav',
      (pct) => {
        const scaled = Math.min(99, 82 + Math.round(pct * 0.17));
        options.onProgress?.(scaled, `מעלה קריוקי מלא לענן... ${pct}%`);
      }
    );

    if (!uploadRes.success || !uploadRes.url) {
      return { success: false, error: uploadRes.error || 'העלאת הקריוקי לענן נכשלה' };
    }

    options.onProgress?.(100, 'פסקול הקריוקי נשמר בענן!');
    return { success: true, karaokeAudioUrl: uploadRes.url };
  } catch (err: any) {
    return { success: false, error: err?.message || 'שגיאה ביצירת פסקול קריוקי' };
  }
}

/**
 * Live Web Audio real-time vocal-cancellation graph for legacy songs that don't yet have
 * a pre-generated karaokeAudioUrl saved in R2.
 */
export interface LiveKaraokeController {
  setEnabled: (enabled: boolean) => void;
  destroy: () => void;
}

export function createLiveKaraokeController(audioEl: HTMLAudioElement): LiveKaraokeController | null {
  try {
    const AudioCtx =
      typeof window !== 'undefined'
        ? window.AudioContext || (window as any).webkitAudioContext
        : null;
    if (!AudioCtx || !audioEl) return null;

    const ctx = new AudioCtx();
    const source = ctx.createMediaElementSource(audioEl);

    // Dry (original) path
    const dryGain = ctx.createGain();
    dryGain.gain.value = 1;

    // Wet (karaoke vocal-removed) path
    const wetGain = ctx.createGain();
    wetGain.gain.value = 0;

    const bassLp = ctx.createBiquadFilter();
    bassLp.type = 'lowpass';
    bassLp.frequency.value = 165;
    const bassGain = ctx.createGain();
    bassGain.gain.value = 0.88;

    const splitter = ctx.createChannelSplitter(2);
    const merger = ctx.createChannelMerger(2);

    const invRForL = ctx.createGain();
    invRForL.gain.value = -0.96;
    const sumL = ctx.createGain();

    const invLForR = ctx.createGain();
    invLForR.gain.value = -0.96;
    const sumR = ctx.createGain();

    const sideHpL = ctx.createBiquadFilter();
    sideHpL.type = 'highpass';
    sideHpL.frequency.value = 155;

    const sideHpR = ctx.createBiquadFilter();
    sideHpR.type = 'highpass';
    sideHpR.frequency.value = 155;

    const karaokeBoost = ctx.createGain();
    karaokeBoost.gain.value = 1.2;

    // Wire Dry
    source.connect(dryGain);
    dryGain.connect(ctx.destination);

    // Wire Wet
    source.connect(bassLp);
    bassLp.connect(bassGain);
    bassGain.connect(wetGain);

    source.connect(splitter);
    splitter.connect(sumL, 0);
    splitter.connect(invRForL, 1);
    invRForL.connect(sumL);

    splitter.connect(sumR, 1);
    splitter.connect(invLForR, 0);
    invLForR.connect(sumR);

    sumL.connect(sideHpL);
    sideHpL.connect(merger, 0, 0);
    sumR.connect(sideHpR);
    sideHpR.connect(merger, 0, 1);

    merger.connect(karaokeBoost);
    karaokeBoost.connect(wetGain);
    wetGain.connect(ctx.destination);

    return {
      setEnabled(enabled: boolean) {
        if (ctx.state === 'suspended') {
          ctx.resume().catch(() => {});
        }
        const now = ctx.currentTime;
        dryGain.gain.setTargetAtTime(enabled ? 0 : 1, now, 0.04);
        wetGain.gain.setTargetAtTime(enabled ? 1 : 0, now, 0.04);
      },
      destroy() {
        try {
          dryGain.disconnect();
          wetGain.disconnect();
          source.disconnect();
          ctx.close().catch(() => {});
        } catch {}
      },
    };
  } catch {
    return null;
  }
}
