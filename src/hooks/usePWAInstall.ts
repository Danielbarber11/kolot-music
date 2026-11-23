import { useEffect, useState, useCallback } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const PWA_INSTALLED_STORAGE_KEY = 'kolot_pwa_installed_at';

function readPersistedInstallFlag(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    const raw = localStorage.getItem(PWA_INSTALLED_STORAGE_KEY);
    return Boolean(raw && raw.trim().length > 0);
  } catch {
    return false;
  }
}

function writePersistedInstallFlag(installed: boolean): void {
  try {
    if (typeof window === 'undefined') return;
    if (installed) {
      localStorage.setItem(PWA_INSTALLED_STORAGE_KEY, String(Date.now()));
    } else {
      localStorage.removeItem(PWA_INSTALLED_STORAGE_KEY);
    }
  } catch {}
}

function checkIsRunningStandalone(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: minimal-ui)').matches ||
      window.matchMedia('(display-mode: window-controls-overlay)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
      document.referrer.includes('android-app://')
    );
  } catch {
    return false;
  }
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandaloneMode, setIsStandaloneMode] = useState<boolean>(() => checkIsRunningStandalone());
  const [isInstalled, setIsInstalled] = useState<boolean>(
    () => checkIsRunningStandalone() || readPersistedInstallFlag()
  );
  const [isIOS, setIsIOS] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);

  const verifyInstalledStatus = useCallback(async (promptEventAvailable: boolean) => {
    const standalone = checkIsRunningStandalone();
    setIsStandaloneMode(standalone);
    if (standalone) {
      writePersistedInstallFlag(true);
      setIsInstalled(true);
      return;
    }

    // Check browser's Related Installed Apps API (Chrome / Edge / Android WebAPK)
    try {
      const navAny = window.navigator as unknown as {
        getInstalledRelatedApps?: () => Promise<Array<{ platform?: string; url?: string; id?: string }>>;
      };
      if (typeof navAny.getInstalledRelatedApps === 'function') {
        const apps = await navAny.getInstalledRelatedApps();
        if (Array.isArray(apps) && apps.length > 0) {
          writePersistedInstallFlag(true);
          setIsInstalled(true);
          return;
        }
      }
    } catch {}

    // If Chrome/Edge explicitly fired beforeinstallprompt, the app is NOT installed on this device.
    if (promptEventAvailable) {
      writePersistedInstallFlag(false);
      setIsInstalled(false);
      return;
    }

    // Otherwise trust persisted browser-side install confirmation (set by appinstalled / prior standalone run)
    if (readPersistedInstallFlag()) {
      setIsInstalled(true);
    }
  }, []);

  useEffect(() => {
    let promptSeen = false;

    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIOSDevice = /iphone|ipad|ipod/.test(userAgent) && !(window as any).MSStream;
    const isAndroidDevice = /android/.test(userAgent);
    setIsIOS(isIOSDevice);
    setIsAndroid(isAndroidDevice);

    void verifyInstalledStatus(false);
    // Re-check slightly later once service worker registration completes (improves getInstalledRelatedApps reliability on Android Chrome)
    const retryTimer = window.setTimeout(() => {
      void verifyInstalledStatus(promptSeen);
    }, 650);

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      promptSeen = true;
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      // Do NOT erase persisted flag unconditionally if getInstalledRelatedApps confirmed install, only clear when Chrome explicitly says installable
      void verifyInstalledStatus(true);
    };

    const handleAppInstalled = () => {
      promptSeen = false;
      writePersistedInstallFlag(true);
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    const handleFocusOrVisibility = () => {
      if (document.visibilityState === 'visible') {
        void verifyInstalledStatus(promptSeen);
      }
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    window.addEventListener('focus', handleFocusOrVisibility);
    document.addEventListener('visibilitychange', handleFocusOrVisibility);

    const matchMediaDisplay = window.matchMedia('(display-mode: standalone)');
    const handleDisplayChange = () => void verifyInstalledStatus(promptSeen);
    try {
      matchMediaDisplay.addEventListener('change', handleDisplayChange);
    } catch {
      matchMediaDisplay.addListener(handleDisplayChange);
    }

    return () => {
      window.clearTimeout(retryTimer);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
      window.removeEventListener('focus', handleFocusOrVisibility);
      document.removeEventListener('visibilitychange', handleFocusOrVisibility);
      try {
        matchMediaDisplay.removeEventListener('change', handleDisplayChange);
      } catch {
        matchMediaDisplay.removeListener(handleDisplayChange);
      }
    };
  }, [verifyInstalledStatus]);

  const install = async (): Promise<boolean> => {
    if (!deferredPrompt) return false;
    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        writePersistedInstallFlag(true);
        setIsInstalled(true);
        setDeferredPrompt(null);
        return true;
      }
    } catch (err) {
      console.warn('Install prompt error:', err);
    }
    return false;
  };

  const getAppLaunchUrl = (): string => {
    if (typeof window === 'undefined') return '/';
    return `${window.location.origin}/?kolot_app=1`;
  };

  return {
    isInstallable: !!deferredPrompt,
    isInstalled,
    isStandaloneMode,
    isIOS,
    isAndroid,
    install,
    getAppLaunchUrl,
    promptAvailable: !!deferredPrompt,
  };
}
