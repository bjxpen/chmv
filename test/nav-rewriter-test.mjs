// Direct unit tests for the extracted nav-rewriter module.
// These test the tokenizer without needing a Renderer instance.
import { rewriteScriptNav, NAVIGATE_GLOBAL } from '../src/reader/nav-rewriter.js';
import { makeAsserter } from './helpers.mjs';

const { ok, done } = makeAsserter('nav-rewriter unit tests');

ok(NAVIGATE_GLOBAL === '__chmvNavigate', 'NAVIGATE_GLOBAL exported');

const nr = rewriteScriptNav;

/* assignment forms */
ok(nr('document.location = "x";') === `parent.${NAVIGATE_GLOBAL}("x");`,
  'document.location assign');
ok(nr('document.location.href = "x";') === `parent.${NAVIGATE_GLOBAL}("x");`,
  'document.location.href assign');
ok(nr('location.href = "x";') === `parent.${NAVIGATE_GLOBAL}("x");`,
  'location.href assign');
ok(nr('location = "x";') === `parent.${NAVIGATE_GLOBAL}("x");`,
  'bare location assign');
ok(nr('this.location = "x";') === `parent.${NAVIGATE_GLOBAL}("x");`,
  'this.location assign');
ok(nr('window.location = "x";') === `parent.${NAVIGATE_GLOBAL}("x");`,
  'window.location assign');
ok(nr('top.location = "x";') === `parent.${NAVIGATE_GLOBAL}("x");`,
  'top.location assign');
ok(nr('self.location = "x";') === `parent.${NAVIGATE_GLOBAL}("x");`,
  'self.location assign');

/* call forms */
ok(nr('location.assign("x");') === `parent.${NAVIGATE_GLOBAL}("x");`,
  'location.assign call');
ok(nr('location.replace("x");') === `parent.${NAVIGATE_GLOBAL}("x");`,
  'location.replace call');

/* == / === must NOT be rewritten */
ok(nr('if (location.href == "x") {}') === 'if (location.href == "x") {}',
  '== not treated as assign');
ok(nr('if (location.href === "x") {}') === 'if (location.href === "x") {}',
  '=== not treated as assign');

/* function-call RHS with commas preserved */
ok(nr('location.href = f("a","b");') === `parent.${NAVIGATE_GLOBAL}(f("a","b"));`,
  'function-call RHS with commas');

/* string literal contents not rewritten */
ok(nr('var s = "location.href = \'x\'";') === 'var s = "location.href = \'x\'";',
  'string literal not rewritten');

/* comments not rewritten */
ok(nr('// location.href = "x";\n') === '// location.href = "x";\n',
  'line comment not rewritten');
ok(nr('/* location.href = "x"; */') === '/* location.href = "x"; */',
  'block comment not rewritten');

/* property access not rewritten */
ok(nr('obj.location = "x";') === 'obj.location = "x";',
  'obj.location not rewritten');
ok(nr('location.hash = "#foo";') === 'location.hash = "#foo";',
  'location.hash not rewritten');
ok(nr('location.search = "?x";') === 'location.search = "?x";',
  'location.search not rewritten');

/* multiple on one line */
ok(nr('location.href="a";location.href="b";') ===
   `parent.${NAVIGATE_GLOBAL}("a");parent.${NAVIGATE_GLOBAL}("b");`,
  'multiple assigns on one line');

/* concatenation RHS */
ok(nr('location.href = "a" + "b";') === `parent.${NAVIGATE_GLOBAL}("a" + "b");`,
  'concatenation RHS');

/* real novel.chm patterns */
ok(nr('document.location = url;') === `parent.${NAVIGATE_GLOBAL}(url);`,
  'novel: document.location = url');
ok(nr('document.location = "index.htm";') === `parent.${NAVIGATE_GLOBAL}("index.htm");`,
  'novel: document.location = "index.htm"');

done();
process.exit(process.exitCode || 0);
