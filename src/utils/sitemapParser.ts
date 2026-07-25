export interface SitemapNode {
  name: string;
  local?: string; // relative path within the CHM container
  children?: SitemapNode[];
}

/**
 * Extracts param name and value pairs from a text/sitemap object.
 */
function parseObjectParams(obj: Element): Record<string, string> {
  const params: Record<string, string> = {};
  const paramElems = obj.getElementsByTagName('param');
  for (let i = 0; i < paramElems.length; i++) {
    const param = paramElems[i];
    const name = param.getAttribute('name') || '';
    const value = param.getAttribute('value') || '';
    if (name) {
      params[name.toLowerCase()] = value;
    }
  }
  return params;
}

/**
 * Parses Sitemap HTML string (.hhc or .hhk) into a structured nested node tree.
 */
export function parseSitemap(htmlString: string): SitemapNode[] {
  // 1. Sanitize HTML slightly to handle completely broken HTML elements
  // Some legacy .hhc files use unclosed <param> or odd tags.
  // Replacing "<param" with "<param />" can sometimes help, but DOMParser handles it anyway.

  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, 'text/html');
  const body = doc.body;

  // Let's recursively build the hierarchy by walking the DOM.
  return parseElementChildren(body);
}

function parseElementChildren(parent: Element): SitemapNode[] {
  const nodes: SitemapNode[] = [];
  const children = Array.from(parent.children);

  for (const child of children) {
    const tagName = child.tagName.toLowerCase();

    if (tagName === 'object') {
      const type = child.getAttribute('type') || '';
      if (type.toLowerCase() === 'text/sitemap' || type.toLowerCase() === 'text/site properties') {
        const params = parseObjectParams(child);
        if (params.name) {
          nodes.push({
            name: params.name,
            local: params.local || undefined,
            children: []
          });
        }
      }
    } else if (tagName === 'li') {
      // A list item can contain an <object> and a nested list <UL>/<OL>
      const objectElem = child.querySelector('object');
      let node: SitemapNode | null = null;

      if (objectElem) {
        const params = parseObjectParams(objectElem);
        if (params.name) {
          node = {
            name: params.name,
            local: params.local || undefined,
            children: []
          };
        }
      }

      // Check for nested UL/OL inside this LI
      const nestedUl = child.querySelector('ul, ol');
      if (nestedUl) {
        const childNodes = parseElementChildren(nestedUl);
        if (node) {
          node.children = childNodes;
        } else {
          nodes.push(...childNodes);
        }
      }

      if (node) {
        // If there's a subsequent sibling UL that is not inside the LI but belongs to this item
        const nextSibling = child.nextElementSibling;
        if (nextSibling && (nextSibling.tagName.toLowerCase() === 'ul' || nextSibling.tagName.toLowerCase() === 'ol')) {
          const siblingNodes = parseElementChildren(nextSibling);
          node.children = (node.children || []).concat(siblingNodes);
        }
        nodes.push(node);
      }
    } else if (tagName === 'ul' || tagName === 'ol') {
      // Process list children
      nodes.push(...parseElementChildren(child));
    } else {
      // Recursively parse children for other containers
      nodes.push(...parseElementChildren(child));
    }
  }

  // Deduplicate sibling list elements that might have been processed twice (e.g. nested lists)
  return nodes;
}

/**
 * Filter sitemap nodes based on a query string, returning a filtered copy of the tree.
 */
export function filterSitemap(nodes: SitemapNode[], query: string): SitemapNode[] {
  if (!query) return nodes;
  const lowerQuery = query.toLowerCase();

  return nodes
    .map(node => {
      const childrenFiltered = node.children ? filterSitemap(node.children, query) : undefined;
      const matchesSelf = node.name.toLowerCase().includes(lowerQuery);
      const matchesChildren = childrenFiltered && childrenFiltered.length > 0;

      if (matchesSelf || matchesChildren) {
        return {
          ...node,
          children: childrenFiltered
        };
      }
      return null;
    })
    .filter((n): n is SitemapNode => n !== null);
}
