import type { PluginContext } from '@radio-services/shared';

export class ListenersService {
  constructor(private context: PluginContext) {
    this.context.logger.info('ListenersService initialized');
  }

  async getListenerStats() {
    return { current: 0, peak: 0, total: 0 };
  }

  async getListenerHistory(_options?: { limit?: number; since?: Date }) {
    return { listeners: [], total: 0 };
  }

  async getListenerInfo(sessionId: string) {
    return { sessionId, connectedAt: new Date().toISOString(), metadata: {} };
  }

  async trackListener(sessionId: string, _data: Record<string, unknown>) {
    return { sessionId, tracked: true };
  }

  async disconnectListener(sessionId: string) {
    return { sessionId, disconnected: true };
  }
}
