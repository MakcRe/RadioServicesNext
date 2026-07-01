declare module 'ua-parser-js' {
  export interface UAParserResult {
    ua: string
    browser: { name: string | null; version: string | null; major: string | null }
    cpu: { architecture: string | null }
    device: { type: string | null; vendor: string | null; model: string | null }
    engine: { name: string | null; version: string | null }
    os: { name: string | null; version: string | null }
    cpu: { architecture: string | null }
  }

  export default class UAParser {
    constructor(uastring?: string, uatype?: string)
    getUA(): string
    getBrowser(): { name: string | null; version: string | null; major: string | null }
    getDevice(): { type: string | null; vendor: string | null; model: string | null }
    getEngine(): { name: string | null; version: string | null }
    getOS(): { name: string | null; version: string | null }
    getCPU(): { architecture: string | null }
    getResult(): UAParserResult
  }
}
