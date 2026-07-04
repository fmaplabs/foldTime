import { ChevronDown } from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

// A styled native <select>. Native (rather than a Radix listbox) keeps
// keyboard/mobile accessibility for free — enough for the small option sets
// here (currency, client assignment).
function Select({ className, children, ...props }: React.ComponentProps<"select">) {
	return (
		<div className="relative">
			<select
				data-slot="select"
				className={cn(
					"flex h-9 w-full appearance-none rounded-md border border-input bg-background py-1 pl-3 pr-8 text-sm shadow-xs transition-colors outline-none",
					"focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
					"disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
					"aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
					"dark:bg-input/30",
					className,
				)}
				{...props}
			>
				{children}
			</select>
			<ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
		</div>
	);
}

export { Select };
