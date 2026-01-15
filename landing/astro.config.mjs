import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://devmux-landing.pages.dev',
  integrations: [
    starlight({
      title: 'devmux',
      description: 'tmux-based service management for monorepos. Shared awareness between humans and AI agents.',
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/hassoncs/devmux' },
      ],
      customCss: [
        './src/styles/theme.css',
        './src/styles/terminal.css',
      ],
      head: [
        {
          tag: 'meta',
          attrs: {
            name: 'theme-color',
            content: '#0a0a0c',
          },
        },
      ],
      sidebar: [
        {
          label: 'Start Here',
          items: [
            { label: 'Getting Started', slug: 'getting-started' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Configuration', slug: 'guides/configuration' },
            { label: 'AI Agent Integration', slug: 'guides/ai-agents' },
            { label: 'Turbo.json Discovery', slug: 'guides/turbo' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Commands', slug: 'reference/commands' },
            { label: 'Config File', slug: 'reference/config' },
            { label: 'Programmatic API', slug: 'reference/api' },
          ],
        },
      ],
    }),
  ],
});
