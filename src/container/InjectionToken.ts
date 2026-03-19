import { InjectionTokenLike } from './types';

export class InjectionToken<T> implements InjectionTokenLike<T> {
  readonly __type?: T;

  constructor(public readonly description: string) {}

  toString(): string {
    return `InjectionToken(${this.description})`;
  }
}
