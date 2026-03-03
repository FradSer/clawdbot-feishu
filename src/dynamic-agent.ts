import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { OpenClawConfig, PluginRuntime } from "openclaw/plugin-sdk";
import type { DynamicAgentCreationConfig } from "./types.js";

export type MaybeCreateDynamicAgentResult = {
  created: boolean;
  updatedCfg: OpenClawConfig;
  agentId?: string;
};

/**
 * Check if a dynamic agent should be created for a DM user and create it if needed.
 * This creates a unique agent instance with its own workspace for each DM user.
 */
export async function maybeCreateDynamicAgent(params: {
  cfg: OpenClawConfig;
  runtime: PluginRuntime;
  senderOpenId: string;
  dynamicCfg: DynamicAgentCreationConfig;
  accountId?: string;
  log: (msg: string) => void;
}): Promise<MaybeCreateDynamicAgentResult> {
  const { cfg, runtime, senderOpenId, dynamicCfg, accountId, log } = params;

  // Check if there's already a binding for this user
  const existingBindings = cfg.bindings ?? [];
  const hasBinding = existingBindings.some(
    (b) =>
      b.match?.channel === "feishu" &&
      (!accountId || b.match?.accountId === accountId) &&
      b.match?.peer?.kind === "direct" &&
      b.match?.peer?.id === senderOpenId,
  );

  if (hasBinding) {
    return { created: false, updatedCfg: cfg };
  }

  // Check maxAgents limit if configured
  if (dynamicCfg.maxAgents !== undefined) {
    const feishuAgentCount = (cfg.agents?.list ?? []).filter((a) =>
      a.id.startsWith("feishu-"),
    ).length;
    if (feishuAgentCount >= dynamicCfg.maxAgents) {
      log(
        `feishu: maxAgents limit (${dynamicCfg.maxAgents}) reached, not creating agent for ${senderOpenId}`,
      );
      return { created: false, updatedCfg: cfg };
    }
  }

  // Use full OpenID as agent ID suffix (OpenID format: ou_xxx is already filesystem-safe)
  const agentId = `feishu-${senderOpenId}`;

  // Check if agent already exists (but binding was missing)
  const existingAgent = (cfg.agents?.list ?? []).find((a) => a.id === agentId);
  if (existingAgent) {
    // Resolve the expected agentDir based on current mode
    const targetAgentDir = resolveUserPath(
      resolveAgentDirTemplate({ dynamicCfg, senderOpenId, agentId }),
    );

    // Check if agentDir needs updating (mode may have changed)
    if (existingAgent.agentDir !== targetAgentDir) {
      log(
        `feishu: updating agent "${agentId}" agentDir from ${existingAgent.agentDir} to ${targetAgentDir}`,
      );

      // Update only the agentDir, preserve workspace
      const updatedAgents = cfg.agents!.list.map((a) =>
        a.id === agentId ? { ...a, agentDir: targetAgentDir } : a,
      );

      const updatedCfg: OpenClawConfig = {
        ...cfg,
        agents: { ...cfg.agents, list: updatedAgents },
        bindings: [
          ...existingBindings,
          {
            agentId,
            match: {
              channel: "feishu",
              ...(accountId ? { accountId } : {}),
              peer: { kind: "direct", id: senderOpenId },
            },
          },
        ],
      };

      await runtime.config.writeConfigFile(updatedCfg);
      return { created: true, updatedCfg, agentId };
    }

    // Agent exists with matching agentDir - just add the binding
    log(`feishu: agent "${agentId}" exists, adding missing binding for ${senderOpenId}`);

    const updatedCfg: OpenClawConfig = {
      ...cfg,
      bindings: [
        ...existingBindings,
        {
          agentId,
          match: {
            channel: "feishu",
            ...(accountId ? { accountId } : {}),
            peer: { kind: "direct", id: senderOpenId },
          },
        },
      ],
    };

    await runtime.config.writeConfigFile(updatedCfg);
    return { created: true, updatedCfg, agentId };
  }

  // Resolve path templates with substitutions
  const workspaceTemplate = dynamicCfg.workspaceTemplate ?? "~/.openclaw/workspace-{agentId}";

  const workspace = resolveUserPath(
    workspaceTemplate.replace("{userId}", senderOpenId).replace("{agentId}", agentId),
  );
  const agentDir = resolveUserPath(
    resolveAgentDirTemplate({ dynamicCfg, senderOpenId, agentId }),
  );

  log(`feishu: creating dynamic agent "${agentId}" for user ${senderOpenId}`);
  log(`  workspace: ${workspace}`);
  log(`  agentDir: ${agentDir}`);

  // Create directories
  await fs.promises.mkdir(workspace, { recursive: true });
  await fs.promises.mkdir(agentDir, { recursive: true });

  // Update configuration with new agent and binding
  const updatedCfg: OpenClawConfig = {
    ...cfg,
    agents: {
      ...cfg.agents,
      list: [...(cfg.agents?.list ?? []), { id: agentId, workspace, agentDir }],
    },
    bindings: [
      ...existingBindings,
      {
        agentId,
        match: {
          channel: "feishu",
          ...(accountId ? { accountId } : {}),
          peer: { kind: "direct", id: senderOpenId },
        },
      },
    ],
  };

  // Write updated config using PluginRuntime API
  await runtime.config.writeConfigFile(updatedCfg);

  return { created: true, updatedCfg, agentId };
}

/**
 * Resolve the target agentDir based on mode configuration.
 */
function resolveAgentDirTemplate(params: {
  dynamicCfg: DynamicAgentCreationConfig;
  senderOpenId: string;
  agentId: string;
}): string {
  const { dynamicCfg, senderOpenId, agentId } = params;

  // Determine target mode
  const mode = dynamicCfg.mode ?? "default";

  // Check if user is ignored (only matters for secretary mode)
  const ignoredUsers = dynamicCfg.ignoredUsers ?? [];
  const isIgnoredUser = ignoredUsers.includes(senderOpenId);

  // Resolve target template
  if (mode === "secretary" && !isIgnoredUser) {
    // Use secretary template with fallback
    const template = dynamicCfg.secretaryAgentDirTemplate;
    if (template) {
      return template.replace("{userId}", senderOpenId).replace("{agentId}", agentId);
    }
    // Fallback to hardcoded default
    return "~/.openclaw/agents/secretary/agent";
  }

  // Default mode or ignored user: use standard template
  const template = dynamicCfg.agentDirTemplate ?? "~/.openclaw/agents/{agentId}/agent";
  return template.replace("{userId}", senderOpenId).replace("{agentId}", agentId);
}

/**
 * Resolve a path that may start with ~ to the user's home directory.
 */
function resolveUserPath(p: string): string {
  if (p.startsWith("~/")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}
