import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { Pencil, Plus } from "lucide-react";
import { useState } from "react";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { api, type Id } from "@/convex-api";
import { centsToInput, formatRate, inputToCents } from "@/lib/money";

export const Route = createFileRoute("/_app/clients")({ component: ClientsPage });

type ClientRow = {
	_id: Id<"clients">;
	name: string;
	email: string;
	rateCents?: number;
};

function ClientsPage() {
	const clients = useQuery(api.clients.list, {});
	const settings = useQuery(api.settings.get, {});
	const currency = settings?.currency ?? "usd";
	const archive = useMutation(api.clients.archive);

	// null = closed; "new" = create; a row = edit that client.
	const [editing, setEditing] = useState<ClientRow | "new" | null>(null);

	return (
		<div>
			<PageHeader title="Clients" description="People and companies you bill.">
				<Button size="sm" onClick={() => setEditing("new")}>
					<Plus /> New client
				</Button>
			</PageHeader>

			<Card className="p-0">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Name</TableHead>
							<TableHead>Email</TableHead>
							<TableHead>Rate</TableHead>
							<TableHead className="w-0" />
						</TableRow>
					</TableHeader>
					<TableBody>
						{clients === undefined ? (
							<TableRow>
								<TableCell colSpan={4} className="text-muted-foreground">
									Loading…
								</TableCell>
							</TableRow>
						) : clients.length === 0 ? (
							<TableRow>
								<TableCell colSpan={4} className="text-muted-foreground">
									No clients yet. Add one to start assigning projects.
								</TableCell>
							</TableRow>
						) : (
							clients.map((c) => (
								<TableRow key={c._id}>
									<TableCell className="font-medium">{c.name}</TableCell>
									<TableCell className="text-muted-foreground">
										{c.email}
									</TableCell>
									<TableCell>
										{c.rateCents === undefined ? (
											<span className="text-muted-foreground">Default</span>
										) : (
											formatRate(c.rateCents, currency)
										)}
									</TableCell>
									<TableCell>
										<div className="flex justify-end gap-1">
											<Button
												variant="ghost"
												size="icon-sm"
												aria-label={`Edit ${c.name}`}
												onClick={() => setEditing(c)}
											>
												<Pencil />
											</Button>
											<Button
												variant="ghost"
												size="sm"
												onClick={() => archive({ id: c._id })}
											>
												Archive
											</Button>
										</div>
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</Card>

			{editing !== null ? (
				<ClientDialog
					client={editing === "new" ? null : editing}
					onClose={() => setEditing(null)}
				/>
			) : null}
		</div>
	);
}

function ClientDialog({
	client,
	onClose,
}: {
	client: ClientRow | null;
	onClose: () => void;
}) {
	const create = useMutation(api.clients.create);
	const update = useMutation(api.clients.update);
	const [name, setName] = useState(client?.name ?? "");
	const [email, setEmail] = useState(client?.email ?? "");
	const [rate, setRate] = useState(centsToInput(client?.rateCents));
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function onSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		if (name.trim() === "" || email.trim() === "") {
			setError("Name and email are required.");
			return;
		}
		const rateCents = inputToCents(rate);
		setSaving(true);
		try {
			if (client) {
				await update({
					id: client._id,
					name,
					email,
					// blank clears the override
					rateCents: rateCents ?? null,
				});
			} else {
				await create({ name, email, rateCents });
			}
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to save.");
			setSaving(false);
		}
	}

	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{client ? "Edit client" : "New client"}</DialogTitle>
				</DialogHeader>
				<form onSubmit={onSubmit} className="flex flex-col gap-4">
					<div className="flex flex-col gap-2">
						<Label htmlFor="client-name">Name</Label>
						<Input
							id="client-name"
							value={name}
							onChange={(e) => setName(e.target.value)}
							autoFocus
						/>
					</div>
					<div className="flex flex-col gap-2">
						<Label htmlFor="client-email">Email</Label>
						<Input
							id="client-email"
							type="email"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
						/>
					</div>
					<div className="flex flex-col gap-2">
						<Label htmlFor="client-rate">Hourly rate (optional)</Label>
						<Input
							id="client-rate"
							inputMode="decimal"
							placeholder="Falls back to the global default"
							value={rate}
							onChange={(e) => setRate(e.target.value)}
						/>
					</div>
					{error ? (
						<p className="text-sm text-destructive" role="alert">
							{error}
						</p>
					) : null}
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={onClose}
							disabled={saving}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={saving}>
							{saving ? "Saving…" : "Save"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
