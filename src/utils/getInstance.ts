type Class<T = any> = new () => T;

/**
 * Create a new instance of class with properties of that class.
 */
export function getInstance<T>(cls: Class<T>, args?: Partial<T>): T {
  const instance = new cls();

  if (args) {
    Object.assign(instance as object, args);
  }

  return instance;
}
