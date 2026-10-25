import config from './playwright.config'
import { defineConfig } from '@playwright/test'

export default defineConfig({
  ...config,
  projects: (config.projects ?? []).map(project => ({
    ...project,
    use: { ...project.use, channel: 'msedge' },
  })),
})
