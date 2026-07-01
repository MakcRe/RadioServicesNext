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

  export interface CPU {
    architecture?: string
  }

  export interface UAParserInstance {
    getBrowser(): IBrowser
    getDevice(): IDevice
    getEngine(): unknown
    getOS(): IOS
    getCPU(): CPU
    getResult(): {
      ua: string
      browser: IBrowser
      device: IDevice
      engine: unknown
      os: IOS
      cpu: CPU
    }
    setUA(uastring: string): UAParserInstance
  }

  class UAParser {
    constructor(uastring?: string)
    getBrowser(): IBrowser
    getDevice(): IDevice
    getEngine(): unknown
    getOS(): IOS
    getCPU(): CPU
    getResult(): {
      ua: string
      browser: IBrowser
      device: IDevice
      engine: unknown
      os: IOS
      cpu: CPU
    }
    setUA(uastring: string): UAParserInstance
  }

  export default UAParser
}
