import { Link } from "@tanstack/react-router";
import type * as React from "react";

import { Button } from "@/components/ui/button";

const NAV = [
	{ to: "/dashboard", label: "Dashboard" },
	{ to: "/clients", label: "Clients" },
	{ to: "/projects", label: "Projects" },
	{ to: "/invoices", label: "Invoices" },
	{ to: "/settings", label: "Settings" },
] as const;

export function AppShell({
	email,
	onSignOut,
	children,
}: {
	email?: string;
	onSignOut: () => void;
	children: React.ReactNode;
}) {
	return (
		<div className="min-h-svh bg-background">
			<header className="border-b">
				<div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3">
					<div className="flex items-center gap-6">
						<span className="font-heading text-lg font-semibold tracking-tight">
							ledger
						</span>
						<nav className="flex items-center gap-1">
							{NAV.map((item) => (
								<Link
									key={item.to}
									to={item.to}
									className="rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
									activeProps={{ className: "bg-muted text-foreground" }}
									inactiveProps={{
										className:
											"text-muted-foreground hover:bg-muted hover:text-foreground",
									}}
								>
									{item.label}
								</Link>
							))}
						</nav>
					</div>
					<div className="flex items-center gap-3">
						{email ? (
							<span className="text-sm text-muted-foreground">{email}</span>
						) : null}
						<Button variant="outline" size="sm" onClick={onSignOut}>
							Sign out
						</Button>
					</div>
				</div>
			</header>
			<main className="mx-auto max-w-6xl p-6">{children}</main>
		</div>
	);
}
