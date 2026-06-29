import { buildApp } from './app.js'

const PORT = Number(process.env.PORT ?? 8000)
const HOST = process.env.HOST ?? '0.0.0.0'

async function main() {
  const app = await buildApp()
  await app.listen({ port: PORT, host: HOST })
  app.log.info(`server listening on http://${HOST}:${PORT}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
