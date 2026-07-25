/**
 * Dependency Injection Container
 * Manages application dependencies and their lifecycle
 */

export class DIContainer {
  constructor() {
    this.services = new Map();
    this.singletons = new Map();
  }

  register(name, factory) {
    this.services.set(name, factory);
  }

  registerSingleton(name, factory) {
    this.services.set(name, factory);
    this.singletons.set(name, null);
  }

  get(name) {
    if (this.singletons.has(name)) {
      if (!this.singletons.get(name)) {
        const factory = this.services.get(name);
        this.singletons.set(name, factory(this));
      }
      return this.singletons.get(name);
    }
    
    const factory = this.services.get(name);
    if (!factory) throw new Error(`Service not found: ${name}`);
    return factory(this);
  }

  has(name) {
    return this.services.has(name);
  }

  clear() {
    this.singletons.clear();
  }
}

export const di = new DIContainer();
