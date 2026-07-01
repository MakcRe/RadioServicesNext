export interface StreamState {
  isLive: boolean;
  sourceConnected: boolean;
  bitrate: number;
  sampleRate: number;
  channels: number;
  currentListenerCount: number;
}

export interface ListenerInfo {
  id: string;
  ip: string;
  userAgent: string;
  connectedAt: Date;
  bytesReceived: number;
}
