import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.js', 'test/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        // browser
        window: 'readonly', document: 'readonly', navigator: 'readonly',
        localStorage: 'readonly', indexedDB: 'readonly', crypto: 'readonly',
        URL: 'readonly', Blob: 'readonly', File: 'readonly',
        TextDecoder: 'readonly', TextEncoder: 'readonly',
        DOMParser: 'readonly', NodeFilter: 'readonly', CSS: 'readonly',
        Worker: 'readonly', FileReaderSync: 'readonly',
        requestAnimationFrame: 'readonly', setTimeout: 'readonly',
        clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
        console: 'readonly', self: 'readonly', location: 'readonly',
        // node (tests)
        process: 'readonly', Buffer: 'readonly', globalThis: 'writable',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
];
