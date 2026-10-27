declare module 'node:test' {
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function describe(name: string, fn: () => void): void;
}
declare module 'node:assert/strict' {
  const assert: {
    (v: unknown, msg?: string): void;
    equal(a: unknown, b: unknown, msg?: string): void;
    notEqual(a: unknown, b: unknown, msg?: string): void;
    deepEqual(a: unknown, b: unknown, msg?: string): void;
    ok(v: unknown, msg?: string): void;
    throws(fn: () => unknown, msg?: unknown): void;
    rejects(p: Promise<unknown>, msg?: unknown): Promise<void>;
  };
  export default assert;
}
