import 'vitest'

declare module 'vitest' {
  export interface ProvidedContext {
    /** Base URL of the Rust API server started by global-setup.ts. */
    apiUrl: string
  }
}
