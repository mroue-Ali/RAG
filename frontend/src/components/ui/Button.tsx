import type { ComponentProps } from 'react'
import { buttonClass } from './buttonStyles'
import type { ButtonSize, ButtonVariant } from './buttonStyles'

interface ButtonProps extends ComponentProps<'button'> {
  variant?: ButtonVariant
  size?: ButtonSize
}

export function Button({ variant = 'secondary', size = 'md', className, ...props }: ButtonProps) {
  return <button type="button" className={buttonClass(variant, size, className)} {...props} />
}

/** A square button that shows only an icon. `label` is what screen readers and the tooltip say. */
export function IconButton({ label, className, ...props }: ButtonProps & { label: string }) {
  return (
    <Button variant="ghost" size="icon" aria-label={label} title={label} className={className} {...props} />
  )
}
