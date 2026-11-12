import React, { Component, ErrorInfo, ReactNode } from 'react';
import { RefreshCw, AlertTriangle } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('React ErrorBoundary caught an error:', error, errorInfo);
    // Auto-clear corrupted local cache keys that cause state crashes
    try {
      const keysToClear = [
        'kolot_cloud_tracks_cache',
        'kolot_uploaded_tracks',
        'kolot_user_albums',
        'wikiarchive_cached_auth_user',
        'wikiarchive_artist_account',
        'kolot_artist_account_v1',
      ];
      keysToClear.forEach((key) => localStorage.removeItem(key));
    } catch {}
  }

  private handleReset = () => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {}
    this.setState({ hasError: false, error: undefined });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 bg-black text-white flex flex-col items-center justify-center p-6 text-center font-sans z-[99999]">
          <div className="w-16 h-16 rounded-full bg-rose-500/20 border border-rose-500/40 flex items-center justify-center mb-5 text-rose-400">
            <AlertTriangle className="w-8 h-8" />
          </div>

          <h1 className="text-xl sm:text-2xl font-bold mb-2">
            התרחשה שגיאה בטעינת התוכן
          </h1>

          <p className="text-xs text-neutral-400 max-w-md mb-6 leading-relaxed">
            בוצע איפוס אוטומטי של זיכרון המטמון. לחץ על הכפתור למטה לרענון נקי של האתר.
          </p>

          <button
            type="button"
            onClick={this.handleReset}
            className="px-6 py-3 rounded-xl bg-white hover:bg-neutral-200 text-black font-bold text-xs flex items-center gap-2 shadow-2xl transition-all cursor-pointer active:scale-95"
          >
            <RefreshCw className="w-4 h-4 text-black" />
            <span>רענון האתר וטעינה מחדש</span>
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
