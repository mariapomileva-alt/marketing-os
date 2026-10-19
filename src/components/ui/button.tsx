import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius-control)] text-[13px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-green text-white hover:bg-green-hover",
        secondary: "border border-line-strong bg-surface text-ink hover:bg-sage-tint",
        ghost: "text-ink hover:bg-sage-tint",
        danger: "border border-red/30 bg-surface text-red hover:bg-red-tint",
      },
      size: { sm: "h-7 px-2.5", md: "h-8 px-3", lg: "h-10 px-4 text-[14px]" },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
