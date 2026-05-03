import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// Layer boundaries from ADR-0002 (headless architecture).
// Encoded as @typescript-eslint/no-restricted-imports rules per layer.
//
// Glob pattern note: matchers are applied to the literal import string. Relative
// paths like '../../hooks/use-log-window.ts' contain '/hooks/' as a segment, so
// '**/hooks/**' matches them. NPM specifiers (e.g. 'react') are matched as-is.

const FORBID_LAYER = (layers, message) => ({
  group: layers.flatMap((layer) => [`**/${layer}/**`, `**/${layer}`]),
  message,
})
const FORBID_PKG = (pkgs, message) => ({
  group: pkgs,
  message,
})

const RULES_CORE = {
  '@typescript-eslint/no-restricted-imports': [
    'error',
    {
      patterns: [
        FORBID_PKG(
          ['react', 'react-dom', 'react/*', 'react-dom/*', 'zustand', 'zustand/*', '@tanstack/*'],
          'core/ must remain framework-agnostic (ADR-0002).',
        ),
        FORBID_LAYER(
          ['hooks', 'ui', 'app', 'worker-client', 'workers'],
          'core/ cannot depend on UI, hooks, app, worker-client, or workers (ADR-0002).',
        ),
      ],
    },
  ],
}

const RULES_WORKERS = {
  '@typescript-eslint/no-restricted-imports': [
    'error',
    {
      patterns: [
        FORBID_PKG(
          ['react', 'react-dom', 'react/*', 'react-dom/*', 'zustand', 'zustand/*', '@tanstack/*'],
          'workers/ run in a Worker context — no React or main-thread UI deps (ADR-0003).',
        ),
        FORBID_LAYER(
          ['hooks', 'ui', 'app', 'worker-client'],
          'workers/ cannot depend on UI, hooks, app, or worker-client (ADR-0003).',
        ),
      ],
    },
  ],
}

const RULES_UI_COMPONENTS = {
  '@typescript-eslint/no-restricted-imports': [
    'error',
    {
      patterns: [
        FORBID_LAYER(
          ['hooks', 'workers', 'worker-client', 'app'],
          'ui/components/ must be prop-driven only — no hooks, workers, app, or worker-client (ADR-0002).',
        ),
        // core/ types ARE allowed (allowTypeImports) — UI consumes types like LogEntry/LogLevel.
        {
          group: ['**/core/**', '**/core'],
          message:
            'ui/components/ may only import *types* from core/ (allowTypeImports). For runtime helpers, lift to ui/utils/ or hooks/ (ADR-0002).',
          allowTypeImports: true,
        },
      ],
    },
  ],
}

const RULES_HOOKS = {
  '@typescript-eslint/no-restricted-imports': [
    'error',
    {
      patterns: [
        FORBID_LAYER(
          ['ui', 'workers'],
          'hooks/ talk to worker-client + core, never directly to ui or workers (ADR-0002).',
        ),
      ],
    },
  ],
}

const RULES_WORKER_CLIENT = {
  '@typescript-eslint/no-restricted-imports': [
    'error',
    {
      patterns: [
        FORBID_LAYER(
          ['ui', 'app', 'hooks'],
          'worker-client/ is main-thread infra below hooks — must not depend on UI/app/hooks (ADR-0002).',
        ),
        // workers/ — only types are allowed (RPC contracts come via core/rpc/).
        {
          group: ['**/workers/**'],
          message:
            'worker-client/ must reach into workers/ only via *type* imports (RPC contracts live in core/rpc/) — runtime crossing the worker boundary is the Worker API itself (ADR-0004).',
          allowTypeImports: true,
        },
      ],
    },
  ],
}

export default defineConfig([
  globalIgnores(['dist', 'dev-dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  // Layer rules — applied to non-test source files of each layer.
  {
    files: ['src/core/**/*.{ts,tsx}'],
    ignores: ['src/core/**/*.{test,spec}.{ts,tsx}'],
    rules: RULES_CORE,
  },
  {
    files: ['src/workers/**/*.{ts,tsx}'],
    ignores: ['src/workers/**/*.{test,spec}.{ts,tsx}'],
    rules: RULES_WORKERS,
  },
  {
    files: ['src/ui/components/**/*.{ts,tsx}'],
    ignores: ['src/ui/components/**/*.{test,spec}.{ts,tsx}'],
    rules: RULES_UI_COMPONENTS,
  },
  {
    files: ['src/hooks/**/*.{ts,tsx}'],
    ignores: ['src/hooks/**/*.{test,spec}.{ts,tsx}'],
    rules: RULES_HOOKS,
  },
  {
    files: ['src/worker-client/**/*.{ts,tsx}'],
    ignores: ['src/worker-client/**/*.{test,spec}.{ts,tsx}'],
    rules: RULES_WORKER_CLIENT,
  },
])
