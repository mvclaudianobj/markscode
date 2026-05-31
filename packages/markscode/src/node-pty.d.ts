declare module "@lydell/node-pty" {
  export type IPtyForkOptions = {
    name?: string
    cols?: number
    rows?: number
    cwd?: string
    env?: Record<string, string | undefined>
    encoding?: string | null
    uid?: number
    gid?: number
  }

  export type IWindowsPtyForkOptions = IPtyForkOptions & {
    useConpty?: boolean
    useConptyDll?: boolean
    conptyInheritCursor?: boolean
  }

  export type IDisposable = {
    dispose(): void
  }

  export type IPty = {
    readonly pid: number
    readonly onData: (listener: (data: string) => void) => IDisposable
    readonly onExit: (listener: (event: { exitCode: number; signal?: number }) => void) => IDisposable
    write(data: string): void
    resize(columns: number, rows: number): void
    kill(signal?: string): void
  }

  export function spawn(file: string, args: string[] | string, options: IPtyForkOptions | IWindowsPtyForkOptions): IPty
}
