/**
 * Base LitElement component with common utilities
 */
import { LitElement, html, css } from 'lit';

export class BaseComponent extends LitElement {
  static styles = css`
    :host {
      display: block;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    this.onConnect?.();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.onDisconnect?.();
    this.onDestroy?.();
  }

  /**
   * Escape HTML special characters
   */
  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Debounce function
   */
  debounce(fn, delay) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }
}

export { html, css };
