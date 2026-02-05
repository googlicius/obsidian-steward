import 'obsidian';

declare module 'obsidian' {
  /**
   * SecretStorage provides a secure way to store and manage sensitive data
   * like API keys and tokens in Obsidian plugins.
   * @since 1.11.4
   */
  interface SecretStorage {
    /**
     * Gets a secret from storage
     * @param id - The ID of the secret
     * @returns The secret value or null if not found
     */
    getSecret(id: string): string | null;

    /**
     * Lists all secrets in storage
     * @returns Array of secret IDs
     */
    listSecrets(): string[];

    /**
     * Sets a secret in the storage
     * @param id - The ID of the secret
     * @param secret - The secret value
     */
    setSecret(id: string, secret: string): void;
  }

  /**
   * SecretComponent provides a UI component for selecting secrets from SecretStorage
   */
  class SecretComponent {
    /**
     * Creates a new SecretComponent
     * @param app - The Obsidian App instance
     * @param containerEl - The container element to mount the component
     */
    constructor(app: App, containerEl: HTMLElement);

    /**
     * Set the current value (secret name)
     * @param value - The secret name
     * @returns This component for chaining
     */
    setValue(value: string): this;

    /**
     * Register a callback for when the value changes
     * @param callback - Called with the new secret name when changed
     * @returns This component for chaining
     */
    onChange(callback: (value: string) => void): this;
  }

  interface App {
    /**
     * SecretStorage API for storing and retrieving secrets
     */
    secretStorage: SecretStorage;
  }
}
