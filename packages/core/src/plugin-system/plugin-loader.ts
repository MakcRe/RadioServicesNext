import type { Plugin, DiscoveredPlugin } from '@radio-services/shared';
import { join, isAbsolute } from 'path';
import { existsSync } from 'fs';
import { pathToFileURL } from 'url';
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
    const absolutePath = this.resolveEntry(manifest);
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

  /**
   * Resolve a plugin's entry path, falling back to a source entry when
   * the production-built entry (e.g. dist/index.js) is not available.
   *
   * Resolution order:
   *   1. manifest.entry  (e.g. dist/index.js) — used in production after `pnpm build`
   *   2. manifest.source (e.g. src/index.ts) — used in dev mode under tsx/esm
   *
   * In dev mode (when only the source file exists), the loader imports the
   * source file directly. tsx/esm transpiles TypeScript on the fly, so this
   * works without a prior build step.
   */
  private resolveEntry(manifest: DiscoveredPlugin): string {
    const manifestAny = manifest as DiscoveredPlugin & { source?: string };

    // 1. Try the built entry first
    const builtPath = isAbsolute(manifest.entry)
      ? manifest.entry
      : join(manifest.path, manifest.entry);
    if (existsSync(builtPath)) {
      return pathToFileURL(builtPath).href;
    }

    // 2. Fall back to source entry (dev mode)
    if (manifestAny.source) {
      const sourcePath = isAbsolute(manifestAny.source)
        ? manifestAny.source
        : join(manifest.path, manifestAny.source);
      if (existsSync(sourcePath)) {
        return pathToFileURL(sourcePath).href;
      }
    }

    // 3. Last resort: try src/index.ts (common convention)
    const conventionalSource = join(manifest.path, 'src/index.ts');
    if (existsSync(conventionalSource)) {
      return pathToFileURL(conventionalSource).href;
    }

    throw new Error(
      `Plugin "${manifest.name}" entry not found. ` +
      `Tried: ${builtPath}` +
      (manifestAny.source ? `, ${join(manifest.path, manifestAny.source)}` : '') +
      `. Run \`pnpm -r build\` or ensure src/index.ts exists.`
    );
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
