import {
	AlertTriangle,
	CheckCircle2,
	HardDriveDownload,
	Loader2,
	RefreshCw,
	XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api } from "@/utils/api";
import {
	advanceUpdateProgress,
	createUpdateProgress,
	failUpdateProgress,
	isUpdateFinished,
	UPDATE_POLL_MS,
	type UpdateProgress,
	type UpdateProgressEvent,
} from "./update-progress";
import { UpdateStatusPanel } from "./update-status-panel";

type ServiceStatus = {
	status: "healthy" | "unhealthy";
	message?: string;
};

type HealthResult = {
	postgres: ServiceStatus;
	traefik: ServiceStatus;
};

const HEALTH_TIMEOUT_MS = 5000;

type ModalState = "idle" | "checking" | "results" | "updating";

const ServiceStatusItem = ({
	name,
	service,
}: {
	name: string;
	service: ServiceStatus;
}) => (
	<div className="flex items-center gap-2">
		{service.status === "healthy" ? (
			<CheckCircle2 className="h-4 w-4 text-green-500" />
		) : (
			<XCircle className="h-4 w-4 text-red-500" />
		)}
		<span className="text-sm font-medium">{name}</span>
		{service.status === "unhealthy" && service.message && (
			<span className="text-xs text-muted-foreground">— {service.message}</span>
		)}
	</div>
);

export const UpdateWebServer = ({
	buttonClassName,
	keepImages,
}: {
	buttonClassName?: string;
	keepImages?: number | null;
}) => {
	const [modalState, setModalState] = useState<ModalState>("idle");
	const [open, setOpen] = useState(false);
	const [healthResult, setHealthResult] = useState<HealthResult | null>(null);
	const [progress, setProgress] = useState<UpdateProgress | null>(null);
	const [now, setNow] = useState(() => Date.now());
	const unmountedRef = useRef(false);

	const utils = api.useUtils();
	const { mutateAsync: updateServer } = api.settings.updateServer.useMutation();
	const { refetch: checkHealth } =
		api.settings.checkInfrastructureHealth.useQuery(undefined, {
			enabled: false,
		});

	const handleVerify = async () => {
		setModalState("checking");
		setHealthResult(null);

		try {
			const result = await checkHealth();
			if (result.data) {
				setHealthResult(result.data);
			}
		} catch {
			// checkHealth failed entirely
		}
		setModalState("results");
	};

	const allHealthy =
		healthResult &&
		healthResult.postgres.status === "healthy" &&
		healthResult.traefik.status === "healthy";

	const isServerUp = async () => {
		try {
			const response = await fetch("/api/health", {
				cache: "no-store",
				signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
			});
			return response.ok;
		} catch {
			return false;
		}
	};

	const sleep = (ms: number) =>
		new Promise((resolve) => setTimeout(resolve, ms));

	useEffect(() => {
		unmountedRef.current = false;
		return () => {
			unmountedRef.current = true;
		};
	}, []);

	const isTracking =
		modalState === "updating" &&
		progress !== null &&
		!isUpdateFinished(progress);

	useEffect(() => {
		if (!isTracking) {
			return;
		}
		const interval = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(interval);
	}, [isTracking]);

	// The old server answers the status query while it pulls the image; while
	// Dokploy restarts only /api/health tells when it is back.
	const probe = async (
		current: UpdateProgress,
	): Promise<UpdateProgressEvent> => {
		if (current.phase === "restarting") {
			return (await isServerUp())
				? { type: "up", at: Date.now() }
				: { type: "tick", at: Date.now() };
		}
		try {
			const status = await utils.client.settings.getServerUpdateStatus.query(
				undefined,
				{ signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) },
			);
			return { type: "status", status, at: Date.now() };
		} catch {
			return (await isServerUp())
				? { type: "tick", at: Date.now() }
				: { type: "down", at: Date.now() };
		}
	};

	const trackUpdate = async () => {
		let current = createUpdateProgress(Date.now());
		setNow(current.startedAt);
		setProgress(current);

		try {
			await updateServer(keepImages === undefined ? undefined : { keepImages });
		} catch (error) {
			console.error("Error updating server:", error);
			current = failUpdateProgress(
				current,
				"downloading",
				error instanceof Error && error.message
					? error.message
					: "Could not start the update.",
				Date.now(),
			);
		}

		while (!isUpdateFinished(current) && !unmountedRef.current) {
			await sleep(UPDATE_POLL_MS);
			const event = await probe(current);
			current = advanceUpdateProgress(advanceUpdateProgress(current, event), {
				type: "tick",
				at: Date.now(),
			});
			setProgress(current);
		}
		setProgress(current);
		setNow(Date.now());
		return current;
	};

	const handleConfirm = async () => {
		setModalState("updating");
		const result = await trackUpdate();

		if (result.phase === "done") {
			toast.success(
				"The server has been updated. The page will be reloaded to reflect the changes...",
			);
			setTimeout(() => {
				window.location.reload();
			}, 2000);
		} else if (result.phase === "failed") {
			toast.error(
				"The server did not restart with the new version. Check the Dokploy service logs and try again.",
			);
		}
	};

	const updateFailed = progress?.phase === "failed";

	const handleClose = () => {
		if (modalState !== "updating" || updateFailed) {
			setOpen(false);
			setModalState("idle");
			setHealthResult(null);
			setProgress(null);
		}
	};

	return (
		<AlertDialog open={open}>
			<AlertDialogTrigger asChild>
				<Button
					className={cn("relative w-full", buttonClassName)}
					variant="secondary"
					onClick={() => setOpen(true)}
				>
					<HardDriveDownload className="h-4 w-4" />
					<span className="absolute -right-1 -top-2 flex h-3 w-3">
						<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
						<span className="relative inline-flex rounded-full h-3 w-3 bg-green-500" />
					</span>
					Update Server
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						{modalState === "idle" && "Are you absolutely sure?"}
						{modalState === "checking" && "Verifying Services..."}
						{modalState === "results" &&
							(allHealthy ? "Ready to Update" : "Service Issues Detected")}
						{modalState === "updating" &&
							(updateFailed
								? "Server update failed"
								: progress?.phase === "done"
									? "Server updated"
									: "Server update in progress")}
					</AlertDialogTitle>
					<AlertDialogDescription asChild>
						<div>
							{modalState === "idle" && (
								<span>
									This will update the web server to the selected latest build.
									AgentHits fork installs update from the AgentHits GHCR image.
									The new image is downloaded first, so the panel is unavailable
									only for about 20 seconds while Dokploy restarts. The page
									will be reloaded once the update is finished.
									<br />
									<br />
									We recommend verifying that all services are running before
									updating.
								</span>
							)}

							{modalState === "checking" && (
								<span className="flex items-center gap-2">
									<Loader2 className="animate-spin h-4 w-4" />
									Checking PostgreSQL and Traefik...
								</span>
							)}

							{modalState === "results" && healthResult && (
								<div className="flex flex-col gap-3">
									<div className="flex flex-col gap-2">
										<ServiceStatusItem
											name="PostgreSQL"
											service={healthResult.postgres}
										/>
										<ServiceStatusItem
											name="Traefik"
											service={healthResult.traefik}
										/>
									</div>

									{!allHealthy && (
										<div className="flex items-start gap-2 rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3">
											<AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5 shrink-0" />
											<span className="text-sm text-yellow-600 dark:text-yellow-400">
												Some services are not healthy. You can still proceed
												with the update.
											</span>
										</div>
									)}

									{allHealthy && (
										<span className="text-sm text-muted-foreground">
											All services are running. You can proceed with the update.
										</span>
									)}
								</div>
							)}

							{modalState === "results" && !healthResult && (
								<div className="flex items-start gap-2 rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3">
									<AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5 shrink-0" />
									<span className="text-sm text-yellow-600 dark:text-yellow-400">
										Could not verify services. You can still proceed with the
										update.
									</span>
								</div>
							)}

							{modalState === "updating" && progress && (
								<UpdateStatusPanel progress={progress} now={now} />
							)}
						</div>
					</AlertDialogDescription>
				</AlertDialogHeader>
				{modalState === "idle" && (
					<AlertDialogFooter>
						<AlertDialogCancel onClick={handleClose}>Cancel</AlertDialogCancel>
						<Button variant="secondary" onClick={handleVerify}>
							<RefreshCw className="h-4 w-4" />
							Verify Status
						</Button>
						<AlertDialogAction onClick={handleConfirm}>
							Confirm
						</AlertDialogAction>
					</AlertDialogFooter>
				)}
				{modalState === "updating" && updateFailed && (
					<AlertDialogFooter>
						<AlertDialogCancel onClick={handleClose}>Close</AlertDialogCancel>
					</AlertDialogFooter>
				)}
				{modalState === "results" && (
					<AlertDialogFooter>
						<AlertDialogCancel onClick={handleClose}>Cancel</AlertDialogCancel>
						<Button variant="secondary" onClick={handleVerify}>
							<RefreshCw className="h-4 w-4" />
							Re-check
						</Button>
						<AlertDialogAction onClick={handleConfirm}>
							{allHealthy ? "Confirm" : "Confirm Anyway"}
						</AlertDialogAction>
					</AlertDialogFooter>
				)}
			</AlertDialogContent>
		</AlertDialog>
	);
};
