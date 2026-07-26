/*
 * nav-rewriter.js — rewrite JS navigation calls to parent.__chmvNavigate(…).
 *
 * A small tokenizer that scans JS source and rewrites navigation patterns
 * (document.location = …, location.href = …, location.assign(…), etc.) to
 * parent.__chmvNavigate(…), while leaving string literals, comments, regex
 * literals, and property accesses (obj.location, location.hash) untouched.
 *
 * Why a tokenizer instead of a regex: a single regex can't tell whether
 * `location.href = "x"` is inside a string literal or a comment, can't
 * balance parentheses in the RHS (f("a","b") was truncated at the comma),
 * and treats `==` as an assignment. The tokenizer is ~60 lines and
 * handles all of these correctly.
 *
 * Extracted from renderer.js for testability — can now be unit-tested
 * directly without constructing a Renderer instance.
 */

'use strict';

/** The parent-side global the rewriter emits. Exported so renderer.js
 *  can use the same constant when defining the global on `window`. */
export const NAVIGATE_GLOBAL = '__chmvNavigate';

/* Identifier characters (ASCII only — JS allows Unicode ids but legacy
 * CHM scripts are ASCII). Used to check word boundaries. */
const isIdentChar = (c) =>
  (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c === '_' || c === '$';

/* Patterns that count as "navigation": when we see one of these as a
 * complete identifier (word-bounded, not preceded by `.`), the
 * following `= <expr>` or `(<expr>)` is rewritten. */
const NAV_KEYWORDS = new Set([
  'location', 'location.href', 'location.assign', 'location.replace',
  'document.location', 'document.location.href',
  'window.location', 'window.location.href',
  'this.location', 'this.location.href',
  'top.location', 'top.location.href',
  'self.location', 'self.location.href',
]);

/**
 * Scan JS source and rewrite navigation calls. Returns the rewritten source.
 * The rewriter is deliberately conservative: if in doubt, it leaves the
 * source unchanged rather than risk breaking legit code.
 */
export function rewriteScriptNav(src) {
  let out = '';
  let i = 0;
  const len = src.length;

  /* Read an identifier starting at i; return the identifier text or null. */
  const readIdent = (start) => {
    let j = start;
    while (j < len && isIdentChar(src[j])) j++;
    return j > start ? src.slice(start, j) : null;
  };

  /* Read a .property chain starting at i (i points at '.'); return the
   * full chain (e.g. "location.href") or just the base if no dot.
   * Stops at the first non-identifier char after a dot. */
  const readDotted = (base, start) => {
    let j = start;
    let chain = base;
    while (j < len && src[j] === '.') {
      const k = j + 1;
      const prop = readIdent(k);
      if (!prop) break;
      chain += '.' + prop;
      j = k + prop.length;
    }
    return { chain, end: j };
  };

  /* Read the RHS of an assignment, balancing parens/brackets/braces and
   * respecting string/comment context. Returns the RHS text (trimmed)
   * and the index after it (at the ; or newline or end). */
  const readRhs = (start) => {
    let j = start;
    let depth = 0;
    while (j < len) {
      const c = src[j];
      if (c === '"' || c === "'" || c === '`') {
        // skip string literal
        const q = c;
        j++;
        while (j < len && src[j] !== q) {
          if (src[j] === '\\') j += 2;
          else j++;
        }
        j++;
        continue;
      }
      if (c === '/' && src[j + 1] === '/') {
        while (j < len && src[j] !== '\n') j++;
        continue;
      }
      if (c === '/' && src[j + 1] === '*') {
        j += 2;
        while (j < len && !(src[j] === '*' && src[j + 1] === '/')) j++;
        j += 2;
        continue;
      }
      if (c === '(' || c === '[' || c === '{') { depth++; j++; continue; }
      if (c === ')' || c === ']' || c === '}') {
        if (depth === 0) break; // unbalanced — stop (shouldn't happen)
        depth--; j++; continue;
      }
      if (depth === 0 && (c === ';' || c === '\n' || c === ',')) break;
      j++;
    }
    return { text: src.slice(start, j).trim(), end: j };
  };

  while (i < len) {
    const c = src[i];

    /* line comment */
    if (c === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i);
      const stop = end < 0 ? len : end + 1;
      out += src.slice(i, stop);
      i = stop;
      continue;
    }
    /* block comment */
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? len : end + 2;
      out += src.slice(i, stop);
      i = stop;
      continue;
    }
    /* string literals (single, double, template) */
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      let j = i + 1;
      while (j < len && src[j] !== q) {
        if (src[j] === '\\') j += 2;
        else j++;
      }
      j++; // skip closing quote (or past end)
      out += src.slice(i, j);
      i = j;
      continue;
    }
    /* regex literal detection — tricky; only treat / as regex if the
     * previous non-ws token is an operator or opening paren. This is
     * a heuristic; getting it perfect requires a full JS parser. We
     * skip regex literals to avoid mis-parsing their contents. */
    if (c === '/') {
      // peek back to see if this / could be division
      let k = out.length - 1;
      while (k >= 0 && (out[k] === ' ' || out[k] === '\t')) k--;
      const prev = out[k];
      const isRegex = !prev || '=(,;:!&|?{}[]+-*%~^<>'.includes(prev) || prev === '\n';
      if (isRegex) {
        let j = i + 1;
        let inClass = false;
        while (j < len) {
          if (src[j] === '\\') { j += 2; continue; }
          if (src[j] === '[') inClass = true;
          else if (src[j] === ']') inClass = false;
          else if (src[j] === '/' && !inClass) { j++; break; }
          else if (src[j] === '\n') break; // unterminated
          j++;
        }
        // skip flags
        while (j < len && isIdentChar(src[j])) j++;
        out += src.slice(i, j);
        i = j;
        continue;
      }
    }

    /* identifier — check for navigation patterns */
    if (isIdentChar(c)) {
      const id = readIdent(i);
      if (!id) { out += c; i++; continue; }
      // check preceding char for `.` (property access) — skip if dotted
      let prevIdx = out.length - 1;
      while (prevIdx >= 0 && (out[prevIdx] === ' ' || out[prevIdx] === '\t')) prevIdx--;
      const precededByDot = out[prevIdx] === '.';

      const { chain, end } = readDotted(id, i + id.length);
      if (!precededByDot && NAV_KEYWORDS.has(chain)) {
        // skip whitespace
        let j = end;
        while (j < len && (src[j] === ' ' || src[j] === '\t')) j++;
        if (src[j] === '=' && src[j + 1] !== '=') {
          // assignment: location = <rhs>
          j++; // skip =
          while (j < len && (src[j] === ' ' || src[j] === '\t')) j++;
          const { text, end: rhsEnd } = readRhs(j);
          if (text) {
            out += `parent.${NAVIGATE_GLOBAL}(${text})`;
            i = rhsEnd;
            continue;
          }
        } else if (src[j] === '(') {
          // call: location.assign(<arg>)
          j++; // skip (
          while (j < len && (src[j] === ' ' || src[j] === '\t')) j++;
          const { text, end: argEnd } = readRhs(j);
          // skip the closing )
          let k = argEnd;
          while (k < len && (src[k] === ' ' || src[k] === '\t')) k++;
          if (src[k] === ')') k++;
          if (text) {
            out += `parent.${NAVIGATE_GLOBAL}(${text})`;
            i = k;
            continue;
          }
        }
      }
      // not a navigation pattern — emit the identifier + dotted chain as-is
      out += chain;
      i = end;
      continue;
    }

    /* any other character — emit as-is */
    out += c;
    i++;
  }
  return out;
}
