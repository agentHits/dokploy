import {
	claimDeploymentOperation,
	deployApplication,
	deployCompose,
	deployPreviewApplication,
	ExactDeploymentFinalizationError,
	finalizeDeploymentOperation,
	rebuildApplication,
	rebuildCompose,
	rebuildPreviewApplication,
	updateApplicationStatus,
	updateCompose,
	updatePreviewDeployment,
} from "@dokploy/server";
import type { InMemoryJob } from "./in-memory-queue";

/**
 * Processes a single deployment job. Shared by the in-memory queue worker and
 * (in cloud) the direct background execution path.
 */
export const processDeploymentJob = async (job: InMemoryJob) => {
	try {
		if (job.data.applicationType === "application") {
			await updateApplicationStatus(job.data.applicationId, "running");

			if (job.data.type === "redeploy") {
				await rebuildApplication({
					applicationId: job.data.applicationId,
					titleLog: job.data.titleLog,
					descriptionLog: job.data.descriptionLog,
				});
			} else if (job.data.type === "deploy") {
				await deployApplication({
					applicationId: job.data.applicationId,
					titleLog: job.data.titleLog,
					descriptionLog: job.data.descriptionLog,
				});
			}
		} else if (job.data.applicationType === "compose") {
			if (job.data.operationId) {
				const claimed = await claimDeploymentOperation(
					job.data.composeId,
					job.data.operationId,
				);
				if (!claimed) return;
			}
			await updateCompose(job.data.composeId, {
				composeStatus: "running",
			});
			if (job.data.type === "deploy") {
				await deployCompose({
					composeId: job.data.composeId,
					titleLog: job.data.titleLog,
					descriptionLog: job.data.descriptionLog,
					operationId: job.data.operationId,
					expectedRevision: job.data.expectedRevision,
				});
			} else if (job.data.type === "redeploy") {
				await rebuildCompose({
					composeId: job.data.composeId,
					titleLog: job.data.titleLog,
					descriptionLog: job.data.descriptionLog,
				});
			}
		} else if (job.data.applicationType === "application-preview") {
			await updatePreviewDeployment(job.data.previewDeploymentId, {
				previewStatus: "running",
			});

			if (job.data.type === "redeploy") {
				await rebuildPreviewApplication({
					applicationId: job.data.applicationId,
					titleLog: job.data.titleLog,
					descriptionLog: job.data.descriptionLog,
					previewDeploymentId: job.data.previewDeploymentId,
				});
			} else if (job.data.type === "deploy") {
				await deployPreviewApplication({
					applicationId: job.data.applicationId,
					titleLog: job.data.titleLog,
					descriptionLog: job.data.descriptionLog,
					previewDeploymentId: job.data.previewDeploymentId,
				});
			}
		}
	} catch (error) {
		if (
			job.data.applicationType === "compose" &&
			job.data.operationId &&
			!(error instanceof ExactDeploymentFinalizationError)
		) {
			await Promise.allSettled([
				finalizeDeploymentOperation(job.data.operationId, "failed"),
				updateCompose(job.data.composeId, { composeStatus: "error" }),
			]);
		}
		console.log("Error", error);
	}
};
