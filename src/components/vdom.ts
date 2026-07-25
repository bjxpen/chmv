/**
 * Virtual DOM - Declarative component system
 * Minimal JSX-like rendering
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type VNodeChild = any;
export type VNodeChildren = VNodeChild[];

export interface VNode {
  type: string | ((props: Props) => VNodeChild);
  props: Props;
  children?: VNodeChild | VNodeChildren;
  key?: string;
}

export type Props = Record<string, unknown>;

// Create element
export function h(type: string | ((props: Props) => VNodeChild), props: Props | null, ...children: VNodeChild[]): VNode {
  const p: Props = props ? { ...props } : {};
  const flatChildren: VNodeChild[] = [];
  
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) {
      for (const c of child) {
        if (c !== null && c !== undefined && c !== false) {
          flatChildren.push(c);
        }
      }
    } else {
      flatChildren.push(child);
    }
  }
  
  if (flatChildren.length > 0) {
    p.children = flatChildren.length === 1 ? flatChildren[0] : flatChildren;
  }
  return { type, props: p };
}

// Fragment
export function Fragment({ children }: Props): VNodeChildren {
  if (Array.isArray(children)) return children;
  return children ? [children] : [];
}

// Conditional
export function when(condition: boolean, component: VNodeChild): VNodeChild {
  return condition ? component : null;
}

// List
export function each<T>(items: T[], render: (item: T, index: number) => VNodeChild, keyBy?: (item: T) => string): VNodeChildren {
  const result: VNodeChild[] = [];
  items.forEach((item, index) => {
    const element = render(item, index);
    if (element !== null && element !== undefined && element !== false) {
      if (Array.isArray(element)) {
        result.push(...element);
      } else {
        if (element && typeof element === 'object' && element.props) {
          element.key = keyBy ? keyBy(item) : String(index);
        }
        result.push(element);
      }
    }
  });
  return result;
}

// Switch/Match pattern
export function match<T extends string | number | symbol>(value: T, cases: Partial<Record<T, VNodeChild>>): VNodeChild {
  return cases[value] ?? null;
}
