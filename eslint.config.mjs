import antfu from '@antfu/eslint-config'

export default antfu(
  {
    typescript: true,
    react: true,
    test: false,
    ignores: ['.agents/**', '.codex/**'],
  },
  {
    rules: {
      'style/linebreak-style': ['error', 'unix'],
    },
  },
  {
    files: ['pnpm-workspace.yaml'],
    rules: {
      // 沿用平台默认 shell，避免格式修复重新写入终端配置。
      'pnpm/yaml-enforce-settings': ['error', {
        settings: {
          minimumReleaseAgeExcludePrune: true,
          trustPolicy: 'no-downgrade',
        },
        forbiddenFields: ['scriptShell', 'shellEmulator'],
      }],
    },
  },
)
