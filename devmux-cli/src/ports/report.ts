import { getBasePort, getResolvedPort, loadConfig } from "../config/loader.js";
import type { HealthCheckType } from "../config/types.js";
import { diagnosePort, type DiagnosisResult } from "../utils/diagnose.js";

export interface LocalPortEntry {
  serviceName: string;
  healthType: HealthCheckType["type"] | "none";
  basePort?: number;
  resolvedPort?: number;
  live?: DiagnosisResult;
}

export interface LocalPortReport {
  project: string;
  configRoot: string;
  instanceId: string;
  services: LocalPortEntry[];
  summary: {
    serviceCount: number;
    servicesWithPorts: number;
  };
}

function getHealthType(
  health: HealthCheckType | undefined,
  explicitPort?: number,
): LocalPortEntry["healthType"] {
  if (health) return health.type;
  if (explicitPort !== undefined) return "port";
  return "none";
}

export async function collectLocalPortReport(
  options: {
    live?: boolean;
  } = {},
): Promise<LocalPortReport> {
  const config = loadConfig();
  const services: LocalPortEntry[] = [];

  for (const [serviceName, service] of Object.entries(config.services)) {
    const basePort = getBasePort(service.health, service.port);
    const resolvedPort = getResolvedPort(config, serviceName);
    const entry: LocalPortEntry = {
      serviceName,
      healthType: getHealthType(service.health, service.port),
      basePort,
      resolvedPort,
    };

    if (options.live && basePort !== undefined) {
      entry.live = await diagnosePort(basePort, serviceName);
    }

    services.push(entry);
  }

  services.sort((a, b) => {
    const aPort = a.basePort ?? Number.MAX_SAFE_INTEGER;
    const bPort = b.basePort ?? Number.MAX_SAFE_INTEGER;
    if (aPort !== bPort) return aPort - bPort;
    return a.serviceName.localeCompare(b.serviceName);
  });

  return {
    project: config.project,
    configRoot: config.configRoot,
    instanceId: config.instanceId,
    services,
    summary: {
      serviceCount: services.length,
      servicesWithPorts: services.filter(
        (entry) => entry.basePort !== undefined,
      ).length,
    },
  };
}
