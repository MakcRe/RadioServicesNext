import { randomUUID } from 'crypto'
import { EventEmitter } from 'events'
import { PassThrough } from 'stream'

export interface SourceSession {
  id: string
  startAt: Date
  sourceType: 'ffmpeg' | 'butt' | 'mixxx' | 'other'
  userAgent: string
  mountpoint: string
  metadata?: { name?: string; genre?: string; description?: string }
}

export interface SourceReceiverOptions {
  sourcePassword: string
  /** Optional hook called on every chunk received from the source */
  onData?: (chunk: Buffer, session: SourceSession) => void
}

function inferSourceType(userAgent: string): SourceSession['sourceType'] {
  const ua = userAgent.toLowerCase()
  if (ua.includes('ffmpeg') || ua.includes('lavf')) return 'ffmpeg'
  if (ua.includes('butt')) return 'butt'
  if (ua.includes('mixxx')) return 'mixxx'
  return 'other'
}

function parseBasicAuth(header: string): string | null {
  if (!header.startsWith('Basic ')) return null
  const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString()
  const idx = decoded.indexOf(':')
  return idx >= 0 ? decoded.slice(idx + 1) : null
}

export interface FastifyInstance {
  addContentTypeParser: (contentType: string, fn: (request: any, headers: any, done: (err: Error | null, body: any) => void) => void) => void
  put: (path: string, handler: (request: any, reply: any) => Promise<any> | any) => void
  post: (path: string, handler: (request: any, reply: any) => Promise<any> | any) => void
}

export class SourceReceiver extends EventEmitter {
  private activeSession: SourceSession | null = null
  private activeSocket: import('net').Socket | null = null
  private internalCleanup: (() => void) | null = null

  constructor(private opts: SourceReceiverOptions) {
    super()
  }

  /** Attach a non-HTTP source (e.g. ffmpeg stdout pipe). Avoids the auth requirement. */
  attachInternalStream(stream: import('stream').Readable, metadata?: Partial<SourceSession['metadata']>): SourceSession {
    if (this.activeSession && this.activeSocket) {
      const prevSocket = this.activeSocket
      const prevSession = this.activeSession
      this.activeSession = null
      this.activeSocket = null
      this.emit('session-end', prevSession)
      try { if (!prevSocket.destroyed) prevSocket.end() } catch {}
    }
    this.detachInternalStream()

    const session: SourceSession = {
      id: randomUUID(),
      startAt: new Date(),
      sourceType: 'ffmpeg',
      userAgent: 'internal-ffmpeg',
      mountpoint: '/source',
      metadata,
    }
    this.activeSession = session
    this.activeSocket = null

    stream.on('data', (chunk: Buffer) => {
      try { if (this.opts.onData) this.opts.onData(chunk, session) } catch (err) { this.emit('error', err) }
      this.emit('data', chunk, session)
    })
    const cleanup = () => {
      if (this.activeSession?.id === session.id) {
        this.activeSession = null
        this.activeSocket = null
        this.emit('session-end', session)
      }
      this.detachInternalStream()
    }
    stream.on('end', cleanup)
    stream.on('close', cleanup)
    stream.on('error', cleanup)
    this.internalCleanup = () => {
      try { if (!stream.destroyed) stream.destroy() } catch {}
    }

    this.emit('session-start', session)
    return session
  }

  detachInternalStream(): void {
    if (this.internalCleanup) {
      this.internalCleanup()
      this.internalCleanup = null
    }
  }

  async register(app: FastifyInstance): Promise<void> {
    app.addContentTypeParser(
      'audio/mpeg',
      (_request, _headers, done) => {
        const passthrough = new PassThrough()
        done(null, passthrough)
      }
    )

    const handler = async (request: any, reply: any) => {
      const password = parseBasicAuth(request.headers.authorization ?? '')
      if (!password) {
        reply.header('WWW-Authenticate', 'Basic realm="radio"')
        reply.status(401)
        return reply.send({ error: 'unauthorized' })
      }
      if (password !== this.opts.sourcePassword) {
        reply.status(401)
        return reply.send({ error: 'invalid password' })
      }

      if (this.activeSession && this.activeSocket) {
        const prevSocket = this.activeSocket
        const prevSession = this.activeSession
        this.activeSession = null
        this.activeSocket = null
        this.emit('session-end', prevSession)
        try { if (!prevSocket.destroyed) prevSocket.end() } catch {}
      }

      const userAgent = (request.headers['user-agent'] as string) ?? ''
      const session: SourceSession = {
        id: randomUUID(),
        startAt: new Date(),
        sourceType: inferSourceType(userAgent),
        userAgent,
        mountpoint: '/source',
        metadata: {
          name: request.headers['ice-name'] as string | undefined,
          genre: request.headers['ice-genre'] as string | undefined,
          description: request.headers['ice-description'] as string | undefined,
        },
      }

      this.activeSession = session
      this.activeSocket = request.raw.socket

      reply.header('icy-name', session.metadata?.name ?? 'radioServices')
      reply.header('icy-public', '1')

      reply.hijack()

      const cleanup = () => {
        if (this.activeSession?.id === session.id) {
          this.activeSession = null
          this.activeSocket = null
          this.emit('session-end', session)
        }
      }
      request.raw.on('data', (chunk: Buffer) => {
        try {
          if (this.opts.onData) this.opts.onData(chunk, session)
        } catch (err) {
          this.emit('error', err)
        }
        this.emit('data', chunk, session)
      })
      request.raw.on('end', cleanup)
      request.raw.on('close', cleanup)
      request.raw.on('error', cleanup)

      this.emit('session-start', session)

      reply.raw.setHeader('Content-Type', 'audio/mpeg')
      reply.raw.writeHead(200)
      reply.raw.end()
      return reply
    }

    app.put('/source', handler)
    app.post('/source', handler)
  }

  getActiveSession(): SourceSession | null {
    return this.activeSession
  }
}
