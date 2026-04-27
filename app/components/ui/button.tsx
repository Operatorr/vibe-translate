import { Slot } from '@radix-ui/react-slot'
import type { ButtonHTMLAttributes, PropsWithChildren } from 'react'

type ButtonProps = PropsWithChildren<
  ButtonHTMLAttributes<HTMLButtonElement> & {
    asChild?: boolean
    variant?: 'primary' | 'secondary' | 'icon'
  }
>

const variants = {
  primary: 'button-primary',
  secondary: 'button-secondary',
  icon: 'icon-button',
}

export function Button({ asChild, className, variant = 'primary', ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button'
  const classes = [variants[variant], className].filter(Boolean).join(' ')

  return <Comp className={classes} {...props} />
}
