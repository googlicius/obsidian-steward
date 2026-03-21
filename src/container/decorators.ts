import { Constructor, Token, INJECT_METADATA_KEY, INJECTABLE_METADATA_KEY } from './types';

/**
 * Marks a class as injectable. Required for automatic constructor parameter resolution
 * via `reflect-metadata` (`design:paramtypes`).
 */
export function Injectable(): ClassDecorator {
  return (target: Function) => {
    Reflect.defineMetadata(INJECTABLE_METADATA_KEY, true, target);
  };
}

/**
 * Overrides the token used to resolve a specific constructor parameter.
 * Use this when the parameter type is an interface or abstract class that
 * doesn't match a concrete registration.
 */
export function Inject(token: Token): ParameterDecorator {
  return (target: Object, _propertyKey: string | symbol | undefined, parameterIndex: number) => {
    const existingTokens: Map<number, Token> =
      Reflect.getOwnMetadata(INJECT_METADATA_KEY, target) ?? new Map<number, Token>();
    existingTokens.set(parameterIndex, token);
    Reflect.defineMetadata(INJECT_METADATA_KEY, existingTokens, target);
  };
}

export function isInjectable(target: Constructor): boolean {
  return Reflect.getOwnMetadata(INJECTABLE_METADATA_KEY, target) === true;
}

export function getParamTokenOverrides(target: Constructor): Map<number, Token> {
  return Reflect.getOwnMetadata(INJECT_METADATA_KEY, target) ?? new Map<number, Token>();
}
