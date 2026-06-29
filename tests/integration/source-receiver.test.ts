import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Fastify from 'fastify'
import request from 'supertest'
import { SourceReceiver } from '../../src/services/source-receiver.js'

let app: ReturnType<typeof Fastify>
let receiver: SourceReceiver

beforeAll(async () => {
  app = Fastify({ logger: false })
  receiver = new SourceReceiver({ sourcePassword: 'hackme' })
  await receiver.register(app)
})

afterAll(async () => {
  await app.close()
})

describe('PUT /source', () => {
  it('rejects without Authorization', async () => {
    const res = await request(app.server)
      .put('/source')
      .set('Content-Type', 'audio/mpeg')
      .send(Buffer.from([0xff, 0xfb, 0x90]))
    expect(res.status).toBe(401)
  })

  it('accepts with correct Basic auth and emits session-start', async () => {
    let sessionId: string | null = null
    receiver.once('session-start', (s) => {
      sessionId = s.id
    })

    const res = await request(app.server)
      .put('/source')
      .set('Authorization', 'Basic ' + Buffer.from('source:hackme').toString('base64'))
      .set('Content-Type', 'audio/mpeg')
      .set('User-Agent', 'Lavf/60.0.0')
      .send(Buffer.from([0xff, 0xfb, 0x90, 0x00]))
    expect(res.status).toBe(200)
    expect(sessionId).not.toBeNull()
  })

  it('emits session-end when stream closes', async () => {
    let endFired = false
    receiver.once('session-end', () => {
      endFired = true
    })

    await request(app.server)
      .put('/source')
      .set('Authorization', 'Basic ' + Buffer.from('source:hackme').toString('base64'))
      .set('Content-Type', 'audio/mpeg')
      .send(Buffer.from([0xff, 0xfb]))
      .timeout(100)

    // wait a moment for end event
    await new Promise((r) => setTimeout(r, 200))
    expect(endFired).toBe(true)
  })

  it('rejects with wrong password', async () => {
    const res = await request(app.server)
      .put('/source')
      .set('Authorization', 'Basic ' + Buffer.from('source:wrong').toString('base64'))
      .send(Buffer.from([]))
    expect(res.status).toBe(401)
  })
})
