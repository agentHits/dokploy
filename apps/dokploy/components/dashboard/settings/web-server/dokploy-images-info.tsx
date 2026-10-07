import type { DokployImageInfo } from "@dokploy/server/index";
import { format, formatDistanceToNow } from "date-fns";
import { HardDrive, Loader2, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { api } from "@/utils/api";
import {
	type DokployImageAction,
	formatImageSize,
	planDokployImageCleanup,
} from "./dokploy-image-plan";

interface Props {
	keepImages: number | null;
	pendingVersion: string | null;
	enabled: boolean;
}

interface PopoverProps {
	images: DokployImageInfo[] | undefined;
	isLoading: boolean;
	keepImages: number | null;
	pendingVersion: string | null;
}

const rowStyles: Record<DokployImageAction, string> = {
	new: "border-dashed border-emerald-500/50 bg-emerald-500/5",
	keep: "border-emerald-500/30 bg-emerald-500/5",
	remove: "border-red-500/50 bg-red-500/10",
	blocked: "border-yellow-500/40 bg-yellow-500/10",
};

const actionBadges: Record<
	DokployImageAction,
	{ label: string; className: string }
> = {
	new: { label: "New build", className: "bg-emerald-600 text-white" },
	keep: { label: "Keep", className: "bg-emerald-600/80 text-white" },
	remove: { label: "Delete", className: "bg-red-600 text-white" },
	blocked: { label: "In use", className: "bg-yellow-600 text-white" },
};

export const DokployImagesInfo = ({
	keepImages,
	pendingVersion,
	enabled,
}: Props) => {
	const { data: images, isLoading } = api.settings.getDokployImages.useQuery(
		undefined,
		{ enabled },
	);
	return (
		<DokployImagesPopover
			images={images}
			isLoading={isLoading}
			keepImages={keepImages}
			pendingVersion={pendingVersion}
		/>
	);
};

export const DokployImagesPopover = ({
	images,
	isLoading,
	keepImages,
	pendingVersion,
}: PopoverProps) => {
	const plan = images
		? planDokployImageCleanup(images, keepImages, pendingVersion)
		: null;

	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button variant="outline" size="sm">
					{isLoading ? (
						<Loader2 className="h-4 w-4 animate-spin" />
					) : (
						<HardDrive className="h-4 w-4" />
					)}
					{images
						? `${images.length} ${images.length === 1 ? "image" : "images"} · ${formatImageSize(plan?.totalBytes ?? 0)}`
						: "Images"}
				</Button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-[min(92vw,30rem)] gap-3">
				<div>
					<p className="font-medium">Dokploy images on this server</p>
					<p className="text-xs text-muted-foreground">
						{keepImages === null
							? "Cleanup is off: every image stays."
							: `The newest ${keepImages} stay${pendingVersion ? ", counting the new build" : ""}. Red ones are deleted after the update.`}
					</p>
				</div>

				{isLoading && (
					<div className="flex items-center gap-2 text-muted-foreground">
						<Loader2 className="h-4 w-4 animate-spin" />
						Reading Docker images...
					</div>
				)}

				{plan && plan.rows.length === 0 && (
					<p className="text-muted-foreground">No Dokploy images found.</p>
				)}

				{plan && plan.rows.length > 0 && (
					<ul className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
						{plan.rows.map((row, index) => {
							const badge = actionBadges[row.action];
							const image = row.image;
							return (
								<li
									key={row.key}
									className={cn(
										"flex items-start gap-3 rounded-md border px-3 py-2",
										rowStyles[row.action],
									)}
								>
									<span className="w-4 pt-0.5 text-right text-xs text-muted-foreground">
										{index + 1}
									</span>
									<div className="min-w-0 flex-1">
										<div className="flex flex-wrap items-center gap-1.5">
											<span
												className={cn(
													"truncate font-medium",
													row.action === "remove" && "line-through opacity-80",
												)}
											>
												{row.version}
											</span>
											<Badge className={badge.className}>{badge.label}</Badge>
											{image?.isCurrent && (
												<Badge variant="outline">Running now</Badge>
											)}
										</div>
										<div className="text-xs text-muted-foreground">
											{image ? (
												<>
													{format(
														new Date(image.createdAt),
														"dd.MM.yyyy HH:mm",
													)}{" "}
													(
													{formatDistanceToNow(new Date(image.createdAt), {
														addSuffix: true,
													})}
													)
													{image.officialVersion &&
														` · ${image.officialVersion}`}
												</>
											) : (
												"Downloaded during the update"
											)}
										</div>
										{row.action === "remove" &&
											!!image?.dokployTaskContainers && (
												<div className="text-xs text-red-500">
													+ {image.dokployTaskContainers} stopped Dokploy{" "}
													{image.dokployTaskContainers === 1
														? "container"
														: "containers"}
												</div>
											)}
										{row.action === "blocked" && (
											<div className="text-xs text-yellow-600 dark:text-yellow-400">
												Used by a container, so it is not deleted
											</div>
										)}
									</div>
									{image && (
										<div className="shrink-0 text-right text-xs">
											<div className="font-medium">
												{formatImageSize(image.sizeBytes)}
											</div>
											{image.uniqueSizeBytes !== null && (
												<div className="text-muted-foreground">
													frees {formatImageSize(image.uniqueSizeBytes)}
												</div>
											)}
										</div>
									)}
								</li>
							);
						})}
					</ul>
				)}

				{plan && keepImages !== null && (
					<div className="flex items-center gap-2 border-t pt-3 text-sm">
						<Trash2 className="h-4 w-4 text-red-500" />
						{plan.removeCount > 0
							? `Deletes ${plan.removeCount} ${plan.removeCount === 1 ? "image" : "images"}, frees about ${formatImageSize(plan.freedBytes)}`
							: "Nothing to delete"}
					</div>
				)}
			</PopoverContent>
		</Popover>
	);
};
