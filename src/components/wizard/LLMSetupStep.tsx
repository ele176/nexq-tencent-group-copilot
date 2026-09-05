import { useState, useEffect, useCallback } from "react";
import { useConfigStore } from "../../stores/configStore";
import {
  listModels,
  setLLMProvider,
  setActiveModel,
  storeApiKey,
  testLLMConnection,
} from "../../lib/ipc";
import type { LLMProviderType, ModelInfo } from "../../lib/types";
import {
  Server,
  Cloud,
  CheckCircle,
  XCircle,
  Loader2,
  Eye,
  EyeOff,
  Sparkles,
  Zap,
  Brain,
  RefreshCw,
} from "lucide-react";

interface LLMSetupStepProps {
  ollamaRunning: boolean;
  ollamaModels: string[];
  lmStudioRunning: boolean;
  lmStudioModels: string[];
}

type ConnectionStatus = "idle" | "testing" | "success" | "error";

interface ProviderCard {
  type: LLMProviderType;
  label: string;
  description: string;
  icon: React.ReactNode;
  recommended?: boolean;
  requiresKey: boolean;
}

const CLOUD_PROVIDERS: ProviderCard[] = [
  {
    type: "anthropic",
    label: "Anthropic",
    description: "Claude Sonnet, Opus, Haiku",
    icon: <Brain className="h-5 w-5" />,
    recommended: true,
    requiresKey: true,
  },
  {
    type: "openai",
    label: "OpenAI",
    description: "GPT-4o, GPT-4, etc.",
    icon: <Sparkles className="h-5 w-5" />,
    requiresKey: true,
  },
  {
    type: "groq",
    label: "Groq",
    description: "Ultra-fast inference",
    icon: <Zap className="h-5 w-5" />,
    requiresKey: true,
  },
];

export function LLMSetupStep({
  ollamaRunning,
  ollamaModels,
  lmStudioRunning,
  lmStudioModels,
}: LLMSetupStepProps) {
  const llmProvider = useConfigStore((s) => s.llmProvider);
  const llmModel = useConfigStore((s) => s.llmModel);
  const setConfigProvider = useConfigStore((s) => s.setLLMProvider);
  const setConfigModel = useConfigStore((s) => s.setLLMModel);

  const hasLocalLLM = ollamaRunning || lmStudioRunning;

  const [selectedProvider, setSelectedProvider] = useState<LLMProviderType>(
    hasLocalLLM
      ? ollamaRunning
        ? "ollama"
        : "lm_studio"
      : "anthropic"
  );
  const [selectedModel, setSelectedModel] = useState(llmModel || "");
  const [apiKey, setApiKeyValue] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("idle");
  const [connectionMessage, setConnectionMessage] = useState("");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);

  // Auto-load models for local providers
  useEffect(() => {
    if (selectedProvider === "ollama" && ollamaRunning) {
      handleLoadModels();
    } else if (selectedProvider === "lm_studio" && lmStudioRunning) {
      handleLoadModels();
    }
  }, [selectedProvider]); // eslint-disable-line react-hooks/exhaustive-deps

  const requiresApiKey = ["openai", "anthropic", "groq", "gemini", "openrouter"].includes(
    selectedProvider
  );

  const buildProviderConfig = useCallback(() => {
    const config: Record<string, unknown> = {
      provider_type: selectedProvider,
    };
    if (apiKey) config.api_key = apiKey;
    return JSON.stringify(config);
  }, [selectedProvider, apiKey]);

  async function handleProviderSelect(provider: LLMProviderType) {
    setSelectedProvider(provider);
    setSelectedModel("");
    setModels([]);
    setConnectionStatus("idle");
    setConnectionMessage("");
  }

  async function handleLoadModels() {
    setModelsLoading(true);
    setModels([]);
    try {
      if (apiKey) {
        await storeApiKey(selectedProvider, apiKey).catch(() => {});
      }
      const configJson = buildProviderConfig();
      await setLLMProvider(configJson).catch(() => {});
      const modelList = await listModels(configJson);
      setModels(modelList);
    } catch (err) {
      console.warn("[LLMSetupStep] Failed to load models:", err);
    } finally {
      setModelsLoading(false);
    }
  }

  async function handleTestConnection() {
    setConnectionStatus("testing");
    setConnectionMessage("");
    try {
      if (apiKey) {
        await storeApiKey(selectedProvider, apiKey).catch(() => {});
      }
      const configJson = buildProviderConfig();
      const success = await testLLMConnection(configJson);
        if (success) {
        setConnectionStatus("success");
        setConnectionMessage("连接成功");
        await setLLMProvider(configJson).catch(() => {});
        setConfigProvider(selectedProvider);
      } else {
        setConnectionStatus("error");
        setConnectionMessage("连接失败");
      }
    } catch (err) {
      setConnectionStatus("error");
      setConnectionMessage(
        err instanceof Error ? err.message : "连接失败"
      );
    }
  }

  async function handleModelSelect(modelId: string) {
    setSelectedModel(modelId);
    setConfigModel(modelId);
    setConfigProvider(selectedProvider);
    try {
      await setActiveModel(selectedProvider, modelId);
    } catch {
      // Non-critical
    }
  }

  async function handleSaveApiKey() {
    if (!apiKey) return;
    try {
      await storeApiKey(selectedProvider, apiKey);
    } catch {
      // Silently handle
    }
  }

  return (
    <div className="flex flex-col items-center">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 shadow-md shadow-primary/10">
          <Brain className="h-7 w-7 text-primary" />
        </div>
        <h2 className="text-2xl font-bold text-foreground">AI 模型配置</h2>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
          选择为会议助手提供能力的 AI 模型。
        </p>
      </div>

      <div className="w-full max-w-lg space-y-6">
        {/* Local LLM Detection Banner */}
        {hasLocalLLM && (
          <div className="rounded-xl border border-success/20 bg-success/5 px-5 py-4">
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 text-success" />
              <p className="text-sm font-medium text-success">
                检测到本地模型
              </p>
             </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {ollamaRunning &&
                `Ollama 正在运行，共 ${ollamaModels.length} 个模型。`}
              {lmStudioRunning &&
                `LM Studio 正在运行，共 ${lmStudioModels.length} 个模型。`}
              数据不会离开你的电脑。
            </p>
          </div>
        )}

        {/* Local Provider Cards */}
        {hasLocalLLM && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              本地服务商
            </p>
            <div className="grid gap-2">
              {ollamaRunning && (
                <ProviderButton
                  label="Ollama"
                  description={`可用模型 ${ollamaModels.length} 个`}
                  icon={<Server className="h-5 w-5" />}
                  selected={selectedProvider === "ollama"}
                  recommended
                  onClick={() => handleProviderSelect("ollama")}
                />
              )}
              {lmStudioRunning && (
                <ProviderButton
                  label="LM Studio"
                  description={`可用模型 ${lmStudioModels.length} 个`}
                  icon={<Server className="h-5 w-5" />}
                  selected={selectedProvider === "lm_studio"}
                  onClick={() => handleProviderSelect("lm_studio")}
                />
              )}
            </div>
          </div>
        )}

        {/* Cloud Provider Cards */}
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            云端服务商
          </p>
          <div className="grid gap-2">
            {CLOUD_PROVIDERS.map((p) => (
              <ProviderButton
                key={p.type}
                label={p.label}
                description={p.description}
                icon={p.icon}
                selected={selectedProvider === p.type}
                recommended={!hasLocalLLM && p.recommended}
                onClick={() => handleProviderSelect(p.type)}
              />
            ))}
          </div>
        </div>

        {/* API Key Input */}
        {requiresApiKey && (
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              API 密钥
            </label>
            <div className="relative">
              <input
                type={showApiKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKeyValue(e.target.value)}
                onBlur={handleSaveApiKey}
                placeholder={`请输入 ${selectedProvider === "anthropic" ? "Anthropic" : selectedProvider === "openai" ? "OpenAI" : selectedProvider === "openrouter" ? "OpenRouter" : selectedProvider === "gemini" ? "Gemini" : "Groq"} API 密钥`}
                aria-label="API key"
                className="w-full rounded-xl border border-border/40 bg-background px-4 py-3 pr-11 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
              />
              <button
                onClick={() => setShowApiKey(!showApiKey)}
                aria-label={showApiKey ? "Hide API key" : "Show API key"}
                aria-pressed={showApiKey}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
              >
                {showApiKey ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              安全存储在系统凭据管理器中
            </p>
          </div>
        )}

        {/* Test Connection & Load Models */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleTestConnection}
            disabled={
              connectionStatus === "testing" ||
              (requiresApiKey && !apiKey)
            }
            className="inline-flex items-center gap-2 rounded-xl border border-border/40 bg-background px-4 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            {connectionStatus === "testing" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCircle className="h-3.5 w-3.5" />
            )}
            测试连接
          </button>
          <button
            onClick={handleLoadModels}
            disabled={modelsLoading || (requiresApiKey && !apiKey)}
            className="inline-flex items-center gap-2 rounded-xl border border-border/40 bg-background px-4 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            {modelsLoading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            加载模型
          </button>
          {connectionStatus === "success" && (
            <span className="flex items-center gap-1 text-xs text-success">
              <CheckCircle className="h-3 w-3" />
              {connectionMessage}
            </span>
          )}
          {connectionStatus === "error" && (
            <span className="flex items-center gap-1 text-xs text-destructive">
              <XCircle className="h-3 w-3" />
              {connectionMessage}
            </span>
          )}
        </div>

        {/* Model Selection */}
        {models.length > 0 && (
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              选择模型
            </label>
            <select
              value={selectedModel}
              onChange={(e) => handleModelSelect(e.target.value)}
              className="w-full rounded-xl border border-border/40 bg-background px-4 py-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
            >
              <option value="">选择一个模型...</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.context_window
                    ? ` (${Math.round(m.context_window / 1000)}K ctx)`
                    : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Recommendation */}
        <div className="rounded-xl border border-border/20 bg-secondary/20 px-5 py-4">
          <p className="text-xs text-muted-foreground leading-relaxed">
            <span className="font-medium text-foreground">提示：</span>
            {hasLocalLLM
              ? "为兼顾隐私和速度，推荐使用 Ollama 本地模型，对话数据不会离开你的电脑。"
              : "推荐使用 OpenRouter（免费注册、模型丰富，支持 Gemini 等适合中文的模型）。本地隐私方案可安装 Ollama 后在启动 NexQ 前运行。"}
          </p>
        </div>
      </div>
    </div>
  );
}

function ProviderButton({
  label,
  description,
  icon,
  selected,
  recommended,
  onClick,
}: {
  label: string;
  description: string;
  icon: React.ReactNode;
  selected: boolean;
  recommended?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative flex items-center gap-4 rounded-xl border px-5 py-4 text-left transition-all duration-150 ${
        selected
          ? "border-primary bg-primary/5 ring-1 ring-primary/20 shadow-sm"
          : "border-border/40 hover:border-border/60 hover:bg-accent/20"
      }`}
    >
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
          selected
            ? "bg-primary/10 text-primary"
            : "bg-secondary/40 text-muted-foreground"
        }`}
      >
        {icon}
      </div>
      <div className="flex-1">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {recommended && (
        <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-meta font-medium text-primary">
          推荐
        </span>
      )}
      {selected && (
        <CheckCircle className="h-4 w-4 shrink-0 text-primary" />
      )}
    </button>
  );
}
