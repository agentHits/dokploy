import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { api } from "@/utils/api";

const UPDATABLE_COMPONENTS = [
	"docker",
	"traefik",
	"rclone",
	"nixpacks",
	"railpack",
	"buildpacks",
] as const;

type UpdatableComponent = (typeof UPDATABLE_COMPONENTS)[number];

const UPDATE_DONE = "Components update finished ✅";
const UPDATE_FAILED = "Components update failed ❌";

const isUpdatable = (name: string): name is UpdatableComponent =>
	(UPDATABLE_COMPONENTS as readonly string[]).includes(name);

interface Props {
	serverId: string;
}

export const ServerComponentsUpdate = ({ serverId }: Props) => {
	const [isOpen, setIsOpen] = useState(false);
	const [isUpdating, setIsUpdating] = useState(false);
	const [selected, setSelected] = useState<UpdatableComponent[]>([]);
	const [logs, setLogs] = useState("");

	const { data, isPending, isError, error, refetch } =
		api.server.components.useQuery(
			{ serverId },
			{
				enabled: !!serverId,
				refetchInterval: 10 * 60 * 1000,
				refetchOnWindowFocus: false,
			},
		);

	const outdated = data?.filter((component) => component.outdated) ?? [];
	const updatable = outdated
		.map((component) => component.name)
		.filter(isUpdatable);
	const hasUpdates = outdated.length > 0;

	api.server.updateComponentsWithLogs.useSubscription(
		{ serverId, components: selected },
		{
			enabled: isUpdating,
			onData(log) {
				setLogs((prev) => `${prev}${log}`);
				if (log.includes(UPDATE_DONE) || log.includes(UPDATE_FAILED)) {
					setIsUpdating(false);
					if (log.includes(UPDATE_DONE)) {
						toast.success("Server components updated");
					} else {
						toast.error("Component update failed, see the log");
					}
					void refetch();
				}
			},
			onError(err) {
				setLogs((prev) => `${prev}${err.message}\n`);
				setIsUpdating(false);
				toast.error("Component update failed");
			},
		},
	);

	const startUpdate = () => {
		setLogs("");
		setSelected(updatable);
		setIsUpdating(true);
	};

	return (
		<Dialog open={isOpen} onOpenChange={setIsOpen}>
			<DialogTrigger asChild>
				<Button
					variant={hasUpdates ? "default" : "outline"}
					size="sm"
					className={cn(
						"w-full cursor-pointer",
						hasUpdates && "bg-amber-500 text-black hover:bg-amber-400",
					)}
				>
					<RefreshCw className="size-4" />
					{hasUpdates ? `Update (${outdated.length})` : "Components"}
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<RefreshCw className="size-5" /> Server components
					</DialogTitle>
					<DialogDescription>
						Versions installed on this server compared with the versions pinned
						in Dokploy.
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-2 pt-2">
					{isPending && (
						<div className="flex items-center gap-2 text-sm text-muted-foreground">
							<Loader2 className="size-4 animate-spin" /> Checking versions...
						</div>
					)}
					{isError && (
						<p className="text-sm text-destructive">{error.message}</p>
					)}
					{data?.map((component) => (
						<div
							key={component.name}
							className="flex items-center justify-between gap-3 text-sm"
						>
							<span className="w-24 font-medium capitalize">
								{component.name}
							</span>
							<span className="flex-1 text-muted-foreground">
								installed: {component.installed ?? "not found"}
							</span>
							<span className="flex-1 text-muted-foreground">
								target: {component.target ?? "not pinned"}
							</span>
							{component.outdated ? (
								<AlertTriangle className="size-4 text-amber-500" />
							) : (
								<CheckCircle2 className="size-4 text-green-500" />
							)}
						</div>
					))}
				</div>

				{updatable.includes("docker") && (
					<p className="text-xs text-muted-foreground">
						Docker is upgraded and its daemon restarts. Containers with a
						restart policy restart, and swarm services are briefly unavailable.
					</p>
				)}

				{updatable.includes("traefik") && (
					<p className="text-xs text-muted-foreground">
						Traefik is recreated during the update. Services on this server are
						unreachable for a few seconds.
					</p>
				)}

				<Button
					disabled={isUpdating || updatable.length === 0}
					onClick={startUpdate}
					className="w-full"
				>
					{isUpdating && <Loader2 className="size-4 animate-spin" />}
					{updatable.length > 0
						? `Update ${updatable.length} component${updatable.length > 1 ? "s" : ""}`
						: "Everything is up to date"}
				</Button>

				{logs && (
					<pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">
						{logs}
					</pre>
				)}
			</DialogContent>
		</Dialog>
	);
};
