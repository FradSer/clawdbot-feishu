import { describe, expect, it, vi, beforeEach } from "vitest";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { DynamicAgentCreationConfig } from "../types.js";
import { maybeCreateDynamicAgent } from "../dynamic-agent.js";

// Mock the fs module
vi.mock("node:fs", () => ({
  default: {
    promises: {
      mkdir: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

describe("maybeCreateDynamicAgent - secretary mode", () => {
  const createMockRuntime = () => ({
    config: {
      writeConfigFile: vi.fn().mockResolvedValue(undefined),
    },
  });

  const createBaseConfig = (overrides: Partial<OpenClawConfig> = {}): OpenClawConfig => ({
    bindings: [],
    agents: { list: [] },
    ...overrides,
  });

  const createDynamicCfg = (
    overrides: Partial<DynamicAgentCreationConfig> = {},
  ): DynamicAgentCreationConfig => ({
    enabled: true,
    workspaceTemplate: "~/.openclaw/workspace-{agentId}",
    agentDirTemplate: "~/.openclaw/agents/{agentId}/agent",
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Scenario: Creating a new agent in default mode", () => {
    it("Given mode is 'default', When creating agent for new user, Then uses agentDirTemplate", async () => {
      const runtime = createMockRuntime();
      const cfg = createBaseConfig();
      const dynamicCfg = createDynamicCfg({ mode: "default" });

      const result = await maybeCreateDynamicAgent({
        cfg,
        runtime: runtime as any,
        senderOpenId: "ou_123456",
        dynamicCfg,
        log: vi.fn(),
      });

      expect(result.created).toBe(true);
      const newAgent = result.updatedCfg.agents?.list.find((a) => a.id === "feishu-ou_123456");
      expect(newAgent?.agentDir).toBe("/Users/FradSer/.openclaw/agents/feishu-ou_123456/agent");
    });
  });

  describe("Scenario: Creating a new agent in secretary mode", () => {
    it("Given mode is 'secretary' and user NOT in ignoredUsers, When creating agent, Then uses secretaryAgentDirTemplate", async () => {
      const runtime = createMockRuntime();
      const cfg = createBaseConfig();
      const dynamicCfg = createDynamicCfg({
        mode: "secretary",
        secretaryAgentDirTemplate: "~/.openclaw/agents/secretary/{userId}/agent",
      });

      const result = await maybeCreateDynamicAgent({
        cfg,
        runtime: runtime as any,
        senderOpenId: "ou_123456",
        dynamicCfg,
        log: vi.fn(),
      });

      expect(result.created).toBe(true);
      const newAgent = result.updatedCfg.agents?.list.find((a) => a.id === "feishu-ou_123456");
      expect(newAgent?.agentDir).toBe("/Users/FradSer/.openclaw/agents/secretary/ou_123456/agent");
    });
  });

  describe("Scenario: Creating an agent for an ignored user in secretary mode", () => {
    it("Given mode is 'secretary' and user IS in ignoredUsers, When creating agent, Then uses agentDirTemplate (fallback)", async () => {
      const runtime = createMockRuntime();
      const cfg = createBaseConfig();
      const dynamicCfg = createDynamicCfg({
        mode: "secretary",
        secretaryAgentDirTemplate: "~/.openclaw/agents/secretary/{userId}/agent",
        ignoredUsers: ["ou_ignored"],
      });

      const result = await maybeCreateDynamicAgent({
        cfg,
        runtime: runtime as any,
        senderOpenId: "ou_ignored",
        dynamicCfg,
        log: vi.fn(),
      });

      expect(result.created).toBe(true);
      const newAgent = result.updatedCfg.agents?.list.find((a) => a.id === "feishu-ou_ignored");
      expect(newAgent?.agentDir).toBe("/Users/FradSer/.openclaw/agents/feishu-ou_ignored/agent");
    });
  });

  describe("Scenario: Toggling mode back to default updates existing agent", () => {
    it("Given existing agent with secretary agentDir, When mode changes to 'default', Then updates agentDir pointer only", async () => {
      const runtime = createMockRuntime();
      const cfg: OpenClawConfig = {
        bindings: [],
        agents: {
          list: [
            {
              id: "feishu-ou_123456",
              workspace: "/Users/FradSer/.openclaw/workspace/feishu-ou_123456",
              agentDir: "/Users/FradSer/.openclaw/agents/secretary/agent",
            },
          ],
        },
      };
      const dynamicCfg = createDynamicCfg({
        mode: "default",
      });

      const result = await maybeCreateDynamicAgent({
        cfg,
        runtime: runtime as any,
        senderOpenId: "ou_123456",
        dynamicCfg,
        log: vi.fn(),
      });

      expect(result.created).toBe(true);
      const updatedAgent = result.updatedCfg.agents?.list.find((a) => a.id === "feishu-ou_123456");
      // Should update agentDir to default template
      expect(updatedAgent?.agentDir).toBe("/Users/FradSer/.openclaw/agents/feishu-ou_123456/agent");
      // Workspace should remain unchanged
      expect(updatedAgent?.workspace).toBe("/Users/FradSer/.openclaw/workspace/feishu-ou_123456");
    });
  });

  describe("Scenario: Fallback to safe defaults if templates are undefined", () => {
    it("Given mode is 'secretary' and secretaryAgentDirTemplate is undefined, When creating agent, Then uses hardcoded default", async () => {
      const runtime = createMockRuntime();
      const cfg = createBaseConfig();
      const dynamicCfg: DynamicAgentCreationConfig = {
        enabled: true,
        mode: "secretary",
        // secretaryAgentDirTemplate is NOT defined
      };

      const result = await maybeCreateDynamicAgent({
        cfg,
        runtime: runtime as any,
        senderOpenId: "ou_123456",
        dynamicCfg,
        log: vi.fn(),
      });

      expect(result.created).toBe(true);
      const newAgent = result.updatedCfg.agents?.list.find((a) => a.id === "feishu-ou_123456");
      expect(newAgent?.agentDir).toBe("/Users/FradSer/.openclaw/agents/secretary/agent");
    });
  });
});
