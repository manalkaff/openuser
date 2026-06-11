// @ts-check
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  {
    // packages/ui/vite.config.ts is included by the .svelte-kit tsconfig (projectService)
    // AND would match 'packages/*/*.config.ts' in allowDefaultProject, causing a conflict.
    // Exclude it from ESLint to avoid the "included by allowDefaultProject but also found
    // in project service" parsing error.
    ignores: ['**/dist/**', '**/.svelte-kit/**', '**/build/**', 'node_modules/**', 'packages/ui/vite.config.ts'],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        projectService: {
          allowDefaultProject: ['*.js', '*.mjs', '*.cjs', 'packages/*/src/*.test.ts', 'packages/*/tests/integration/*.test.ts', 'packages/*/tests/*.test.ts', 'packages/*/vitest.config.ts', 'packages/*/*.config.ts'],
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 20,
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs['recommended'].rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Test files may import symbols purely to verify they are exported (smoke-test imports).
    // Unused imports are allowed in test files as they serve as export-existence smoke tests.
    files: ['**/*.test.ts', '**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
];
