import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import {
	findApplicationById,
	findComposeById,
	findPreviewDeploymentById,
	findServerById,
} from "@dokploy/server";

export type DeploymentQueueJob =
	| {
			applicationId: string;
			titleLog?: string;
			descriptionLog?: string;
			server?: boolean;
			type: "deploy" | "redeploy";
			applicationType: "application";
			serverId: string;
	  }
	| {
			composeId: string;
			titleLog?: string;
			descriptionLog?: string;
			server?: boolean;
			type: "deploy" | "redeploy";
			applicationType: "compose";
			serverId: string;
	  }
	| {
			applicationId: string;
			previewDeploymentId: string;
			titleLog?: string;
			descriptionLog?: string;
			server?: boolean;
			type: "deploy" | "redeploy";
			applicationType: "application-preview";
			serverId: string;
	  };

export type DeploymentCancelJob =
	| { applicationId: string; applicationType: "application" }
	| { composeId: string; applicationType: "compose" };

export type DeploymentJobOperation = "deploy" | "cancel";

export type DeploymentJobScope = {
	version: 1;
	operation: DeploymentJobOperation;
	applicationType: DeploymentQueueJob["applicationType"];
	objectId: string;
	applicationId: string | null;
	deploymentType: DeploymentQueueJob["type"] | null;
	serverId: string | null;
	organizationId: string | null;
	expiresAt: number;
	nonce: string;
};

export type SignedDeploymentQueueJob = DeploymentQueueJob & {
	scope: DeploymentJobScope;
	signature: string;
};

export type SignedDeploymentCancelJob = DeploymentCancelJob & {
	scope: DeploymentJobScope;
	signature: string;
};

type ScopeOptions = {
	now?: number;
	requireActiveServer?: boolean;
	ttlMs?: number;
};

type SigningOptions = ScopeOptions & {
	operation: DeploymentJobOperation;
};

const DEFAULT_SCOPE_TTL_MS = 5 * 60_000;

const getSigningKey = () => {
	const key = process.env.DEPLOYMENTS_SIGNING_KEY;
	if (!key || key.trim().length === 0) {
		throw new Error("Deployment job signing key is not configured");
	}
	if (process.env.API_KEY && key === process.env.API_KEY) {
		throw new Error("Deployment job signing key must differ from the API key");
	}
	return key;
};

const canonicalScope = (scope: DeploymentJobScope) =>
	JSON.stringify({
		version: scope.version,
		operation: scope.operation,
		applicationType: scope.applicationType,
		objectId: scope.objectId,
		applicationId: scope.applicationId,
		deploymentType: scope.deploymentType,
		serverId: scope.serverId,
		organizationId: scope.organizationId,
		expiresAt: scope.expiresAt,
		nonce: scope.nonce,
	});

const signScope = (scope: DeploymentJobScope) =>
	createHmac("sha256", getSigningKey())
		.update(canonicalScope(scope))
		.digest("base64url");

const assertEqual = (field: string, expected: unknown, actual: unknown) => {
	if (expected !== actual) {
		throw new Error(`Deployment job ${field} does not match its scoped claim`);
	}
};

const assertServerActive = async (serverId: string | null) => {
	if (!serverId) {
		return;
	}
	const server = await findServerById(serverId);
	if (server.serverStatus === "inactive") {
		throw new Error("Deployment job server is inactive");
	}
};

const buildApplicationScope = async (
	applicationId: string,
	options: SigningOptions,
) => {
	const application = await findApplicationById(applicationId);
	const serverId = application.serverId ?? null;
	if (options.requireActiveServer ?? true) {
		await assertServerActive(serverId);
	}
	return {
		objectId: application.applicationId,
		applicationId: application.applicationId,
		serverId,
		organizationId: application.environment.project.organizationId,
	};
};

const buildComposeScope = async (
	composeId: string,
	options: SigningOptions,
) => {
	const compose = await findComposeById(composeId);
	const serverId = compose.serverId ?? null;
	if (options.requireActiveServer ?? true) {
		await assertServerActive(serverId);
	}
	return {
		objectId: compose.composeId,
		applicationId: null,
		serverId,
		organizationId: compose.environment.project.organizationId,
	};
};

const buildPreviewScope = async (
	job: Extract<DeploymentQueueJob, { applicationType: "application-preview" }>,
	options: SigningOptions,
) => {
	const previewDeployment = await findPreviewDeploymentById(
		job.previewDeploymentId,
	);
	assertEqual(
		"application id",
		previewDeployment.applicationId,
		job.applicationId,
	);
	const application = await findApplicationById(
		previewDeployment.applicationId,
	);
	const serverId =
		previewDeployment.application?.serverId ?? application.serverId;
	if (options.requireActiveServer ?? true) {
		await assertServerActive(serverId ?? null);
	}
	return {
		objectId: previewDeployment.previewDeploymentId,
		applicationId: previewDeployment.applicationId,
		serverId: serverId ?? null,
		organizationId: application.environment.project.organizationId,
	};
};

const buildScope = async (
	job: DeploymentQueueJob | DeploymentCancelJob,
	options: SigningOptions,
): Promise<DeploymentJobScope> => {
	const now = options.now ?? Date.now();
	const expiresAt = now + (options.ttlMs ?? DEFAULT_SCOPE_TTL_MS);
	const scope =
		job.applicationType === "application"
			? await buildApplicationScope(job.applicationId, options)
			: job.applicationType === "compose"
				? await buildComposeScope(job.composeId, options)
				: await buildPreviewScope(job, options);

	if ("serverId" in job) {
		assertEqual("server scope", scope.serverId, job.serverId);
	}

	return {
		version: 1,
		operation: options.operation,
		applicationType: job.applicationType,
		objectId: scope.objectId,
		applicationId: scope.applicationId,
		deploymentType: "type" in job ? job.type : null,
		serverId: scope.serverId,
		organizationId: scope.organizationId,
		expiresAt,
		nonce: randomUUID(),
	};
};

const assertScopeMatchesJob = (
	job: DeploymentQueueJob | DeploymentCancelJob,
	scope: DeploymentJobScope,
	options: SigningOptions,
) => {
	assertEqual("operation", scope.operation, options.operation);
	assertEqual("application type", scope.applicationType, job.applicationType);
	if (job.applicationType === "application") {
		assertEqual("object id", scope.objectId, job.applicationId);
		assertEqual("application id", scope.applicationId, job.applicationId);
	} else if (job.applicationType === "compose") {
		assertEqual("object id", scope.objectId, job.composeId);
		assertEqual("application id", scope.applicationId, null);
	} else {
		assertEqual("object id", scope.objectId, job.previewDeploymentId);
		assertEqual("application id", scope.applicationId, job.applicationId);
	}
	assertEqual(
		"deployment type",
		scope.deploymentType,
		"type" in job ? job.type : null,
	);
	if ("serverId" in job) {
		assertEqual("server scope", scope.serverId, job.serverId);
	}
};

const verifySignature = (
	job: SignedDeploymentQueueJob | SignedDeploymentCancelJob,
) => {
	const expected = signScope(job.scope);
	const expectedBuffer = Buffer.from(expected);
	const actualBuffer = Buffer.from(job.signature);
	if (
		expectedBuffer.length !== actualBuffer.length ||
		!timingSafeEqual(expectedBuffer, actualBuffer)
	) {
		throw new Error("Deployment job scoped claim signature is invalid");
	}
};

export const signDeploymentQueueJob = async (
	job: DeploymentQueueJob,
	options: SigningOptions,
): Promise<SignedDeploymentQueueJob> => {
	const scope = await buildScope(job, options);
	return {
		...job,
		scope,
		signature: signScope(scope),
	};
};

export const signDeploymentCancelJob = async (
	job: DeploymentCancelJob,
	options: SigningOptions,
): Promise<SignedDeploymentCancelJob> => {
	const scope = await buildScope(job, options);
	return {
		...job,
		scope,
		signature: signScope(scope),
	};
};

export const assertSignedDeploymentQueueJob = async (
	job: SignedDeploymentQueueJob,
	options: SigningOptions & { requireFreshScope?: boolean },
): Promise<DeploymentQueueJob> => {
	assertScopeMatchesJob(job, job.scope, options);
	verifySignature(job);
	if (job.scope.expiresAt <= (options.now ?? Date.now())) {
		throw new Error("Deployment job scoped claim has expired");
	}
	if (options.requireFreshScope ?? true) {
		const freshScope = await buildScope(job, {
			...options,
			ttlMs: job.scope.expiresAt - (options.now ?? Date.now()),
		});
		assertEqual("server scope", freshScope.serverId, job.scope.serverId);
		assertEqual(
			"organization scope",
			freshScope.organizationId,
			job.scope.organizationId,
		);
	}

	const { scope: _scope, signature: _signature, ...queueJob } = job;
	return queueJob;
};

export const assertSignedDeploymentCancelJob = async (
	job: SignedDeploymentCancelJob,
	options: SigningOptions & { requireFreshScope?: boolean },
): Promise<DeploymentCancelJob> => {
	assertScopeMatchesJob(job, job.scope, options);
	verifySignature(job);
	if (job.scope.expiresAt <= (options.now ?? Date.now())) {
		throw new Error("Deployment job scoped claim has expired");
	}
	if (options.requireFreshScope ?? true) {
		const freshScope = await buildScope(job, {
			...options,
			ttlMs: job.scope.expiresAt - (options.now ?? Date.now()),
		});
		assertEqual("server scope", freshScope.serverId, job.scope.serverId);
		assertEqual(
			"organization scope",
			freshScope.organizationId,
			job.scope.organizationId,
		);
	}

	const { scope: _scope, signature: _signature, ...cancelJob } = job;
	return cancelJob;
};
