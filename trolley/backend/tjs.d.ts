// Minimal fallback typing for the txiki.js runtime global.
// For full types: `npm i -D @txikijs/types`, then delete this file and add
// "types": ["@txikijs/types"] to your tsconfig.
declare const tjs: any;

declare module 'tjs:sqlite' {
  export class Database {
    constructor(path?: string, options?: { readOnly?: boolean });
    prepare(sql: string): any;
    exec(sql: string): void;
    close(): void;
  }
}
