import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useAuth } from "@workos/authkit-tanstack-react-start/client";

import { AppShell } from "@/components/app-shell";

export const Route = createFileRoute("/_app")({
	// `user` is resolved in the root route's beforeLoad. Guard the whole app
	// section here so every child page can assume an authenticated user.
	beforeLoad: ({ context }) => {
		if (!context.user) {
			throw redirect({ to: "/" });
		}
	},
	component: AppLayout,
});

function AppLayout() {
	const { user } = Route.useRouteContext();
	const { signOut } = useAuth();
	return (
		<AppShell email={user?.email} onSignOut={() => signOut()}>
			<Outlet />
		</AppShell>
	);
}
