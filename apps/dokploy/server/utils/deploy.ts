import { findServerById } from "@dokploy/server";
import {
	type DeploymentQueueJob,
	signDeploymentCancelJob,
	signDeploymentJobsReadRequest,
	signDeploymentQueueJob,
} from "@dokploy/server/utils/deployments/signed-job";
import type { DeploymentJob } from "../queues/queue-types";

const assertDeploymentServerScope = (
	jobData: DeploymentJob,
): DeploymentQueueJob => {
	if (!jobData.serverId) {
		throw new Error("Deployment job server scope is required");
	}
	return {
		...jobData,
		serverId: jobData.serverId,
	};
};

export const deploy = async (jobData: DeploymentJob) => {
	try {
		const scopedJobData = assertDeploymentServerScope(jobData);
		const server = await findServerById(scopedJobData.serverId);
		if (server.serverStatus === "inactive") {
			throw new Error("Server is inactive");
		}

		const signedJobData = await signDeploymentQueueJob(scopedJobData, {
			operation: "deploy",
		});
		const result = await fetch(`${process.env.SERVER_URL}/deploy`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-API-Key": process.env.API_KEY || "NO-DEFINED",
			},
			body: JSON.stringify(signedJobData),
		});
		if (
			jobData.applicationType === "compose" &&
			jobData.operationId &&
			!result.ok
		) {
			throw new Error("Exact deployment dispatch was not accepted");
		}

		const data = await result.json();
		return data;
	} catch (error) {
		throw error;
	}
};

type CancelDeploymentData =
	| { applicationId: string; applicationType: "application" }
	| { composeId: string; applicationType: "compose" };

export const cancelDeployment = async (cancelData: CancelDeploymentData) => {
	try {
		const signedCancelData = await signDeploymentCancelJob(cancelData, {
			operation: "cancel",
			requireActiveServer: false,
		});
		const result = await fetch(`${process.env.SERVER_URL}/cancel-deployment`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-API-Key": process.env.API_KEY || "NO-DEFINED",
			},
			body: JSON.stringify(signedCancelData),
		});

		if (!result.ok) {
			const errorData = await result.json().catch(() => ({}));
			throw new Error(errorData.message || "Failed to cancel deployment");
		}

		const data = await result.json();
		return data;
	} catch (error) {
		throw error;
	}
};

export type QueueJobRow = {
	id: string;
	name?: string;
	data: Record<string, unknown>;
	timestamp?: number;
	processedOn?: number;
	finishedOn?: number;
	failedReason?: string;
	state: string;
};

export type DeployApiJobsResult =
	| { available: true; jobs: QueueJobRow[] }
	| {
			available: false;
			reasonCode:
				| "not-configured"
				| "network-error"
				| "remote-error"
				| "invalid-response";
	  };

export const fetchDeployApiJobsResult = async (
	serverId: string,
): Promise<DeployApiJobsResult> => {
	if (!process.env.SERVER_URL) {
		return { available: false, reasonCode: "not-configured" };
	}
	try {
		const signedRequest = await signDeploymentJobsReadRequest(serverId);
		const res = await fetch(`${process.env.SERVER_URL}/jobs`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-API-Key": process.env.API_KEY || "NO-DEFINED",
			},
			body: JSON.stringify(signedRequest),
		});
		if (!res.ok) {
			return { available: false, reasonCode: "remote-error" };
		}
		let data: unknown;
		try {
			data = await res.json();
		} catch {
			return { available: false, reasonCode: "invalid-response" };
		}
		if (!Array.isArray(data)) {
			return { available: false, reasonCode: "invalid-response" };
		}
		return { available: true, jobs: data as QueueJobRow[] };
	} catch {
		return { available: false, reasonCode: "network-error" };
	}
};

export const fetchDeployApiJobs = async (
	serverId: string,
): Promise<QueueJobRow[]> => {
	const result = await fetchDeployApiJobsResult(serverId);
	return result.available ? result.jobs : [];
};
