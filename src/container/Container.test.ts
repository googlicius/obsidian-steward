import 'reflect-metadata';
import { Container } from './Container';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { Injectable, Inject } from './decorators';
import { InjectionToken } from './InjectionToken';

// ── Test fixtures ──────────────────────────────────────────────────

class Logger {
  log(msg: string): string {
    return msg;
  }
}

@Injectable()
class Database {
  constructor(public logger: Logger) {}
}

@Injectable()
class UserService {
  constructor(public database: Database) {}
}

const API_URL = new InjectionToken<string>('API_URL');

@Injectable()
class ApiClient {
  constructor(
    public logger: Logger,
    @Inject(API_URL) public apiUrl: string
  ) {}
}

// Circular dependency fixtures are defined inside the test to avoid
// TDZ issues with decorator metadata emission at module level.

// ── Tests ──────────────────────────────────────────────────────────

describe('Container', () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
  });

  describe('value registration', () => {
    it('should resolve a registered value', () => {
      container.registerValue(API_URL, 'https://api.example.com');

      expect(container.resolve(API_URL)).toBe('https://api.example.com');
    });

    it('should resolve a value via fluent API', () => {
      container.register(API_URL).toValue('https://api.test.com');

      expect(container.resolve(API_URL)).toBe('https://api.test.com');
    });
  });

  describe('transient registration', () => {
    it('should create a new instance on each resolve', () => {
      container.registerClass(Logger, Logger);

      const a = container.resolve(Logger);
      const b = container.resolve(Logger);

      expect(a).toBeInstanceOf(Logger);
      expect(b).toBeInstanceOf(Logger);
      expect(a).not.toBe(b);
    });

    it('should create a new instance via fluent API', () => {
      container.register(Logger).toClass(Logger);

      const a = container.resolve(Logger);
      const b = container.resolve(Logger);

      expect(a).not.toBe(b);
    });
  });

  describe('singleton registration', () => {
    it('should return the same instance on each resolve', () => {
      container.registerSingleton(Logger, Logger);

      const a = container.resolve(Logger);
      const b = container.resolve(Logger);

      expect(a).toBe(b);
    });

    it('should return the same instance via fluent API', () => {
      container.register(Logger).toSingleton(Logger);

      const a = container.resolve(Logger);
      const b = container.resolve(Logger);

      expect(a).toBe(b);
    });
  });

  describe('auto-injection via @Injectable', () => {
    it('should resolve constructor dependencies automatically', () => {
      container.registerSingleton(Logger, Logger);
      container.registerSingleton(Database, Database);

      const db = container.resolve(Database);

      expect(db).toBeInstanceOf(Database);
      expect(db.logger).toBeInstanceOf(Logger);
    });

    it('should resolve a deep dependency chain', () => {
      container.registerSingleton(Logger, Logger);
      container.registerSingleton(Database, Database);
      container.registerClass(UserService, UserService);

      const userService = container.resolve(UserService);

      expect(userService).toBeInstanceOf(UserService);
      expect(userService.database).toBeInstanceOf(Database);
      expect(userService.database.logger).toBeInstanceOf(Logger);
    });
  });

  describe('@Inject token override', () => {
    it('should use the explicit token for the decorated parameter', () => {
      container.registerSingleton(Logger, Logger);
      container.registerValue(API_URL, 'https://injected.example.com');
      container.registerClass(ApiClient, ApiClient);

      const client = container.resolve(ApiClient);

      expect(client.logger).toBeInstanceOf(Logger);
      expect(client.apiUrl).toBe('https://injected.example.com');
    });
  });

  describe('child containers', () => {
    it('should resolve from parent when not overridden', () => {
      container.registerSingleton(Logger, Logger);
      const child = container.createChild();

      const logger = child.resolve(Logger);

      expect(logger).toBeInstanceOf(Logger);
    });

    it('should override parent registration in child', () => {
      container.registerSingleton(Logger, Logger);
      const parentLogger = container.resolve(Logger);

      const child = container.createChild();
      child.registerSingleton(Logger, Logger);
      const childLogger = child.resolve(Logger);

      expect(parentLogger).not.toBe(childLogger);
    });

    it('should not affect parent when registering in child', () => {
      const child = container.createChild();
      child.registerValue(API_URL, 'child-only');

      expect(child.resolve(API_URL)).toBe('child-only');
      expect(() => container.resolve(API_URL)).toThrow(/No provider registered/);
    });
  });

  describe('error handling', () => {
    it('should throw when no provider is registered', () => {
      expect(() => container.resolve(Logger)).toThrow(/No provider registered for Logger/);
    });

    it('should throw on circular dependencies', () => {
      const TOKEN_A = new InjectionToken<unknown>('A');
      const TOKEN_B = new InjectionToken<unknown>('B');

      @Injectable()
      class ServiceA {
        constructor(@Inject(TOKEN_B) public b: unknown) {}
      }

      @Injectable()
      class ServiceB {
        constructor(@Inject(TOKEN_A) public a: unknown) {}
      }

      container.registerClass(TOKEN_A, ServiceA as never);
      container.registerClass(TOKEN_B, ServiceB as never);

      expect(() => container.resolve(TOKEN_A)).toThrow(/Circular dependency detected/);
    });
  });

  describe('has()', () => {
    it('should return true for registered tokens', () => {
      container.registerValue(API_URL, 'test');

      expect(container.has(API_URL)).toBe(true);
      expect(container.has(Logger)).toBe(false);
    });

    it('should check parent container', () => {
      container.registerValue(API_URL, 'test');
      const child = container.createChild();

      expect(child.has(API_URL)).toBe(true);
    });
  });

  describe('clear()', () => {
    it('should remove all registrations and singletons', () => {
      container.registerSingleton(Logger, Logger);
      container.resolve(Logger);

      container.clear();

      expect(container.has(Logger)).toBe(false);
      expect(() => container.resolve(Logger)).toThrow(/No provider registered/);
    });
  });
});
