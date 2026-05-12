/**
 * Class or constructor function with a `prototype` object.
 * Structural type so classes with **private** constructors (e.g. singletons) type-check without casts.
 */
export type MixinConstructor = { prototype: object };

/**
 * Apply mixins to a base class
 * Based on TypeScript official mixin pattern
 * @param derivedCtor - The derived constructor
 * @param constructors - Array of mixin constructors
 */
export function applyMixins(derivedCtor: MixinConstructor, constructors: MixinConstructor[]): void {
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
