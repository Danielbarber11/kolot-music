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
const WEAK_SPEED_THRESHOLD_MBPS = 0.35;
const HIGH_RTT_THRESHOLD_MS = 1800;
const SEVERE_PROBE_MS = 3200;

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

async function measureLightweightLatency(): Promise<{ ok: boolean; rttMs: number | null }> {
  if (typeof fetch !== 'function' || typeof performance === 'undefined') {
    return { ok: true, rttMs: null };
  }
  const start = performance.now();
  try {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 5000) : null;
    // Ping static manifest first (zero worker cold-start overhead) to measure true Wi-Fi/network speed
    const res = await fetch(`/manifest.json?_net=${Date.now()}`, {
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
  const downlink =
    typeof conn?.downlink === 'number' && conn.downlink > 0 ? Number(conn.downlink.toFixed(2)) : null;
  const rtt = typeof conn?.rtt === 'number' && conn.rtt > 0 ? conn.rtt : null;
  const effType = conn?.effectiveType || '';

  // Immediate severe 2G / Slow-2G signal from OS
  if (effType === 'slow-2g' || effType === '2g') {
    const verify = await measureLightweightLatency();
    if (!verify.ok || (verify.rttMs !== null && verify.rttMs > 900)) {
      return {
        status: 'weak',
        speedMbps: downlink ?? 0.25,
        rttMs: verify.rttMs ?? rtt,
        recommendedMbps: RECOMMENDED_MIN_MBPS,
        reason: 'slow_2g',
      };
    }
  }

  // Probe real network latency before flagging Wi-Fi as weak (prevents false positives when Wi-Fi bars are full)
  const probe1 = await measureLightweightLatency();
  if (!probe1.ok && typeof navigator !== 'undefined' && navigator.onLine === false) {
    return {
      status: 'offline',
      speedMbps: 0,
      rttMs: probe1.rttMs,
      recommendedMbps: RECOMMENDED_MIN_MBPS,
      reason: 'offline_probe',
    };
  }

  const looksWeakFromHardware =
    (downlink !== null && downlink < WEAK_SPEED_THRESHOLD_MBPS) ||
    (rtt !== null && rtt > HIGH_RTT_THRESHOLD_MS);
  const looksWeakFromProbe = !probe1.ok || (probe1.rttMs !== null && probe1.rttMs > SEVERE_PROBE_MS);

  // Require BOTH an issue indicator AND a confirming second check 1.2s later so single spikes never false-trigger
  if ((looksWeakFromHardware && probe1.rttMs !== null && probe1.rttMs > 1000) || looksWeakFromProbe) {
    await new Promise((r) => setTimeout(r, 1200));
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return {
        status: 'offline',
        speedMbps: 0,
        rttMs: null,
        recommendedMbps: RECOMMENDED_MIN_MBPS,
        reason: 'offline_confirmed',
      };
    }
    const probe2 = await measureLightweightLatency();
    const confirmedWeak =
      !probe2.ok ||
      (probe2.rttMs !== null && probe2.rttMs > SEVERE_PROBE_MS) ||
      (looksWeakFromHardware && probe2.rttMs !== null && probe2.rttMs > 1100);

    if (confirmedWeak) {
      return {
        status: 'weak',
        speedMbps: downlink,
        rttMs: probe2.rttMs ?? probe1.rttMs ?? rtt,
        recommendedMbps: RECOMMENDED_MIN_MBPS,
        reason: !probe2.ok ? 'unstable_connection' : 'confirmed_weak',
      };
    }
  }

  return {
    status: 'good',
    speedMbps: downlink,
    rttMs: probe1.rttMs ?? rtt,
    recommendedMbps: RECOMMENDED_MIN_MBPS,
  };
}

export function useNetworkHealth(): NetworkHealthState {
  // Always start optimistic unless genuinely offline — avoids false weak banner flash during initial load
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
    return {
      status: 'good',
      speedMbps: null,
      rttMs: null,
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

    // Wait briefly after initial boot image/API burst so concurrent asset loading never triggers a false weak-Wi-Fi alert
    const initialTimer = setTimeout(refresh, 3500);

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

    const interval = setInterval(refresh, 40000);

    return () => {
      active = false;
      clearTimeout(initialTimer);
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
