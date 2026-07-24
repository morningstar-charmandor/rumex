import type { StorybookConfig } from '@storybook/react-vite';
import tailwindcss from '@tailwindcss/vite'

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
  addons: [
    '@storybook/addon-a11y',
    '@storybook/addon-docs',
    '@storybook/addon-vitest',
    '@storybook/addon-mcp',
    '@zeroheight/storybook-addon',
  ],
  framework: '@storybook/react-vite',
  async viteFinal(viteConfig) {
    viteConfig.plugins = [...(viteConfig.plugins ?? []), tailwindcss()]
    viteConfig.esbuild = {
      ...(typeof viteConfig.esbuild === 'object' ? viteConfig.esbuild : {}),
      jsx: 'automatic'
    }
    viteConfig.optimizeDeps = {
      ...viteConfig.optimizeDeps,
      include: [
        ...(viteConfig.optimizeDeps?.include ?? []),
        'react/jsx-dev-runtime'
      ]
    }

    return viteConfig
  }
};

export default config;
