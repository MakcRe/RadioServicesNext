import type Database from 'better-sqlite3'
import type { Plugin, PluginContext } from '@radio-services/shared'
import { ListenerManager } from './services/listener-manager.js'
import { ListenerLogsRepo } from './repos/listener-logs.repo.js'
import { registerListenersRoutes } from './routes/listeners.js'

export default function createListenersPlugin(): Plugin {
  let listenerManager: ListenerManager
  let context: PluginContext

  return {
    name: 'listeners',
    version: '0.1.0',

    init(ctx: PluginContext) {
      context = ctx
      const db = ctx.getService<Database.Database>('db')
      if (!db) {
        throw new Error('Database service not available')
      }

      const listenerLogsRepo = new ListenerLogsRepo(db)
      listenerManager = new ListenerManager(listenerLogsRepo)

      registerListenersRoutes(ctx, { listenerManager })

      ctx.registerService('listenerManager', listenerManager)
    },

    async start() {
      context.logger.info('Listeners plugin started')
    },

    async stop() {
      context.logger.info('Listeners plugin stopped')
    },

    async healthCheck() {
      return { healthy: true }
    }
  }
}
