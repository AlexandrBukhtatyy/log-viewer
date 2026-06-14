// Conventional Commits enforcement (CONTRIBUTING.md → "Стиль коммитов").
// Extends config-conventional, but widens type-enum with `deps` — the project
// uses it for dependency bumps (release-please maps it to a CHANGELOG section),
// and config-conventional does not ship that type.
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'perf',
        'refactor',
        'docs',
        'deps',
        'build',
        'ci',
        'chore',
        'test',
        'style',
        'revert',
      ],
    ],
  },
};
