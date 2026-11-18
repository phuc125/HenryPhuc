import { Capacitor } from '@capacitor/core';
import { Network, type ConnectionStatus } from '@capacitor/network';
import type { NetworkInterfaceKind } from './networkPolicy';

export function isCapacitorNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function mapCapacitorNetworkStatus(status: {
  connected: boolean;
  connectionType: ConnectionStatus['connectionType'];
}): {
  isOnline: boolean;
  detectedKind: NetworkInterfaceKind;
} {
  if (!status.connected || status.connectionType === 'none') {
    return { isOnline: false, detectedKind: 'UNKNOWN' };
  }
  if (status.connectionType === 'wifi') {
    return { isOnline: true, detectedKind: 'WIFI' };
  }
  if (status.connectionType === 'cellular') {
    return { isOnline: true, detectedKind: 'CELLULAR_4G' };
  }
  return { isOnline: true, detectedKind: 'UNKNOWN' };
}

export function subscribeNativeNetwork(
  onStatus: (mapped: { isOnline: boolean; detectedKind: NetworkInterfaceKind }) => void,
): () => void {
  if (!isCapacitorNativeApp()) {
    return () => {};
  }

  let active = true;
  let listenerHandle: { remove: () => Promise<void> } | null = null;

  void Network.getStatus()
    .then((status) => {
      if (active) {
        onStatus(mapCapacitorNetworkStatus(status));
      }
    })
    .catch(() => {
      // ignore fallback
    });

  void Network.addListener('networkStatusChange', (status) => {
    if (active) {
      onStatus(mapCapacitorNetworkStatus(status));
    }
  })
    .then((handle) => {
      if (active) {
        listenerHandle = handle;
      } else {
        void handle.remove();
      }
    })
    .catch(() => {
      // ignore fallback
    });

  return () => {
    active = false;
    if (listenerHandle) {
      void listenerHandle.remove();
    }
  };
}
