import { networkInterfaces } from "node:os";
import { getProcessOnPort } from "./process.js";

export interface PortBinding {
  address: string;
  status: "free" | "occupied";
  process?: {
    name: string;
    pid: number;
    cmd?: string;
  };
}

export interface DiagnosisResult {
  port: number;
  serviceName: string;
  bindings: PortBinding[];
  summary: {
    isBlocked: boolean;
    blockerType?: "vpn" | "docker" | "system" | "other";
    blockerName?: string;
    suggestion?: string;
  };
}

function getAddressesToCheck(): string[] {
  const addresses = ["127.0.0.1", "0.0.0.0", "::1"];
  
  const interfaces = networkInterfaces();
  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.internal) continue;
      if (addr.address.startsWith("fe80")) continue;
      if (addr.address.startsWith("169.254")) continue;
      
      if (!addresses.includes(addr.address)) {
        addresses.push(addr.address);
      }
    }
  }
  
  return addresses;
}

async function checkPortStatus(port: number, address: string): Promise<PortBinding> {
  const proc = await getProcessOnPort(port);
  
  if (proc) {
    return {
      address,
      status: "occupied",
      process: { name: proc.name, pid: proc.pid, cmd: proc.cmd }
    };
  }
  
  return { address, status: "free" };
}

function detectBlockerType(processName: string, cmd?: string): { type: "vpn" | "docker" | "system" | "other"; name: string } | null {
  const lowerName = processName.toLowerCase();
  const lowerCmd = cmd?.toLowerCase() || "";
  
  const vpnPatterns = [
    { pattern: /tailscale/, name: "Tailscale" },
    { pattern: /wireguard/, name: "WireGuard" },
    { pattern: /openvpn/, name: "OpenVPN" },
    { pattern: /anyconnect/, name: "Cisco AnyConnect" },
    { pattern: /forticlient/, name: "FortiClient" },
    { pattern: /globalprotect/, name: "GlobalProtect" },
    { pattern: /netextender/, name: "NetExtender" },
    { pattern: /warp/, name: "Cloudflare WARP" },
    { pattern: /zerotier/, name: "ZeroTier" },
    { pattern: /hamachi/, name: "LogMeIn Hamachi" },
    { pattern: /nordvpn/, name: "NordVPN" },
    { pattern: /expressvpn/, name: "ExpressVPN" },
    { pattern: /protonvpn/, name: "ProtonVPN" },
    { pattern: /surfshark/, name: "Surfshark" },
    { pattern: /tunnelbear/, name: "TunnelBear" },
    { pattern: /ipvanish/, name: "IPVanish" },
  ];
  
  for (const { pattern, name } of vpnPatterns) {
    if (pattern.test(lowerName) || pattern.test(lowerCmd)) {
      return { type: "vpn", name };
    }
  }
  
  const dockerPatterns = [
    { pattern: /docker/, name: "Docker" },
    { pattern: /containerd/, name: "containerd" },
    { pattern: /podman/, name: "Podman" },
    { pattern: /nerdctl/, name: "nerdctl" },
  ];
  
  for (const { pattern, name } of dockerPatterns) {
    if (pattern.test(lowerName) || pattern.test(lowerCmd)) {
      return { type: "docker", name };
    }
  }
  
  const systemPatterns = [
    { pattern: /systemd/, name: "systemd" },
    { pattern: /launchd/, name: "launchd" },
    { pattern: /inetd/, name: "inetd" },
    { pattern: /xinetd/, name: "xinetd" },
  ];
  
  for (const { pattern, name } of systemPatterns) {
    if (pattern.test(lowerName) || pattern.test(lowerCmd)) {
      return { type: "system", name };
    }
  }
  
  return { type: "other", name: processName };
}

function generateSuggestion(blockerType: "vpn" | "docker" | "system" | "other", blockerName: string, port: number): string {
  switch (blockerType) {
    case "vpn":
      if (blockerName === "Tailscale") {
        return `Tailscale may be proxying this port. Run:\n  tailscale serve status\n  tailscale serve reset  # to clear all\n\nOr check for Funnel:\n  tailscale funnel status`;
      }
      return `${blockerName} may be intercepting traffic on this port. Check ${blockerName} settings or temporarily disconnect to test.`;
    
    case "docker":
      return `A Docker container is using this port. Check running containers:\n  docker ps --format "table {{.Names}}\\t{{.Ports}}"\n\nStop the container or map it to a different port.`;
    
    case "system":
      return `A system service (${blockerName}) is listening on this port. You may need to:\n  sudo lsof -i :${port}\n  sudo systemctl stop <service>  # if using systemd`;
    
    default:
      return `Process is occupying the port. To free it:\n  lsof -ti :${port} | xargs kill -9`;
  }
}

export async function diagnosePort(port: number, serviceName: string): Promise<DiagnosisResult> {
  const addresses = getAddressesToCheck();
  const bindings: PortBinding[] = [];

  for (const address of addresses) {
    const binding = await checkPortStatus(port, address);
    if (binding) {
      bindings.push(binding);
    }
  }
  
  const occupiedBindings = bindings.filter(b => b.status === "occupied");
  const isBlocked = occupiedBindings.length > 0;
  
  let blockerType: "vpn" | "docker" | "system" | "other" | undefined;
  let blockerName: string | undefined;
  let suggestion: string | undefined;
  
  if (isBlocked && occupiedBindings.length > 0) {
    for (const binding of occupiedBindings) {
      if (binding.process) {
        const detected = detectBlockerType(binding.process.name, binding.process.cmd);
        if (detected) {
          if (detected.type === "vpn") {
            blockerType = detected.type;
            blockerName = detected.name;
            break;
          } else if (!blockerType) {
            blockerType = detected.type;
            blockerName = detected.name;
          }
        }
      }
    }
    
    if (!blockerName && occupiedBindings[0].process) {
      blockerName = occupiedBindings[0].process.name;
      blockerType = "other";
    }
    
    if (blockerType && blockerName) {
      suggestion = generateSuggestion(blockerType, blockerName, port);
    }
  }
  
  return {
    port,
    serviceName,
    bindings,
    summary: {
      isBlocked,
      blockerType,
      blockerName,
      suggestion
    }
  };
}

export function formatDiagnosis(result: DiagnosisResult): string {
  const lines: string[] = [];
  
  lines.push(`═══════════════════════════════════════`);
  lines.push(`       Port Diagnosis: ${result.serviceName}`);
  lines.push(`═══════════════════════════════════════`);
  lines.push("");
  lines.push(`Port ${result.port} status:`);
  lines.push("");
  
  for (const binding of result.bindings) {
    const icon = binding.status === "free" ? "✅" : "❌";
    const addressDisplay = binding.address.padEnd(20);
    lines.push(`  ${icon} ${addressDisplay} ${binding.status.toUpperCase()}`);
    
    if (binding.process) {
      lines.push(`      └─ ${binding.process.name} (PID ${binding.process.pid})`);
      if (binding.process.cmd) {
        const shortCmd = binding.process.cmd.length > 60 
          ? binding.process.cmd.slice(0, 57) + "..." 
          : binding.process.cmd;
        lines.push(`         ${shortCmd}`);
      }
    }
  }
  
  lines.push("");
  
  if (result.summary.isBlocked) {
    lines.push("⚠️  PORT IS BLOCKED");
    if (result.summary.blockerName) {
      lines.push(`   Blocker: ${result.summary.blockerName}`);
    }
    lines.push("");
    if (result.summary.suggestion) {
      lines.push("Suggestion:");
      for (const line of result.summary.suggestion.split("\n")) {
        lines.push(`  ${line}`);
      }
    }
  } else {
    lines.push("✅ Port is free on all interfaces");
  }
  
  lines.push("");
  
  return lines.join("\n");
}
