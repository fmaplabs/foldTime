import { createFileRoute, redirect } from "@tanstack/react-router";

import { SignInScreen } from "@/components/sign-in-screen";

export const Route = createFileRoute("/")({
	// Signed-in users go straight to the app; everyone else sees the landing
	// screen. `user` is resolved server-side in the root route's beforeLoad.
	beforeLoad: ({ context }) => {
		if (context.user) {
			throw redirect({ to: "/dashboard" });
		}
	},
	component: SignInScreen,
});
