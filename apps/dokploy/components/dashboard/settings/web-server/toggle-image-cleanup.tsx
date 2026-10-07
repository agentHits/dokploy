import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { DokployImagesInfo } from "./dokploy-images-info";

const IMAGE_KEEP_OPTIONS = [0, 1, 2, 3, 4, 5];
const DEFAULT_IMAGE_KEEP_COUNT = 1;

interface Props {
	keepImages: number | null;
	onChange: (keepImages: number | null) => void;
	disabled?: boolean;
	pendingVersion: string | null;
	loadImages: boolean;
}

export const ToggleImageCleanup = ({
	keepImages,
	onChange,
	disabled,
	pendingVersion,
	loadImages,
}: Props) => {
	const enabled = keepImages !== null;

	return (
		<div className="flex flex-col gap-1">
			<div className="flex items-center gap-4">
				<Switch
					checked={enabled}
					onCheckedChange={(checked) =>
						onChange(checked ? DEFAULT_IMAGE_KEEP_COUNT : null)
					}
					id="imageCleanupToggle"
					disabled={disabled}
				/>
				<Label className="text-primary" htmlFor="imageCleanupToggle">
					Remove old images, also keep
				</Label>
				<Select
					value={String(keepImages ?? DEFAULT_IMAGE_KEEP_COUNT)}
					onValueChange={(value) => onChange(Number(value))}
					disabled={disabled || !enabled}
				>
					<SelectTrigger className="w-[70px]" size="sm">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{IMAGE_KEEP_OPTIONS.map((count) => (
							<SelectItem key={count} value={String(count)}>
								{count}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<span className="text-sm text-primary">older</span>
			</div>
			<div className="flex flex-col items-start gap-2 pl-[52px]">
				<p className="text-xs text-muted-foreground">
					The new build and the one installed now always stay and are not
					counted. Saved with the next update; after restarting, Dokploy deletes
					the older images beyond this number and the stopped containers that
					keep them.
				</p>
				<DokployImagesInfo
					keepImages={keepImages}
					pendingVersion={pendingVersion}
					enabled={loadImages}
				/>
			</div>
		</div>
	);
};
