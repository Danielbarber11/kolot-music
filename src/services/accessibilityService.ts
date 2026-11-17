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
};

const STORAGE_KEY = 'kolot_accessibility_settings_v1';

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

  root.style.fontSize = `${settings.fontScale}%`;

  const classMap: Array<[string, boolean]> = [
    ['kolot-a11y-contrast', settings.highContrast],
    ['kolot-a11y-links', settings.highlightLinks],
    ['kolot-a11y-focus', settings.strongFocus],
    ['kolot-a11y-readable', settings.readableFont],
    ['kolot-a11y-spacing', settings.extraSpacing],
    ['kolot-a11y-no-motion', settings.stopAnimations],
    ['kolot-a11y-cursor', settings.largeCursor],
    ['kolot-allow-select', settings.allowTextSelection],
  ];

  for (const [cls, active] of classMap) {
    root.classList.toggle(cls, active);
  }
}

export function countActiveAccessibilityFeatures(settings: AccessibilitySettings): number {
  let count = 0;
  if (settings.fontScale !== 100) count++;
  if (settings.highContrast) count++;
  if (settings.grayscale) count++;
  if (settings.highlightLinks) count++;
  if (settings.strongFocus) count++;
  if (settings.readableFont) count++;
  if (settings.extraSpacing) count++;
  if (settings.stopAnimations) count++;
  if (settings.largeCursor) count++;
  if (settings.readingGuide) count++;
  if (settings.allowTextSelection) count++;
  return count;
}
