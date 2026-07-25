/**
 * Renderer - Converts VNodes to DOM elements
 */

import type { VNode, VNodeChild, Props } from './vdom';

const EVENT_TYPES = new Set([
  'click', 'dblclick', 'mousedown', 'mouseup', 'mouseenter', 'mouseleave',
  'mousemove', 'mouseover', 'mouseout', 'contextmenu',
  'keydown', 'keyup', 'keypress',
  'focus', 'blur', 'input', 'change', 'submit', 'reset',
  'touchstart', 'touchmove', 'touchend', 'touchcancel',
  'scroll', 'wheel', 'resize'
]);

const SVG_ELEMENTS = new Set(['svg', 'path', 'line', 'polyline', 'circle', 'rect', 'g', 'defs', 'style', 'use']);

export class Renderer {
  private root: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  render(vnode: VNode | VNodeChild): void {
    while (this.root.firstChild) {
      this.root.removeChild(this.root.firstChild);
    }
    const node = this.createElement(vnode);
    if (node) {
      this.root.appendChild(node);
    }
  }

  private createElement(vnode: VNodeChild): Node | null {
    if (vnode === null || vnode === undefined || vnode === false) return null;
    if (typeof vnode === 'string' || typeof vnode === 'number') {
      return document.createTextNode(String(vnode));
    }
    if (Array.isArray(vnode)) {
      const fragment = document.createDocumentFragment();
      for (const child of vnode) {
        const node = this.createElement(child);
        if (node) fragment.appendChild(node);
      }
      return fragment;
    }
    if (typeof vnode !== 'object' || !('type' in vnode)) return null;

    const vnodeObj = vnode as VNode;
    const { type, props } = vnodeObj;
    // Children can be in props.children or directly on vnode
    const children = (props && 'children' in props) ? (props as any).children : vnodeObj.children;

    // Function component
    if (typeof type === 'function') {
      return this.createElement(type({ ...props, children }));
    }

    // DOM element
    const tagType = String(type);
    const isSVG = SVG_ELEMENTS.has(tagType);
    const el = isSVG 
      ? document.createElementNS('http://www.w3.org/2000/svg', tagType)
      : document.createElement(tagType);

    // Set attributes
    for (const [key, value] of Object.entries(props)) {
      if (key === 'children' || key === 'key' || value === undefined) continue;
      
      if (key === 'className') {
        (el as HTMLElement).className = String(value);
      } else if (key === 'style' && typeof value === 'object') {
        Object.assign((el as HTMLElement).style, value);
      } else if (key.startsWith('on') && EVENT_TYPES.has(key.slice(2).toLowerCase())) {
        el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
      } else if (key === 'innerHTML') {
        (el as HTMLElement).innerHTML = String(value);
      } else if (value !== null && value !== false) {
        el.setAttribute(key, String(value));
      }
    }

    // Children
    if (children) {
      this.appendChildren(el, children);
    }

    return el;
  }

  private appendChildren(parent: Node, children: VNodeChild | VNodeChild[]): void {
    if (!children) return;
    const items = Array.isArray(children) ? children : [children];
    for (const child of items) {
      const node = this.createElement(child);
      if (node) parent.appendChild(node);
    }
  }
}
