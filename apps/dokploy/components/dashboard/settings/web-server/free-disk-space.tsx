import { AlertTriangle, HardDrive, Loader2, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { api } from "@/utils/api";
import { formatImageSize } from "./dokploy-image-plan";

interface Props {
	/** The last update failed because the disk was full. */
	diskFull?: boolean;
	disabled?: boolean;
}

export const FreeDiskSpace = ({ diskFull = false, disabled }: Props) => {
	const [buildCache, setBuildCache] = useState(false);
	const utils = api.useUtils();
	const { data: space, isLoading } = api.settings.getUpdateDiskSpace.useQuery(
		undefined,
		{ refetchOnWindowFocus: false },
	);
	const { mutateAsync: freeSpace, isPending } =
		api.settings.freeUpdateDiskSpace.useMutation();

	if (isLoading) {
		return (
			<span className="flex items-center gap-2 text-xs text-muted-foreground">
				<Loader2 className="h-3 w-3 animate-spin" />
				Checking free disk space...
			</span>
		);
	}
	if (!space) {
		return null;
	}

	const isLow =
		space.availableBytes !== null &&
		space.requiredBytes !== null &&
		space.availableBytes < space.requiredBytes;
	const canFree =
		space.oldImageCount > 0 || (buildCache && space.buildCacheBytes > 0);

	const handleFree = async () => {
		try {
			const result = await freeSpace({ buildCache });
			if (result) {
				utils.settings.getUpdateDiskSpace.setData(undefined, result);
				const freed =
					result.availableBytes !== null && space.availableBytes !== null
						? result.availableBytes - space.availableBytes
						: null;
				toast.success(
					freed !== null && freed > 0
						? `Freed ${formatImageSize(freed)}`
						: "Cleanup finished",
				);
			}
			await utils.settings.getDokployImages.invalidate();
		} catch (error) {
			toast.error(
				error instanceof Error && error.message
					? error.message
					: "Could not free disk space",
			);
		}
	};

	return (
		<div
			className={cn(
				"flex flex-col gap-2 rounded-md border p-3 text-sm",
				diskFull || isLow
					? "border-yellow-500/30 bg-yellow-500/10"
					: "border-border",
			)}
		>
			<div className="flex items-center gap-2">
				<HardDrive className="h-4 w-4 shrink-0 text-muted-foreground" />
				<span className="text-foreground">
					Free disk space:{" "}
					<span className="font-medium">
						{space.availableBytes !== null
							? formatImageSize(space.availableBytes)
							: "unknown"}
					</span>
					{space.totalBytes !== null &&
						` of ${formatImageSize(space.totalBytes)}`}
				</span>
			</div>

			{(diskFull || isLow) && (
				<div className="flex items-start gap-2">
					<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-500" />
					<span className="text-yellow-600 dark:text-yellow-400">
						{diskFull
							? "The disk filled up while Docker downloaded the new image. Free up space, then try again."
							: `The new image needs about ${formatImageSize(space.requiredBytes ?? 0)}. Free up space before updating.`}
					</span>
				</div>
			)}

			<span className="text-xs text-muted-foreground">
				{space.oldImageCount > 0
					? `Old Dokploy builds: ${space.oldImageCount}, ${formatImageSize(space.oldImageBytes)}. The running build and the previous one stay for a rollback.`
					: "No old Dokploy builds to remove. The running build and the previous one always stay."}
			</span>

			{space.buildCacheBytes > 0 && (
				<div className="flex items-start gap-2">
					<Checkbox
						id="freeBuildCache"
						checked={buildCache}
						onCheckedChange={(checked) => setBuildCache(checked === true)}
						disabled={disabled || isPending}
						className="mt-0.5"
					/>
					<Label
						htmlFor="freeBuildCache"
						className="flex flex-col items-start gap-0.5 font-normal"
					>
						<span>
							Also clear the Docker build cache (
							{formatImageSize(space.buildCacheBytes)})
						</span>
						<span className="text-xs text-muted-foreground">
							The next builds of your apps run without cache and take longer.
						</span>
					</Label>
				</div>
			)}

			<div>
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={handleFree}
					disabled={disabled || isPending || !canFree}
				>
					{isPending ? (
						<Loader2 className="h-4 w-4 animate-spin" />
					) : (
						<Trash2 className="h-4 w-4" />
					)}
					Free up space
				</Button>
			</div>
		</div>
	);
};
