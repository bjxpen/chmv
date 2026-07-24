/**
 * Declarative Component System
 * Simple VNode-based rendering
 */

export type VNodeChild = string | number | boolean | null | undefined | VNode;
export type VNodeChildren = VNodeChild[];

export interface VNode {
  type: string | Function;
  props: Record<string, unknown>;
  children?: VNodeChild | VNodeChildren;
  key?: string;
}

export interface ComponentProps {
  [key: string]: unknown;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFunction = (...args: any[]) => any;

// Create element function for JSX-like syntax
export function h(
  type: string | AnyFunction,
  props: Record<string, unknown> | null,
  ...children: unknown[]
): VNode {
  const finalProps: Record<string, unknown> = props || {};
  
  // Merge children into props
  if (children.length > 0) {
    const validChildren = children.filter(c => c !== false && c !== null && c !== undefined);
    finalProps.children = validChildren.length === 1 ? validChildren[0] : validChildren;
  }
  
  return { type, props: finalProps };
}

// Fragment helper
export function Fragment(props: ComponentProps): VNodeChildren {
  const children = props.children as VNodeChildren;
  if (Array.isArray(children)) {
    return children;
  }
  return children ? [children] : [];
}

// Conditional rendering helper
export function when(condition: boolean, component: VNodeChild): VNodeChild {
  return condition ? component : null;
}

// List rendering helper
export function each<T>(
  items: T[],
  renderFn: (item: T, index: number) => VNodeChild,
  keyExtractor?: (item: T, index: number) => string
): VNodeChildren {
  return items.map((item, index) => {
    const element = renderFn(item, index);
    if (element && typeof element === 'object' && 'type' in element) {
      (element as VNode).key = keyExtractor ? keyExtractor(item, index) : String(index);
    }
    return element;
  }).filter(c => c !== false && c !== null && c !== undefined) as VNodeChildren;
}

// Export null for convenience
export const NULL = null;
