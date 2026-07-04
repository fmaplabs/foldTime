import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";

import { cn } from "@/lib/utils";

// Badges always carry a text label, so color is never the sole signal (WCAG
// 1.4.1). Each variant pairs a tinted surface with a high-contrast label that
// clears AA in both light and dark themes.
const badgeVariants = cva(
	"inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3 [&_svg]:pointer-events-none",
	{
		variants: {
			variant: {
				neutral: "bg-muted text-muted-foreground",
				success:
					"bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
				warning:
					"bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
				destructive:
					"bg-destructive/10 text-destructive dark:bg-destructive/20",
				info: "bg-primary text-primary-foreground",
			},
		},
		defaultVariants: { variant: "neutral" },
	},
);

function Badge({
	className,
	variant,
	asChild = false,
	...props
}: React.ComponentProps<"span"> &
	VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
	const Comp = asChild ? Slot.Root : "span";
	return (
		<Comp
			data-slot="badge"
			className={cn(badgeVariants({ variant }), className)}
			{...props}
		/>
	);
}

export { Badge, badgeVariants };
