/**
 * Renderer
 * Converts VNodes to actual DOM elements
 */

import type { VNode } from './Component';

type VNodeChild = string | number | boolean | null | undefined | VNode;

// Event types that need delegation
const EVENT_TYPES = new Set([
  'click', 'dblclick', 'mousedown', 'mouseup', 'mouseenter', 'mouseleave',
  'mousemove', 'mouseover', 'mouseout', 'contextmenu',
  'keydown', 'keyup', 'keypress',
  'focus', 'blur', 'input', 'change', 'submit', 'reset',
  'touchstart', 'touchmove', 'touchend', 'touchcancel',
  'scroll', 'wheel', 'resize'
]);

export class Renderer {
  private root: HTMLElement;
  
  constructor(root: HTMLElement) {
    this.root = root;
  }
  
  render(vnode: VNode | VNodeChild): void {
    // Clear current content
    while (this.root.firstChild) {
      this.root.removeChild(this.root.firstChild);
    }
    
    const result = this.createElement(vnode);
    if (result) {
      this.root.appendChild(result);
    }
  }
  
  private createElement(vnode: VNodeChild): Node | null {
    // Handle null/undefined/false
    if (vnode === null || vnode === undefined || vnode === false) {
      return null;
    }
    
    // Handle strings and numbers (text nodes)
    if (typeof vnode === 'string' || typeof vnode === 'number') {
      return document.createTextNode(String(vnode));
    }
    
    // Handle arrays (fragment)
    if (Array.isArray(vnode)) {
      const fragment = document.createDocumentFragment();
      for (const child of vnode) {
        const childNode = this.createElement(child);
        if (childNode) {
          fragment.appendChild(childNode);
        }
      }
      return fragment;
    }
    
    // Handle VNode
    if (typeof vnode !== 'object' || !('type' in vnode)) {
      return null;
    }
    
    const vnodeObj = vnode as VNode;
    const { type, props, children } = vnodeObj;
    
    // Handle components (functions)
    if (typeof type === 'function') {
      const componentProps = { ...props };
      if (children) {
        componentProps.children = children;
      }
      
      const result = (type as (props: Record<string, unknown>) => VNodeChild)(componentProps);
      return this.createElement(result);
    }
    
    // Create DOM element
    const tagType = type as string;
    const element = tagType === 'svg' || tagType === 'path' || tagType === 'line' || 
                    tagType === 'polyline' || tagType === 'circle' || tagType === 'rect' ||
                    tagType === 'g' || tagType === 'defs' || tagType === 'style'
      ? document.createElementNS('http://www.w3.org/2000/svg', tagType)
      : document.createElement(tagType);
    
    // Set attributes and event listeners
    if (props) {
      for (const [key, value] of Object.entries(props)) {
        if (key === 'children' || key === 'key') continue;
        
        if (key === 'className') {
          (element as HTMLElement).className = String(value);
        } else if (key === 'style' && typeof value === 'object') {
          Object.assign((element as HTMLElement).style, value);
        } else if (key.startsWith('on') && EVENT_TYPES.has(key.slice(2).toLowerCase())) {
          // Event handler
          const eventType = key.slice(2).toLowerCase();
          element.addEventListener(eventType, value as EventListener);
        } else if (key === 'innerHTML') {
          (element as HTMLElement).innerHTML = String(value);
        } else if (value !== null && value !== undefined && value !== false) {
          element.setAttribute(key, String(value));
        }
      }
    }
    
    // Append children
    this.appendChildren(element, children);
    
    return element;
  }
  
  private appendChildren(parent: Node, children?: VNodeChild | VNodeChild[]): void {
    if (!children) return;
    
    // Handle array of children
    if (Array.isArray(children)) {
      for (const child of children) {
        const childNode = this.createElement(child);
        if (childNode) {
          parent.appendChild(childNode);
        }
      }
      return;
    }
    
    // Handle single child
    const childNode = this.createElement(children);
    if (childNode) {
      parent.appendChild(childNode);
    }
  }
  
  unmount(): void {
    while (this.root.firstChild) {
      this.root.removeChild(this.root.firstChild);
    }
  }
}

// Helper to create ref attribute
export function ref(key: string): { ref: string } {
  return { ref: key };
}

// Helper to create event handler attribute
export function on(eventType: string, handler: EventListener): Record<string, unknown> {
  return { [`on${eventType}`]: handler };
}
