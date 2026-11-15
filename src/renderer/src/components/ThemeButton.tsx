import * as Menu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronDown, Moon, Sun } from 'lucide-react'
import { parseThemeChoice } from '@shared/theme'
import type { ThemeChoice } from '@shared/work'
import { useUi } from '@/store'
import { Hint, IconButton, cn, menuItem, menuPanel } from './ui'

const CHOICES: [ThemeChoice, string][] = [
  ['light', 'Light'],
  ['dark', 'Dark'],
  ['system', 'Use system settings']
]

/** Both icons stay in the tree and cross-fade (opacity, scale, blur) on the shared 150 ms curve; reduced motion drops the transition globally. */
const ICON = 'absolute inset-0 transition-[opacity,scale,filter] duration-150 ease-ui'
const SHOWN = 'scale-100 opacity-100 blur-[0px]'
const HIDDEN = 'scale-[0.25] opacity-0 blur-[4px]'

/**
 * One click flips light and dark; the chevron beside it opens Light, Dark and Use system settings. A split control, because a
 * single button can not both act on click and open a menu. The icon shows the theme on screen, the label the choice.
 */
export function ThemeButton() {
  const theme = useUi((s) => s.theme)
  const resolved = useUi((s) => s.resolvedTheme)
  const setTheme = useUi((s) => s.setTheme)
  const notify = useUi((s) => s.notify)
  const choose = (choice: ThemeChoice): void => void setTheme(choice).then((error) => error && notify(error, 'error'))

  return (
    <div className="flex items-center">
      <Hint label="Theme">
        <IconButton aria-label={`Theme: ${theme}`} onClick={() => choose(resolved === 'dark' ? 'light' : 'dark')}>
          <span data-keep-motion className="relative block size-4" aria-hidden>
            <Sun size={16} strokeWidth={1.75} className={cn(ICON, resolved === 'light' ? SHOWN : HIDDEN)} />
            <Moon size={16} strokeWidth={1.75} className={cn(ICON, resolved === 'dark' ? SHOWN : HIDDEN)} />
          </span>
        </IconButton>
      </Hint>
      <Menu.Root>
        <Menu.Trigger asChild>
          <button
            type="button"
            aria-label="Theme options"
            className="press flex h-8 w-6 items-center justify-center rounded-full text-muted hover:bg-active hover:text-ink data-[state=open]:bg-active data-[state=open]:text-ink"
          >
            <ChevronDown size={12} strokeWidth={1.75} aria-hidden />
          </button>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content align="end" sideOffset={6} className={menuPanel}>
            <Menu.RadioGroup value={theme} onValueChange={(v) => choose(parseThemeChoice(v) ?? 'system')}>
              {CHOICES.map(([value, text]) => (
                <Menu.RadioItem key={value} value={value} className={menuItem}>
                  {text}
                  <Menu.ItemIndicator className="ml-auto">
                    <Check size={14} strokeWidth={1.75} aria-hidden />
                  </Menu.ItemIndicator>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
    </div>
  )
}
