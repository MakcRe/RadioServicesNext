import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import type { DiscoveredPlugin } from '@radio-services/shared';

export class PluginDiscoverer {
  async discover(dirs: string[]): Promise<DiscoveredPlugin[]> {
    const plugins: DiscoveredPlugin[] = [];

    for (const dir of dirs) {
      const entries = await readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        
        const manifestPath = join(dir, entry.name, 'manifest.json');
        
        try {
          const manifestContent = await readFile(manifestPath, 'utf-8');
          const manifest = JSON.parse(manifestContent);
          
          plugins.push({
            name: manifest.name,
            version: manifest.version,
            entry: manifest.entry,
            priority: manifest.priority ?? 100,
            path: join(dir, entry.name),
          });
        } catch {
          // Skip if manifest doesn't exist or is invalid
        }
      }
    }

    // Sort by priority (lower = earlier)
    return plugins.sort((a, b) => a.priority - b.priority);
  }
}
