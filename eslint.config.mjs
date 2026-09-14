// Config ESLint du dépôt : garde-fou `no-undef` (référence non définie). C'est ce contrôle qui
// attrape les erreurs que `node --check` laisse passer — une variable/fonction jamais définie
// n'est visible qu'à l'exécution du navigateur, où la page a déjà planté (cf. BUG-075).
const NAV = ['window', 'document', 'localStorage', 'sessionStorage', 'fetch', 'console', 'navigator',
  'location', 'history', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'requestAnimationFrame', 'cancelAnimationFrame', 'Chart', 'URL', 'URLSearchParams', 'AbortSignal',
  'AbortController', 'crypto', 'TextEncoder', 'TextDecoder', 'atob', 'btoa', 'performance',
  'getComputedStyle', 'Intl', 'HashChangeEvent', 'Event', 'MouseEvent', 'CustomEvent', 'KeyboardEvent',
  'alert', 'confirm', 'Blob', 'FileReader', 'Image', 'caches', 'self', 'ResizeObserver',
  'IntersectionObserver', 'MutationObserver', 'matchMedia', 'structuredClone', 'queueMicrotask',
  'HTMLElement', 'Node', 'DOMParser', 'Response', 'Request', 'Headers', 'FormData', 'screen', 'CSS'];
const NODE = ['process', 'Buffer', 'globalThis', '__dirname', '__filename', 'require', 'module',
  'exports', 'console'];
const globals = Object.fromEntries([...NAV, ...NODE].map((g) => [g, 'readonly']));

export default [
  {
    files: ['js/**/*.js', 'scripts/**/*.mjs', 'generate_snapshot.mjs', 'tests/**/*.js', 'tests/**/*.cjs'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals },
    rules: { 'no-undef': 'error', 'no-unused-vars': 'off' },
  },
];
