export { startDashboard, type DashboardOptions, type DashboardResult } from "./server.js";
export {
	getDashboardStatus,
	saveDashboardPid,
	clearDashboardPid,
	stopDashboardServer,
	type DashboardServerStatus,
} from "./server-manager.js";
export type { DashboardData, DashboardService } from "./template.js";
