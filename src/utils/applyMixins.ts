import { Constructor } from 'obsidian';

/**
 * Apply mixins to a base class
 * Based on TypeScript official mixin pattern
 * @param derivedCtor - The derived constructor
 * @param constructors - Array of mixin constructors
 */
export function applyMixins(
  derivedCtor: Constructor<unknown>,
  constructors: Constructor<unknown>[]
): void {
  for (const baseCtor of constructors) {
    for (const name of Object.getOwnPropertyNames(baseCtor.prototype)) {
      if (name === 'constructor') continue;

      Object.defineProperty(
        derivedCtor.prototype,
        name,
        Object.getOwnPropertyDescriptor(baseCtor.prototype, name) || Object.create(null)
      );
    }
  }
}
