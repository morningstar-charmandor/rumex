import type { ComponentProps } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn } from 'storybook/test'
import type { WorkContext } from '../../../shared/types'
import {
  zeroheightPages,
  zeroheightParameters
} from '../../../../.storybook/zeroheight'
import Settings from './Settings'

const contexts: WorkContext[] = [
  {
    id: 'personal',
    name: 'Personal',
    color: '#f97316',
    icon: 'P',
    apps: []
  },
  {
    id: 'office',
    name: 'Office',
    color: '#3b82f6',
    icon: 'O',
    apps: []
  }
]

const meta = {
  component: Settings,
  tags: ['ai-generated'],
  parameters: {
    ...zeroheightParameters(zeroheightPages.settings)
  },
  args: {
    theme: 'light',
    onSetTheme: fn(),
    sleepAfterMinutes: 15,
    onSetSleepAfter: fn(),
    openAtLogin: false,
    onSetOpenAtLogin: fn(),
    appIconTheme: 'dark',
    onSetAppIconTheme: fn(),
    notchSwitcher: false,
    onSetNotchSwitcher: fn(),
    notchCompatibility: {
      supported: true,
      reason: 'supported'
    },
    contexts,
    appVersion: '0.2.0',
    onCheckUpdate: fn(),
    onOpenExternal: fn(),
    onClose: fn()
  } as ComponentProps<typeof Settings>
} satisfies Meta<typeof Settings>

export default meta
type Story = StoryObj<typeof meta>

export const General: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Dark' })).toHaveAttribute(
      'aria-label',
      'Dark'
    )
    await expect(canvas.getAllByRole('switch')[0]).toHaveAttribute(
      'aria-checked',
      'false'
    )
  }
}

export const Dark: Story = {
  globals: {
    theme: 'dark'
  },
  args: {
    theme: 'dark',
    openAtLogin: true
  }
}

export const CssCheck: Story = {
  play: async ({ canvas }) => {
    const closeButton = canvas.getByRole('button', { name: 'Close settings' })
    await expect(getComputedStyle(closeButton).width).toBe('28px')
  }
}
