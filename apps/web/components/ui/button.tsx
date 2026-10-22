import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[background-color,color,box-shadow,transform] duration-150 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:scale-[0.98] select-none",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-fg shadow-sm hover:bg-primary-hover",
        secondary: "bg-surface-2 text-text hover:bg-surface-3 border border-border",
        outline: "border border-border bg-transparent hover:bg-surface-2 text-text",
        ghost: "hover:bg-surface-2 text-text-secondary hover:text-text",
        destructive: "bg-error text-white hover:brightness-110",
        link: "text-primary underline-offset-4 hover:underline",
        subtle: "bg-primary-soft text-primary hover:brightness-95 dark:hover:brightness-125",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        xs: "h-7 rounded-md px-2 text-xs",
        lg: "h-11 rounded-lg px-6 text-base",
        icon: "size-9",
        "icon-sm": "size-8",
        "icon-xs": "size-7",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild = false, loading, children, disabled, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  if (asChild) {
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props}>
        {children}
      </Comp>
    );
  }
  return (
    <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} disabled={disabled || loading} {...props}>
      {loading ? <Loader2 className="animate-spin" /> : null}
      {children}
    </Comp>
  );
});
Button.displayName = "Button";

export { Button, buttonVariants };
