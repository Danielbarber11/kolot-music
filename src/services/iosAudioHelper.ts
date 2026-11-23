// iOS / iPhone Safari WebKit audio session & hardware unlock helper

let unlockedAudioCtx: AudioContext | null = null;
let didUnlockHardware = false;

export function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const platform = navigator.platform || '';
  const maxTouch = typeof navigator.maxTouchPoints === 'number' ? navigator.maxTouchPoints : 0;
  return /iPhone|iPad|iPod/i.test(ua) || (platform === 'MacIntel' && maxTouch > 1);
}

/**
 * Must be called synchronously inside a user tap/click handler on iPhone/iPad:
 * 1. Sets iOS 16.4+/17+/18+ AudioSession to 'playback' so audio plays through hardware speakers
 *    even when the iPhone side Silent/Mute switch is enabled.
 * 2. Plays a silent 1-sample buffer on an AudioContext once to unlock iOS CoreAudio routing
 *    without attaching createMediaElementSource to the <audio> element.
 */
export function activateIosPlaybackSession(): void {
  try {
    const navAny = typeof navigator !== 'undefined' ? (navigator as any) : null;
    if (navAny?.audioSession && navAny.audioSession.type !== 'playback') {
      navAny.audioSession.type = 'playback';
    }
  } catch {
    // Non-iOS or older iOS versions do not expose navigator.audioSession
  }

  try {
    if (typeof window === 'undefined') return;
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;

    if (!unlockedAudioCtx) {
      unlockedAudioCtx = new AudioCtx();
    }
    if (unlockedAudioCtx.state === 'suspended') {
      void unlockedAudioCtx.resume().catch(() => {});
    }
    if (!didUnlockHardware) {
      const buffer = unlockedAudioCtx.createBuffer(1, 1, 22050);
      const source = unlockedAudioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(unlockedAudioCtx.destination);
      source.start(0);
      didUnlockHardware = true;
    }
  } catch {
    // Ignore WebAudio unlock errors
  }
}
