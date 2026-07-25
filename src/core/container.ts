/**
 * Dependency Injection Container
 * Provides services to the application with lazy initialization
 */

import type { CHMParser } from '../services/chmParser';

interface ContainerServices {
  chmParser: CHMParser | null;
  chmEntries: Map<string, unknown> | null;
}

class Container {
  private services: ContainerServices = {
    chmParser: null,
    chmEntries: null
  };

  private instances: Map<string, unknown> = new Map();
  private factories: Map<string, () => unknown> = new Map();

  registerSingleton<T>(token: string, factory: () => T): void {
    this.factories.set(token, factory);
  }

  registerTransient<T>(token: string, factory: () => T): void {
    this.factories.set(`transient:${token}`, factory);
  }

  resolve<T>(token: string): T {
    if (this.instances.has(token)) {
      return this.instances.get(token) as T;
    }

    if (this.factories.has(token)) {
      const instance = this.factories.get(token)!() as T;
      this.instances.set(token, instance);
      return instance;
    }

    const transientKey = `transient:${token}`;
    if (this.factories.has(transientKey)) {
      return this.factories.get(transientKey)!() as T;
    }

    throw new Error(`Service not registered: ${token}`);
  }

  has(token: string): boolean {
    return this.instances.has(token) || this.factories.has(token) || this.factories.has(`transient:${token}`);
  }

  clear(token: string): void {
    this.instances.delete(token);
  }

  clearAll(): void {
    this.instances.clear();
  }

  setCHMParser(parser: CHMParser | null): void {
    this.services.chmParser = parser;
    this.instances.set('chmParser', parser);
  }

  getCHMParser(): CHMParser | null {
    return this.services.chmParser;
  }

  setCHMEntries(entries: Map<string, unknown> | null): void {
    this.services.chmEntries = entries;
    this.instances.set('chmEntries', entries);
  }

  getCHMEntries(): Map<string, unknown> | null {
    return this.services.chmEntries;
  }
}

export const container = new Container();
