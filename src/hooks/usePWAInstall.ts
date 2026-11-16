import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandaloneMode, setIsStandaloneMode] = useState<boolean>(() => {
    try {
      if (typeof window === 'undefined') return false;
      return (
        window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
        document.referrer.includes('android-app://')
      );
    } catch {
      return false;
    }
  });
  const [isInstalled, setIsInstalled] = useState<boolean>(() => {
    try {
      if (typeof window === 'undefined') return false;
      return (
        window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
        document.referrer.includes('android-app://') ||
        localStorage.getItem('kolot_pwa_installed') === 'true'
      );
    } catch {
      return false;
    }
  });

  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const checkStandalone = () => {
      const standalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
        document.referrer.includes('android-app://');
      setIsStandaloneMode(standalone);
      if (standalone || localStorage.getItem('kolot_pwa_installed') === 'true') {
        setIsInstalled(true);
      }
    };

    checkStandalone();

    // Detect iOS devices
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIOSDevice = /iphone|ipad|ipod/.test(userAgent) && !(window as any).MSStream;
    setIsIOS(isIOSDevice);

    // Check Web App Related Apps API (Chrome/Edge report installed PWA even inside normal browser tabs!)
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
              try {
                localStorage.setItem('kolot_pwa_installed', 'true');
              } catch {}
            }
          })
          .catch(() => {});
      }
    } catch {}

    // Notice: when running top-level in Chrome/Edge with an active SW & manifest,
    // if the app is NOT installed, Chrome fires `beforeinstallprompt` right away.
    // If Chrome ALREADY shows "Open in App" ("פתח ביישום"), Chrome suppresses `beforeinstallprompt`.
    let promptReceived = false;
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      promptReceived = true;
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      // Chrome explicitly offering install proves it's NOT currently installed
      setIsInstalled(false);
      try {
        localStorage.removeItem('kolot_pwa_installed');
      } catch {}
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
      try {
        localStorage.setItem('kolot_pwa_installed', 'true');
      } catch {}
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    // Fallback check after 2500ms on Chromium desktop/Android top-level tabs:
    // If Chromium suppressed `beforeinstallprompt` while SW + manifest are active, the app is already installed!
    const isChromium = /chrome|chromium|edg\//.test(userAgent) && !isIOSDevice;
    const isTopWindow = (() => {
      try {
        return window.self === window.top;
      } catch {
        return false;
      }
    })();

    const suppressCheckTimer =
      isChromium && isTopWindow
        ? window.setTimeout(() => {
            if (!promptReceived && 'serviceWorker' in navigator) {
              navigator.serviceWorker
                .getRegistration()
                .then((reg) => {
                  if (reg) {
                    setIsInstalled(true);
                  }
                })
                .catch(() => {});
            }
          }, 2500)
        : null;

    const matchMediaDisplay = window.matchMedia('(display-mode: standalone)');
    try {
      matchMediaDisplay.addEventListener('change', checkStandalone);
    } catch {
      matchMediaDisplay.addListener(checkStandalone);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
      if (suppressCheckTimer !== null) window.clearTimeout(suppressCheckTimer);
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
        try {
          localStorage.setItem('kolot_pwa_installed', 'true');
        } catch {}
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
    install,
    promptAvailable: !!deferredPrompt,
  };
}
