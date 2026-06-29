declare module 'ua-parser-js' {
  export interface IDevice {
    type?: string
    vendor?: string
    model?: string
  }

  export interface IOS {
    name?: string
    version?: string
  }

  export interface IBrowser {
    name?: string
    version?: string
  }

  export class UAParser {
    constructor(uastring?: string)
    getBrowser(): IBrowser
    getDevice(): IDevice
    getEngine(): Record<string, unknown>
    getOS(): IOS
    getCPU(): Record<string, unknown>
    getResult(): {
      ua: string
      browser: IBrowser
      device: IDevice
      engine: Record<string, unknown>
      os: IOS
      cpu: Record<string, unknown>
    }
    getUA(): string
    setUA(uastring: string): UAParser
  }
}
