export interface AccessibilitySettings {
  fontScale: 100 | 115 | 130 | 145;
  highContrast: boolean;
  grayscale: boolean;
  highlightLinks: boolean;
  strongFocus: boolean;
  readableFont: boolean;
  extraSpacing: boolean;
  stopAnimations: boolean;
  largeCursor: boolean;
  readingGuide: boolean;
  allowTextSelection: boolean;
  touchTargets: boolean;
}

export interface PointerCapabilities {
  hasFinePointer: boolean;
  hasCoarsePointer: boolean;
}

export const DEFAULT_ACCESSIBILITY_SETTINGS: AccessibilitySettings = {
  fontScale: 100,
  highContrast: false,
  grayscale: false,
  highlightLinks: false,
  strongFocus: false,
  readableFont: false,
  extraSpacing: false,
  stopAnimations: false,
  largeCursor: false,
  readingGuide: false,
  allowTextSelection: false,
  touchTargets: false,
};

const STORAGE_KEY = 'kolot_accessibility_settings_v1';

function isMobileOrTouchUserAgent(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(
    navigator.userAgent || ''
  );
}

export function detectPointerCapabilities(): PointerCapabilities {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return { hasFinePointer: !isMobileOrTouchUserAgent(), hasCoarsePointer: isMobileOrTouchUserAgent() };
  }
  const mobileUa = isMobileOrTouchUserAgent();
  const primaryFine = window.matchMedia('(pointer: fine)').matches;
  const primaryCoarse = window.matchMedia('(pointer: coarse)').matches;
  const canHover = window.matchMedia('(hover: hover)').matches;
  const anyCoarse = window.matchMedia('(any-pointer: coarse)').matches;

  // Mobile phones (including Samsung Galaxy with S-Pen reporting any-pointer: fine) must NOT receive mouse/desktop-keyboard UI tools
  const hasFinePointer = !mobileUa && (primaryFine || (canHover && !primaryCoarse));
  const hasCoarsePointer = mobileUa || primaryCoarse || anyCoarse || !hasFinePointer;

  return {
    hasFinePointer,
    hasCoarsePointer,
  };
}

export function subscribePointerCapabilities(cb: (caps: PointerCapabilities) => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }
  const fineMq = window.matchMedia('(pointer: fine)');
  const coarseMq = window.matchMedia('(pointer: coarse)');
  const anyCoarseMq = window.matchMedia('(any-pointer: coarse)');
  const hoverMq = window.matchMedia('(hover: hover)');
  const sync = () => {
    cb(detectPointerCapabilities());
  };
  sync();
  const add = (mq: MediaQueryList) => {
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', sync);
    else mq.addListener(sync);
  };
  const remove = (mq: MediaQueryList) => {
    if (typeof mq.removeEventListener === 'function') mq.removeEventListener('change', sync);
    else mq.removeListener(sync);
  };
  add(fineMq);
  add(coarseMq);
  add(anyCoarseMq);
  add(hoverMq);
  return () => {
    remove(fineMq);
    remove(coarseMq);
    remove(anyCoarseMq);
    remove(hoverMq);
  };
}

export function loadAccessibilitySettings(): AccessibilitySettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_ACCESSIBILITY_SETTINGS };
    const parsed = JSON.parse(raw);
    const validScale = [100, 115, 130, 145].includes(Number(parsed.fontScale))
      ? (Number(parsed.fontScale) as 100 | 115 | 130 | 145)
      : 100;
    return {
      ...DEFAULT_ACCESSIBILITY_SETTINGS,
      fontScale: validScale,
      highContrast: Boolean(parsed.highContrast),
      grayscale: Boolean(parsed.grayscale),
      highlightLinks: Boolean(parsed.highlightLinks),
      strongFocus: Boolean(parsed.strongFocus),
      readableFont: Boolean(parsed.readableFont),
      extraSpacing: Boolean(parsed.extraSpacing),
      stopAnimations: Boolean(parsed.stopAnimations),
      largeCursor: Boolean(parsed.largeCursor),
      readingGuide: Boolean(parsed.readingGuide),
      allowTextSelection: Boolean(parsed.allowTextSelection),
      touchTargets: Boolean(parsed.touchTargets),
    };
  } catch {
    return { ...DEFAULT_ACCESSIBILITY_SETTINGS };
  }
}

export function saveAccessibilitySettings(settings: AccessibilitySettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {}
}

export function applyAccessibilitySettingsToDom(settings: AccessibilitySettings): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const caps = detectPointerCapabilities();

  root.style.fontSize = `${settings.fontScale}%`;

  const classMap: Array<[string, boolean]> = [
    ['kolot-a11y-contrast', settings.highContrast],
    ['kolot-a11y-links', settings.highlightLinks],
    ['kolot-a11y-focus', settings.strongFocus && caps.hasFinePointer],
    ['kolot-a11y-readable', settings.readableFont],
    ['kolot-a11y-spacing', settings.extraSpacing],
    ['kolot-a11y-no-motion', settings.stopAnimations],
    ['kolot-a11y-cursor', settings.largeCursor && caps.hasFinePointer],
    ['kolot-allow-select', settings.allowTextSelection],
    ['kolot-a11y-touch', settings.touchTargets && caps.hasCoarsePointer],
  ];

  for (const [cls, active] of classMap) {
    root.classList.toggle(cls, active);
  }
}

export function countActiveAccessibilityFeatures(
  settings: AccessibilitySettings,
  caps: PointerCapabilities = detectPointerCapabilities()
): number {
  let count = 0;
  if (settings.fontScale !== 100) count++;
  if (settings.highContrast) count++;
  if (settings.grayscale) count++;
  if (settings.highlightLinks) count++;
  if (settings.strongFocus && caps.hasFinePointer) count++;
  if (settings.readableFont) count++;
  if (settings.extraSpacing) count++;
  if (settings.stopAnimations) count++;
  if (settings.largeCursor && caps.hasFinePointer) count++;
  if (settings.readingGuide && caps.hasFinePointer) count++;
  if (settings.allowTextSelection) count++;
  if (settings.touchTargets && caps.hasCoarsePointer) count++;
  return count;
}
