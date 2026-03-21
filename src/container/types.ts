export enum Lifecycle {
  Transient = 'transient',
  Singleton = 'singleton',
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Constructor<T = unknown> = new (...args: any[]) => T;

export type Token<T = unknown> = Constructor<T> | InjectionTokenLike<T>;

export interface InjectionTokenLike<T> {
  readonly description: string;
  /** Phantom field for type inference only -- never set at runtime. */
  readonly __type?: T;
}

export interface ClassProvider<T> {
  kind: 'class';
  lifecycle: Lifecycle;
  implementation: Constructor<T>;
}

export interface ValueProvider<T> {
  kind: 'value';
  value: T;
}

export type Provider<T = unknown> = ClassProvider<T> | ValueProvider<T>;

export const INJECT_METADATA_KEY = Symbol('inject:tokens');
export const INJECTABLE_METADATA_KEY = Symbol('injectable');
