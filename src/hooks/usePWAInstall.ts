import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
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
  const [isInstalled, setIsInstalled] = useState<boolean>(() => checkIsRunningStandalone());
  const [isIOS, setIsIOS] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);

  useEffect(() => {
    // Clear legacy false-positive flag so uninstalls / other devices always show install prompt accurately
    try {
      localStorage.removeItem('kolot_pwa_installed');
    } catch {}

    const checkStandalone = () => {
      const standalone = checkIsRunningStandalone();
      setIsStandaloneMode(standalone);
      if (standalone) {
        setIsInstalled(true);
      }
    };

    checkStandalone();

    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIOSDevice = /iphone|ipad|ipod/.test(userAgent) && !(window as any).MSStream;
    const isAndroidDevice = /android/.test(userAgent);
    setIsIOS(isIOSDevice);
    setIsAndroid(isAndroidDevice);

    // Query browser Related Installed Apps API (Chrome/Edge on Android & Desktop)
    // Only marks installed when the OS actually confirms an installed matching app.
    try {
      const navAny = window.navigator as unknown as {
        getInstalledRelatedApps?: () => Promise<Array<{ platform?: string; url?: string }>>;
      };
      if (typeof navAny.getInstalledRelatedApps === 'function') {
        navAny
          .getInstalledRelatedApps()
          .then((apps) => {
            if (Array.isArray(apps) && apps.length > 0) {
              setIsInstalled(true);
            } else if (!checkIsRunningStandalone()) {
              setIsInstalled(false);
            }
          })
          .catch(() => {});
      }
    } catch {}

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setIsInstalled(false);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    const matchMediaDisplay = window.matchMedia('(display-mode: standalone)');
    try {
      matchMediaDisplay.addEventListener('change', checkStandalone);
    } catch {
      matchMediaDisplay.addListener(checkStandalone);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
      try {
        matchMediaDisplay.removeEventListener('change', checkStandalone);
      } catch {
        matchMediaDisplay.removeListener(checkStandalone);
      }
    };
  }, []);

  const install = async (): Promise<boolean> => {
    if (!deferredPrompt) return false;
    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setIsInstalled(true);
        setDeferredPrompt(null);
        return true;
      }
    } catch (err) {
      console.warn('Install prompt error:', err);
    }
    return false;
  };

  return {
    isInstallable: !!deferredPrompt,
    isInstalled,
    isStandaloneMode,
    isIOS,
    isAndroid,
    install,
    promptAvailable: !!deferredPrompt,
  };
}
