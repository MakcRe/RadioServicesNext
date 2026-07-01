import type { Plugin, DiscoveredPlugin } from '@radio-services/shared';
import { join } from 'path';
import { PluginRegistry } from './plugin-registry.js';
import { PluginDiscoverer } from './plugin-discoverer.js';

export class PluginLoader {
  private discoverer: PluginDiscoverer;
  private registry: PluginRegistry;
  private loaded = new Map<string, Plugin>();

  constructor(registry: PluginRegistry) {
    this.registry = registry;
    this.discoverer = new PluginDiscoverer();
  }

  async discoverAndLoad(dirs: string[]): Promise<Plugin[]> {
    const discovered = await this.discoverer.discover(dirs);
    const loaded: Plugin[] = [];

    for (const manifest of discovered) {
      const plugin = await this.load(manifest);
      loaded.push(plugin);
    }

    return loaded;
  }

  async load(manifest: DiscoveredPlugin): Promise<Plugin> {
    const absolutePath = join(manifest.path, manifest.entry);
    const module = await import(absolutePath);
    
    // Handle both direct plugin exports and factory function exports
    let plugin: Plugin;
    if (typeof module.default === 'function') {
      // Factory function pattern: export default function createPlugin() { return {...} }
      plugin = module.default();
    } else if (module.default && typeof module.default === 'object') {
      // Direct plugin object: export default {...}
      plugin = module.default;
    } else if (typeof module === 'object' && module !== null) {
      // Named export pattern: export const plugin = {...}
      plugin = module as unknown as Plugin;
    } else {
      throw new Error(`Cannot extract plugin from module: ${manifest.name}`);
    }

    if (!this.validate(plugin)) {
      throw new Error(`Invalid plugin: ${manifest.name}`);
    }

    this.loaded.set(plugin.name, plugin);
    this.registry.register(plugin);
    
    return plugin;
  }

  async unload(name: string): Promise<void> {
    const plugin = this.loaded.get(name);
    if (!plugin) {
      throw new Error(`Plugin ${name} is not loaded`);
    }

    if (plugin.stop) {
      await plugin.stop();
    }

    this.loaded.delete(name);
    this.registry.unregister(name);
  }

  private validate(plugin: unknown): plugin is Plugin {
    if (typeof plugin !== 'object' || plugin === null) return false;
    const p = plugin as Record<string, unknown>;
    return (
      typeof p.name === 'string' &&
      typeof p.version === 'string' &&
      typeof p.init === 'function' &&
      typeof p.start === 'function' &&
      typeof p.stop === 'function'
    );
  }

  getLoaded(): Plugin[] {
    return Array.from(this.loaded.values());
  }
}
