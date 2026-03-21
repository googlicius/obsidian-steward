import { getParamTokenOverrides, isInjectable } from './decorators';
import { Constructor, Lifecycle, Provider, Token } from './types';

export class Container {
  private readonly registry = new Map<Token, Provider>();
  private readonly singletons = new Map<Token, unknown>();

  constructor(private readonly parent?: Container) {}

  register<T>(token: Token<T>): RegistrationBuilder<T> {
    return new RegistrationBuilder<T>(this, token);
  }

  /** Register a class as a transient provider (new instance per resolve). */
  registerClass<T>(token: Token<T>, implementation: Constructor<T>): this {
    this.registry.set(token, {
      kind: 'class',
      lifecycle: Lifecycle.Transient,
      implementation,
    });
    return this;
  }

  /** Register a class as a singleton provider (lazily created, one instance). */
  registerSingleton<T>(token: Token<T>, implementation: Constructor<T>): this {
    this.registry.set(token, {
      kind: 'class',
      lifecycle: Lifecycle.Singleton,
      implementation,
    });
    return this;
  }

  /** Register a pre-built value. */
  registerValue<T>(token: Token<T>, value: T): this {
    this.registry.set(token, { kind: 'value', value });
    return this;
  }

  resolve<T>(token: Token<T>): T {
    return this.resolveInternal(token, []);
  }

  private resolveInternal<T>(token: Token<T>, resolutionStack: Token[]): T {
    if (resolutionStack.includes(token)) {
      const cycle = [...resolutionStack, token].map(tokenName).join(' -> ');
      throw new Error(`Circular dependency detected: ${cycle}`);
    }

    const cached = this.singletons.get(token);
    if (cached !== undefined) {
      return cached as T;
    }

    const provider = this.registry.get(token) ?? this.parent?.getProvider(token);
    if (!provider) {
      throw new Error(`No provider registered for ${tokenName(token)}`);
    }

    if (provider.kind === 'value') {
      return provider.value as T;
    }

    const instance = this.construct<T>(provider.implementation as Constructor<T>, [
      ...resolutionStack,
      token,
    ]);

    if (provider.lifecycle === Lifecycle.Singleton) {
      this.singletons.set(token, instance);
    }

    return instance;
  }

  /** Create a child container that inherits this container's registrations. */
  createChild(): Container {
    return new Container(this);
  }

  has(token: Token): boolean {
    return this.registry.has(token) || (this.parent?.has(token) ?? false);
  }

  /** Clear all registrations and cached singletons. */
  clear(): void {
    this.registry.clear();
    this.singletons.clear();
  }

  private getProvider(token: Token): Provider | undefined {
    return this.registry.get(token) ?? this.parent?.getProvider(token);
  }

  private construct<T>(implementation: Constructor<T>, resolutionStack: Token[]): T {
    const paramTypes: Constructor[] =
      Reflect.getMetadata('design:paramtypes', implementation) ?? [];
    const tokenOverrides = isInjectable(implementation)
      ? getParamTokenOverrides(implementation)
      : new Map<number, Token>();

    const args: unknown[] = [];
    for (let i = 0; i < paramTypes.length; i++) {
      const paramToken = tokenOverrides.get(i) ?? paramTypes[i];
      if (!paramToken || paramToken === Object) {
        throw new Error(
          `Cannot resolve parameter at index ${i} of ${implementation.name}. ` +
            `The type metadata is ambiguous (Object). Use @Inject(token) to specify the token explicitly.`
        );
      }
      args.push(this.resolveInternal(paramToken, resolutionStack));
    }

    return new implementation(...args);
  }
}

class RegistrationBuilder<T> {
  constructor(
    private readonly container: Container,
    private readonly token: Token<T>
  ) {}

  toClass(implementation: Constructor<T>): Container {
    return this.container.registerClass(this.token, implementation);
  }

  toSingleton(implementation: Constructor<T>): Container {
    return this.container.registerSingleton(this.token, implementation);
  }

  toValue(value: T): Container {
    return this.container.registerValue(this.token, value);
  }
}

function tokenName(token: Token): string {
  if (typeof token === 'function') {
    return token.name || 'AnonymousClass';
  }
  return token.toString();
}
