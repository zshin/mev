import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[10px] tracking-[0.16em] uppercase",
  {
    variants: {
      variant: {
        paper: "border-amber/40 bg-amber/10 text-amber",
        live: "border-mint/30 bg-mint/10 text-mint",
        idle: "border-white/15 bg-white/5 text-white/60",
      },
    },
    defaultVariants: {
      variant: "paper",
    },
  },
);

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant, className }))} {...props} />;
}

export { Badge, badgeVariants };
