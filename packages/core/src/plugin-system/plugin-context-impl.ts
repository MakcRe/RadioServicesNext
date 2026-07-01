import type {
  PluginContext,
  RouteOptions,
  WsHandler,
  EventHandler,
  Logger,
  RadioConfig,
} from '@radio-services/shared';

export class PluginContextImpl implements PluginContext {
  private services = new Map<string, unknown>();
  private eventHandlers = new Map<string, EventHandler[]>();
  private registeredRoutes: RouteOptions[] = [];
  private registeredWsHandlers = new Map<string, WsHandler>();

  constructor(
    public readonly logger: Logger,
    public readonly config: Readonly<RadioConfig>
  ) {}

  registerRoute(options: RouteOptions): void {
    this.registeredRoutes.push(options);
  }

  registerWsHandler(path: string, handler: WsHandler): void {
    this.registeredWsHandlers.set(path, handler);
  }

  emit(event: string, data: unknown): void {
    const handlers = this.eventHandlers.get(event) ?? [];
    for (const handler of handlers) {
      try {
        handler(data);
      } catch (err) {
        this.logger.error(`Error in event handler for ${event}`, err);
      }
    }
  }

  on(event: string, handler: EventHandler): void {
    const existing = this.eventHandlers.get(event) ?? [];
    this.eventHandlers.set(event, [...existing, handler]);
  }

  getService<T>(name: string): T | undefined {
    return this.services.get(name) as T | undefined;
  }

  registerService(name: string, service: unknown): void {
    this.services.set(name, service);
  }

  getRegisteredRoutes(): RouteOptions[] {
    return this.registeredRoutes;
  }

  getRegisteredWsHandlers(): Map<string, WsHandler> {
    return this.registeredWsHandlers;
  }
}
