import { REDACTED_SECRET_VALUE } from "@dokploy/server/utils/security/redaction";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getWebServerSettings: vi.fn(),
	setupWebMonitoring: vi.fn(),
	updateWebServerSettings: vi.fn(),
}));

const redactWebServerSettings = <T extends { metricsConfig?: any } | null>(
	settings: T,
) => {
	if (!settings) {
		return settings;
	}

	return {
		...settings,
		metricsConfig: {
			...settings.metricsConfig,
			server: {
				...settings.metricsConfig?.server,
				token: settings.metricsConfig?.server?.token
					? REDACTED_SECRET_VALUE
					: settings.metricsConfig?.server?.token,
			},
		},
	};
};

const resolveWebServerMetricsConfigUpdate = (
	metricsConfig: {
		server: {
			token: string;
		};
	},
	currentMetricsConfig:
		| {
				server?: {
					token?: string;
				};
		  }
		| null
		| undefined,
) => ({
	...metricsConfig,
	server: {
		...metricsConfig.server,
		token:
			metricsConfig.server.token === REDACTED_SECRET_VALUE
				? (currentMetricsConfig?.server?.token ?? "")
				: metricsConfig.server.token,
	},
});

vi.mock("@dokploy/server", () => ({
	IS_CLOUD: false,
	getWebServerSettings: mocks.getWebServerSettings,
	redactWebServerSettings,
	resolveWebServerMetricsConfigUpdate,
	setupWebMonitoring: mocks.setupWebMonitoring,
	updateWebServerSettings: mocks.updateWebServerSettings,
}));

const { adminRouter } = await import("../../server/api/routers/admin");

const metricsConfig = {
	server: {
		refreshRate: 60,
		port: 4500,
		token: REDACTED_SECRET_VALUE,
		urlCallback:
			"https://dokploy.example.com/api/trpc/notification.receiveNotification",
		retentionDays: 7,
		cronJob: "0 0 * * *",
		thresholds: {
			cpu: 80,
			memory: 80,
		},
	},
	containers: {
		refreshRate: 60,
		services: {
			include: [],
			exclude: [],
		},
	},
};

const createCaller = () =>
	adminRouter.createCaller({
		db: {},
		req: {},
		res: {},
		session: {
			userId: "admin-1",
			activeOrganizationId: "org-1",
		},
		user: {
			id: "admin-1",
			role: "admin",
		},
	} as never);

describe("web server monitoring secret preservation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getWebServerSettings
			.mockResolvedValueOnce({
				metricsConfig: {
					server: {
						token: "stored-token",
					},
				},
			})
			.mockResolvedValueOnce({
				metricsConfig: {
					server: {
						token: "stored-token",
					},
				},
			});
		mocks.setupWebMonitoring.mockResolvedValue(undefined);
		mocks.updateWebServerSettings.mockResolvedValue(undefined);
	});

	it("preserves the stored metrics token when setup receives the redacted placeholder", async () => {
		const result = await createCaller().setupMonitoring({ metricsConfig });

		expect(mocks.updateWebServerSettings).toHaveBeenCalledWith(
			expect.objectContaining({
				metricsConfig: expect.objectContaining({
					server: expect.objectContaining({
						token: "stored-token",
					}),
				}),
			}),
		);
		expect(result?.metricsConfig?.server.token).toBe(REDACTED_SECRET_VALUE);
	});
});
