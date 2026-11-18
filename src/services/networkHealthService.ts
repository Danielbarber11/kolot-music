import { useState, useEffect } from 'react';

export type NetworkStatus = 'good' | 'weak' | 'offline';

export interface NetworkHealthState {
  status: NetworkStatus;
  speedMbps: number | null;
  rttMs: number | null;
  recommendedMbps: number;
  reason?: string;
}

export const RECOMMENDED_MIN_MBPS = 1.2;
const WEAK_SPEED_THRESHOLD_MBPS = 0.85;
const HIGH_RTT_THRESHOLD_MS = 850;

function readNavigatorConnection(): {
  downlink?: number;
  effectiveType?: string;
  rtt?: number;
  saveData?: boolean;
} | null {
  if (typeof navigator === 'undefined') return null;
  const nav: any = navigator;
  return nav.connection || nav.mozConnection || nav.webkitConnection || null;
}

async function measureRealApiLatency(): Promise<{ ok: boolean; rttMs: number | null }> {
  if (typeof fetch !== 'function' || typeof performance === 'undefined') {
    return { ok: true, rttMs: null };
  }
  const start = performance.now();
  try {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 5000) : null;
    const res = await fetch(`/api/storage/status?_t=${Date.now()}`, {
      cache: 'no-store',
      signal: controller?.signal,
    });
    if (timer) clearTimeout(timer);
    const rttMs = Math.round(performance.now() - start);
    return { ok: res.ok, rttMs };
  } catch {
    return { ok: false, rttMs: Math.round(performance.now() - start) };
  }
}

export async function checkNetworkHealth(): Promise<NetworkHealthState> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return {
      status: 'offline',
      speedMbps: 0,
      rttMs: null,
      recommendedMbps: RECOMMENDED_MIN_MBPS,
      reason: 'no_internet',
    };
  }

  const conn = readNavigatorConnection();
  const downlink = typeof conn?.downlink === 'number' && conn.downlink > 0 ? Number(conn.downlink.toFixed(2)) : null;
  const rtt = typeof conn?.rtt === 'number' && conn.rtt > 0 ? conn.rtt : null;
  const effType = conn?.effectiveType || '';

  if (conn?.saveData) {
    return {
      status: 'weak',
      speedMbps: downlink,
      rttMs: rtt,
      recommendedMbps: RECOMMENDED_MIN_MBPS,
      reason: 'save_data',
    };
  }

  if (effType === 'slow-2g' || effType === '2g') {
    return {
      status: 'weak',
      speedMbps: downlink ?? 0.25,
      rttMs: rtt,
      recommendedMbps: RECOMMENDED_MIN_MBPS,
      reason: 'slow_2g',
    };
  }

  if (downlink !== null && downlink < WEAK_SPEED_THRESHOLD_MBPS) {
    return {
      status: 'weak',
      speedMbps: downlink,
      rttMs: rtt,
      recommendedMbps: RECOMMENDED_MIN_MBPS,
      reason: 'low_downlink',
    };
  }

  if (rtt !== null && rtt > HIGH_RTT_THRESHOLD_MS) {
    return {
      status: 'weak',
      speedMbps: downlink,
      rttMs: rtt,
      recommendedMbps: RECOMMENDED_MIN_MBPS,
      reason: 'high_latency',
    };
  }

  // Fallback / verify real server responsiveness (also handles Safari/iOS where navigator.connection is missing)
  const probe = await measureRealApiLatency();
  if (!probe.ok && typeof navigator !== 'undefined' && navigator.onLine === false) {
    return {
      status: 'offline',
      speedMbps: 0,
      rttMs: probe.rttMs,
      recommendedMbps: RECOMMENDED_MIN_MBPS,
      reason: 'offline_probe',
    };
  }

  if (probe.rttMs !== null && probe.rttMs > 2200) {
    return {
      status: 'weak',
      speedMbps: downlink,
      rttMs: probe.rttMs,
      recommendedMbps: RECOMMENDED_MIN_MBPS,
      reason: 'slow_server_probe',
    };
  }

  return {
    status: 'good',
    speedMbps: downlink,
    rttMs: probe.rttMs ?? rtt,
    recommendedMbps: RECOMMENDED_MIN_MBPS,
  };
}

export function useNetworkHealth(): NetworkHealthState {
  const [health, setHealth] = useState<NetworkHealthState>(() => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return {
        status: 'offline',
        speedMbps: 0,
        rttMs: null,
        recommendedMbps: RECOMMENDED_MIN_MBPS,
        reason: 'no_internet',
      };
    }
    const conn = readNavigatorConnection();
    const downlink = typeof conn?.downlink === 'number' && conn.downlink > 0 ? Number(conn.downlink.toFixed(2)) : null;
    if (
      conn?.saveData ||
      conn?.effectiveType === 'slow-2g' ||
      conn?.effectiveType === '2g' ||
      (downlink !== null && downlink < WEAK_SPEED_THRESHOLD_MBPS)
    ) {
      return {
        status: 'weak',
        speedMbps: downlink,
        rttMs: conn?.rtt ?? null,
        recommendedMbps: RECOMMENDED_MIN_MBPS,
        reason: 'initial_slow',
      };
    }
    return {
      status: 'good',
      speedMbps: downlink,
      rttMs: conn?.rtt ?? null,
      recommendedMbps: RECOMMENDED_MIN_MBPS,
    };
  });

  useEffect(() => {
    let active = true;

    const refresh = () => {
      checkNetworkHealth().then((next) => {
        if (active) setHealth(next);
      });
    };

    refresh();

    const handleOnline = () => refresh();
    const handleOffline = () => {
      if (active) {
        setHealth({
          status: 'offline',
          speedMbps: 0,
          rttMs: null,
          recommendedMbps: RECOMMENDED_MIN_MBPS,
          reason: 'offline_event',
        });
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const conn: any = readNavigatorConnection();
    if (conn && typeof conn.addEventListener === 'function') {
      conn.addEventListener('change', refresh);
    }

    const interval = setInterval(refresh, 35000);

    return () => {
      active = false;
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (conn && typeof conn.removeEventListener === 'function') {
        conn.removeEventListener('change', refresh);
      }
      clearInterval(interval);
    };
  }, []);

  return health;
}
