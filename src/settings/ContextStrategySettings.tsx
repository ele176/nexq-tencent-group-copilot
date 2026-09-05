import { useState, useEffect, useCallback } from "react";
import { useConfigStore } from "../stores/configStore";
import { useRagStore } from "../stores/ragStore";
import { useRagEvents } from "../hooks/useRagEvents";
import type { ContextStrategy, RagConfig } from "../lib/types";
import {
  createGeminiContextCache,
  deleteGeminiContextCache,
  getGeminiCacheStatus,
  type GeminiCacheInfo,
} from "../lib/ipc";
import { showToast } from "../stores/toastStore";
import {
  Database,
  Cloud,
  Wifi,
  WifiOff,
  Download,
  RefreshCw,
  Trash2,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  X,
  Zap,
  Target,
  Gauge,
  FlameKindling,
} from "lucide-react";

// ─── Preset Definitions ───────────────────────────────────────────────────────
const PRESETS = [
  {
    id: "fastest",
    label: "最快",
    ms: "~10ms",
    icon: Zap,
    description: "仅关键词搜索，查询时无需向量化",
    config: {
      search_mode: "keyword",
      top_k: 3,
      chunk_size: 256,
      chunk_overlap: 16,
      embedding_model: "all-minilm",
      semantic_weight: 0.3,
      batch_size: 32,
      similarity_threshold: 0.1,
    },
  },
  {
    id: "faster",
    label: "较快",
    ms: "~80ms",
    icon: Gauge,
    description: "小型嵌入模型的混合搜索",
    config: {
      search_mode: "hybrid",
      top_k: 3,
      chunk_size: 512,
      chunk_overlap: 64,
      embedding_model: "all-minilm",
      semantic_weight: 0.7,
      batch_size: 32,
      similarity_threshold: 0.2,
    },
  },
  {
    id: "default",
    label: "默认",
    ms: "~200ms",
    icon: Target,
    description: "速度与精度的最佳平衡",
    config: {
      search_mode: "hybrid",
      top_k: 5,
      chunk_size: 512,
      chunk_overlap: 64,
      embedding_model: "nomic-embed-text",
      semantic_weight: 0.7,
      batch_size: 32,
      similarity_threshold: 0.3,
    },
  },
  {
    id: "accurate",
    label: "精准",
    ms: "~350ms",
    icon: Target,
    description: "更多结果、更细分块、覆盖更全",
    config: {
      search_mode: "hybrid",
      top_k: 10,
      chunk_size: 256,
      chunk_overlap: 64,
      embedding_model: "nomic-embed-text",
      semantic_weight: 0.7,
      batch_size: 32,
      similarity_threshold: 0.2,
    },
  },
  {
    id: "most_accurate",
    label: "最精准",
    ms: "~600ms",
    icon: Target,
    description: "高维模型、细粒度分块、最大化上下文",
    config: {
      search_mode: "hybrid",
      top_k: 15,
      chunk_size: 256,
      chunk_overlap: 128,
      embedding_model: "mxbai-embed-large",
      semantic_weight: 0.7,
      batch_size: 32,
      similarity_threshold: 0.2,
    },
  },
] as const;

const PRESET_KEYS: (keyof RagConfig)[] = [
  "search_mode", "top_k", "chunk_size", "chunk_overlap",
  "embedding_model", "semantic_weight", "batch_size", "similarity_threshold",
];

function getActivePresetId(config: RagConfig): string | null {
  for (const p of PRESETS) {
    const match = PRESET_KEYS.every(
      (k) => (config as any)[k] === (p.config as any)[k]
    );
    if (match) return p.id;
  }
  return null;
}

// ─── Help Content ─────────────────────────────────────────────────────────────
const HELP: Record<string, { title: string; body: string }> = {
  embedding_model: {
    title: "嵌入模型",
    body: `将文档和你的查询转换为向量，用于语义搜索。通过 Ollama 在本地运行。

• nomic-embed-text (768d) — 质量与速度的最佳平衡，约 150 毫秒/查询 ✓ 默认
• mxbai-embed-large (1024d) — 最高质量的向量，约 250 毫秒/查询，需要更多内存
• all-minilm (384d) — 最快（约 60 毫秒/查询），适合简单文档

⚠ 更换模型会使整个索引失效——需要完全重建。`,
  },
  top_k: {
    title: "检索结果数（top-K）",
    body: `与问题一起注入 LLM 提示词的文档分块数量。

• 3 块  → 约 300–600 token 上下文，LLM 响应最快
• 5 块  → 约 600–1000 token，平衡之选 ✓ 默认
• 10 块 → 约 1200–2000 token，对多部分问题覆盖更好
• 15–20 → 最适合信息分散的大型文档

分块越多 = LLM token 成本越高 + 生成时间略长。
推理延迟影响：每多 5 块约 +50 毫秒（LLM 输入）。`,
  },
  search_mode: {
    title: "搜索模式",
    body: `如何从索引中找出 top-K 个相关分块：

• 混合（推荐）— 通过 RRF 融合语义 + 关键词得分
  质量最佳，既能处理模糊问题（"介绍他们的背景"），
  也能处理精确查询（"Agency: State of Michigan"）。搜索耗时约 150–250 毫秒。

• 仅语义 — 纯嵌入相似度（余弦距离）
  适合概念性或换一种说法的问题。约 150–250 毫秒。
  精确术语若无语义关联可能匹配不到。

• 仅关键词 — BM25 精确文本匹配（查询时不做嵌入）
  最快：搜索约 5–15 毫秒。最适合名称、代码、精确短语。
  概念性问题或换述无法命中。`,
  },
  chunk_size: {
    title: "分块大小（token）",
    body: `每个被索引文档片段包含的 token 数量。

• 小（128–256）— 检索精确、分块更多、上下文具体
  适合密集技术文档的问答。分块越多搜索略慢。

• 中（512）— 平衡之选 ✓ 默认
  适合简历、职位描述、笔记。

• 大（1024–2048）— 每块叙事上下文更多、总块数更少
  适合散文类文档。风险：关键细节可能埋在大块中。

查询时延迟影响：极小（余弦扫描为 O(n)，约每 1000 块 1 毫秒）。
索引时间影响：块越小 = 向量越多 = 首次构建越久。

⚠ 更改后需要完全重建索引。`,
  },
  chunk_overlap: {
    title: "分块重叠（token）",
    body: `相邻分块之间重复的 token 数，用于避免在边界处切断句子或语义。

• 0       — 无重叠，索引最快，可能丢失边界上下文
• 32–64   — 推荐，可避免大多数边界切分问题 ✓ 默认（64）
• 128–256 — 叙事文本连续性更高，但索引体积和索引时间按比例增加

例如：chunk_size=512 且 overlap=64 时，每个分块与前一块共享
64 个 token，边界附近的关键句子会出现在两个分块中，更容易被检索到。

⚠ 更改后需要完全重建索引。`,
  },
  similarity_threshold: {
    title: "相似度阈值",
    body: `结果中纳入分块的最低相关性分数。

重要：该设置仅对「仅语义」模式真正有效。
在混合模式下，分数经过 RRF 融合（最大约 0.016），
设为大于 0.0 会过滤掉所有结果。混合模式请保持在 0.0–0.1。

仅语义模式（余弦相似度，范围 0–1）：
• 0.0–0.1 — 全部返回（质量门槛低）
• 0.3     — 过滤弱相关分块 ✓ 语义模式默认
• 0.5+    — 严格，可能漏掉部分相关内容

精度影响：阈值越高 = 结果越少但越精确。
延迟影响：无（过滤发生在搜索之后）。`,
  },
  semantic_weight: {
    title: "语义权重（混合模式）",
    body: `混合模式下，控制倒数排序融合（RRF）中语义与关键词得分的平衡。

公式：score = w_sem/(60+rank_sem) + (1-w_sem)/(60+rank_kw)

• 0.3 — 偏向关键词匹配（精确术语、名称、ID）
• 0.7 — 偏向语义理解 ✓ 默认
• 1.0 — 纯语义（等同于仅语义模式）
• 0.0 — 纯关键词（等同于仅关键词模式）

建议：
• 含精确术语的技术文档 → 0.4–0.5
• 叙事类文档、简历、文章 → 0.7–0.8
• 内容类型未知 → 保持 0.7

对仅语义或仅关键词模式无效。`,
  },
  batch_size: {
    title: "嵌入批处理大小",
    body: `构建索引阶段，每次嵌入 API 调用发送给 Ollama 的文本分块数量。

• 8–16  — 低内存机器（<4GB RAM）安全
• 32    — 平衡之选，比 batch=8 快约 2–3 倍 ✓ 默认
• 64    — 索引最快，批处理需要约 1–2GB 额外内存

不影响搜索延迟——只影响初始索引构建时间。

60 个分块在 batch=32 时约 2 次 Ollama 调用，batch=8 时约 8 次。`,
  },
};

// ─── Default Config ───────────────────────────────────────────────────────────
const DEFAULT_RAG_CONFIG: RagConfig = {
  enabled: true,
  embedding_model: "nomic-embed-text",
  ollama_url: "http://localhost:11434",
  batch_size: 32,
  chunk_size: 512,
  chunk_overlap: 64,
  splitting_strategy: "recursive",
  top_k: 5,
  search_mode: "hybrid",
  similarity_threshold: 0.3,
  semantic_weight: 0.7,
  include_transcript: false, // Transcript is sent as context window, not indexed
  embedding_dimensions: 768,
};

const MODEL_DIMS: Record<string, number> = {
  "nomic-embed-text": 768,
  "mxbai-embed-large": 1024,
  "all-minilm": 384,
};

const EMBEDDING_MODELS = [
  { id: "nomic-embed-text", label: "nomic-embed-text (768d)", dims: 768 },
  { id: "mxbai-embed-large", label: "mxbai-embed-large (1024d)", dims: 1024 },
  { id: "all-minilm", label: "all-minilm (384d)", dims: 384 },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function HelpButton({
  id,
  activeId,
  onToggle,
}: {
  id: string;
  activeId: string | null;
  onToggle: (id: string | null) => void;
}) {
  const isOpen = activeId === id;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onToggle(isOpen ? null : id); }}
      className={`inline-flex items-center justify-center rounded-full border transition-colors ${
        isOpen
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-border/30 text-muted-foreground/60 hover:border-border/60 hover:text-muted-foreground"
      } h-[18px] w-[18px]`}
      title="显示说明"
    >
      {isOpen ? <X className="h-2.5 w-2.5" /> : <HelpCircle className="h-2.5 w-2.5" />}
    </button>
  );
}

function HelpPanel({ id }: { id: string }) {
  const content = HELP[id];
  if (!content) return null;
  return (
    <div className="mt-2 rounded-lg border border-primary/20 bg-primary/5 px-3.5 py-3 space-y-1">
      <p className="text-xs font-semibold text-primary/80">{content.title}</p>
      <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line">
        {content.body}
      </p>
    </div>
  );
}

function SectionHelp({ id, activeId, onToggle }: { id: string; activeId: string | null; onToggle: (id: string | null) => void }) {
  return (
    <div className="flex items-center gap-2">
      <HelpButton id={id} activeId={activeId} onToggle={onToggle} />
    </div>
  );
}

function RebuildBadge({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-meta font-medium text-amber-500">
      需重建
    </span>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ─── Main Component ───────────────────────────────────────────────────────────
export function ContextStrategySettings() {
  const contextStrategy = useConfigStore((s) => s.contextStrategy);
  const setContextStrategy = useConfigStore((s) => s.setContextStrategy);

  const ragConfig = useRagStore((s) => s.ragConfig);
  const indexStatus = useRagStore((s) => s.indexStatus);
  const ollamaStatus = useRagStore((s) => s.ollamaStatus);
  const isIndexing = useRagStore((s) => s.isIndexing);
  const indexProgress = useRagStore((s) => s.indexProgress);
  const isPullingModel = useRagStore((s) => s.isPullingModel);
  const pullProgress = useRagStore((s) => s.pullProgress);
  const isCheckingConnection = useRagStore((s) => s.isCheckingConnection);
  const indexStale = useRagStore((s) => s.indexStale);

  const loadRagConfig = useRagStore((s) => s.loadRagConfig);
  const saveRagConfig = useRagStore((s) => s.saveRagConfig);
  const saveRagConfigWithStaleCheck = useRagStore((s) => s.saveRagConfigWithStaleCheck);
  const refreshIndexStatus = useRagStore((s) => s.refreshIndexStatus);
  const checkOllamaStatus = useRagStore((s) => s.checkOllamaStatus);
  const rebuildIndex = useRagStore((s) => s.rebuildIndex);
  const clearIndex = useRagStore((s) => s.clearIndex);
  const pullModel = useRagStore((s) => s.pullModel);

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmRebuild, setConfirmRebuild] = useState(false);
  const [localConfig, setLocalConfig] = useState<RagConfig>(DEFAULT_RAG_CONFIG);
  const [openHelp, setOpenHelp] = useState<string | null>(null);

  useRagEvents();

  useEffect(() => {
    loadRagConfig();
    refreshIndexStatus();
    checkOllamaStatus();
  }, [loadRagConfig, refreshIndexStatus, checkOllamaStatus]);

  useEffect(() => {
    if (ragConfig) {
      setLocalConfig({ ...ragConfig, include_transcript: false });
    }
  }, [ragConfig]);

  const handleStrategyChange = (strategy: ContextStrategy) => {
    setContextStrategy(strategy);
    const enabled = strategy === "local_rag";
    const updated = { ...localConfig, enabled, include_transcript: false };
    setLocalConfig(updated);
    saveRagConfig(updated);
  };

  const updateField = useCallback(
    <K extends keyof RagConfig>(key: K, value: RagConfig[K]) => {
      setLocalConfig((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const saveWithStaleCheck = useCallback(() => {
    if (ragConfig) {
      saveRagConfigWithStaleCheck({ ...localConfig, include_transcript: false }, ragConfig);
    } else {
      saveRagConfig({ ...localConfig, include_transcript: false });
    }
  }, [saveRagConfig, saveRagConfigWithStaleCheck, localConfig, ragConfig]);

  const handleFieldBlur = useCallback(() => {
    saveWithStaleCheck();
  }, [saveWithStaleCheck]);

  const handleSelectChange = useCallback(
    <K extends keyof RagConfig>(key: K, value: RagConfig[K]) => {
      const extraFields: Partial<RagConfig> = {};
      if (key === "embedding_model") {
        const dims = MODEL_DIMS[value as string] ?? 768;
        extraFields.embedding_dimensions = dims;
      }
      const updated = { ...localConfig, [key]: value, ...extraFields, include_transcript: false };
      setLocalConfig(updated);
      if (ragConfig) {
        saveRagConfigWithStaleCheck(updated, ragConfig);
      } else {
        saveRagConfig(updated);
      }
    },
    [localConfig, ragConfig, saveRagConfig, saveRagConfigWithStaleCheck]
  );

  const applyPreset = useCallback(
    (preset: (typeof PRESETS)[number]) => {
      const updated: RagConfig = {
        ...localConfig,
        ...preset.config,
        include_transcript: false,
        embedding_dimensions: MODEL_DIMS[preset.config.embedding_model] ?? 768,
      };
      setLocalConfig(updated);
      if (ragConfig) {
        saveRagConfigWithStaleCheck(updated, ragConfig);
      } else {
        saveRagConfig(updated);
      }
    },
    [localConfig, ragConfig, saveRagConfig, saveRagConfigWithStaleCheck]
  );

  const handleClearIndex = () => {
    if (confirmClear) {
      clearIndex();
      setConfirmClear(false);
    } else {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 3000);
    }
  };

  const handleRebuild = () => {
    if (indexStale && !confirmRebuild) {
      setConfirmRebuild(true);
      setTimeout(() => setConfirmRebuild(false), 4000);
      return;
    }
    setConfirmRebuild(false);
    rebuildIndex();
  };

  const handleResetDefaults = () => {
    const config = { ...DEFAULT_RAG_CONFIG, enabled: localConfig.enabled };
    setLocalConfig(config);
    saveRagConfig(config);
  };

  const toggleHelp = useCallback((id: string | null) => {
    setOpenHelp((prev) => (prev === id ? null : id));
  }, []);

  const selectedModelAvailable = ollamaStatus?.connected
    ? ollamaStatus.models.some(
        (m) =>
          m === localConfig.embedding_model ||
          m.startsWith(`${localConfig.embedding_model}:`)
      )
    : false;

  const totalChunks = indexStatus?.total_chunks ?? 0;
  const hasIndex = totalChunks > 0;
  const activePresetId = getActivePresetId(localConfig);

  return (
    <div className="space-y-6">
      {/* ── Strategy Selector ── */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => handleStrategyChange("local_rag")}
          className={`relative flex flex-col items-start rounded-xl border p-4 text-left transition-all duration-150 ${
            contextStrategy === "local_rag"
              ? "border-primary bg-primary/5 ring-1 ring-primary/20"
              : "border-border/50 hover:border-border hover:bg-accent/50"
          }`}
        >
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium text-foreground">本地 RAG</span>
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
            通过 Ollama 在本地向量化文档，语义+关键词混合搜索
          </p>
        </button>

        <button
          onClick={() => handleStrategyChange("gemini_cache")}
          className={`relative flex flex-col items-start rounded-xl border p-4 text-left transition-all duration-150 ${
            contextStrategy === "gemini_cache"
              ? "border-orange-400/60 bg-orange-400/5 ring-1 ring-orange-400/20"
              : "border-border/50 hover:border-border hover:bg-accent/50"
          }`}
        >
          <div className="flex items-center gap-2">
            <Cloud className="h-4 w-4 text-orange-400" />
            <span className="text-sm font-medium text-foreground">Gemini 上下文缓存</span>
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
            将文档一次性缓存到 Gemini——完全跳过本地向量化
          </p>
        </button>
      </div>

      {contextStrategy === "local_rag" && (
        <>
          {/* ── Quick Presets ── */}
          <div className="rounded-xl border border-border/30 bg-card/50 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-primary/80">快速预设</h3>
              <p className="text-meta text-muted-foreground/60">
                每次查询的预期搜索延迟
              </p>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {PRESETS.map((preset) => {
                const isActive = activePresetId === preset.id;
                return (
                  <button
                    key={preset.id}
                    onClick={() => applyPreset(preset)}
                    title={preset.description}
                    className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-2.5 text-center transition-all ${
                      isActive
                        ? "border-primary bg-primary/10 ring-1 ring-primary/20"
                        : "border-border/30 bg-background hover:border-border/60 hover:bg-accent/40"
                    }`}
                  >
                    <span className={`text-xs font-semibold ${isActive ? "text-primary" : "text-foreground"}`}>
                      {preset.label}
                    </span>
                    <span className={`rounded-full px-1.5 py-0.5 text-meta font-medium font-mono ${
                      isActive ? "bg-primary/20 text-primary" : "bg-muted/50 text-muted-foreground"
                    }`}>
                      {preset.ms}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-2.5 text-meta text-muted-foreground/70 leading-relaxed">
              延迟 = 查询向量化 + 分块搜索。「最快」仅用关键词（无需向量化）。
              「精准」预设分块更小、检索更多——需要重建索引。
            </p>
          </div>

          {/* ── Connection ── */}
          <div className="rounded-xl border border-border/30 bg-card/50 p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-primary/80">连接</h3>
            </div>
            <div className="space-y-4">
              {/* Ollama status */}
              <div className="flex items-center gap-3">
                {ollamaStatus?.connected ? (
                  <>
                    <div className="h-2.5 w-2.5 rounded-full bg-success" />
                    <Wifi className="h-3.5 w-3.5 text-success" />
                    <span className="text-xs text-success">Ollama 已连接</span>
                    <span className="text-meta text-muted-foreground">
                      （{ollamaStatus.models.length} 个模型）
                    </span>
                  </>
                ) : (
                  <>
                    <div className="h-2.5 w-2.5 rounded-full bg-red-500" />
                    <WifiOff className="h-3.5 w-3.5 text-red-500" />
                    <span className="text-xs text-red-500">Ollama 未连接</span>
                    <span className="text-meta text-muted-foreground/60">——请启动 Ollama 以使用向量嵌入</span>
                  </>
                )}
              </div>

              {ollamaStatus?.connected && (
                <div className="flex items-center gap-2 text-xs">
                  {selectedModelAvailable ? (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                      <span className="text-success">{localConfig.embedding_model} 可用</span>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                      <span className="text-amber-500">
                        {localConfig.embedding_model} 未找到——请在下方拉取
                      </span>
                    </>
                  )}
                </div>
              )}

              {/* Embedding model */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                    嵌入模型
                    <HelpButton id="embedding_model" activeId={openHelp} onToggle={toggleHelp} />
                  </label>
                  <RebuildBadge show={hasIndex && localConfig.embedding_model !== (ragConfig?.embedding_model ?? "nomic-embed-text")} />
                </div>
                {openHelp === "embedding_model" && <HelpPanel id="embedding_model" />}
                <select
                  value={localConfig.embedding_model}
                  onChange={(e) => handleSelectChange("embedding_model", e.target.value)}
                  className="w-full rounded-lg border border-border/50 bg-background px-3.5 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20 mt-1.5"
                >
                  {EMBEDDING_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              </div>

              {/* Buttons */}
              <div className="flex items-center gap-2">
                <button
                  onClick={checkOllamaStatus}
                  disabled={isCheckingConnection}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border/50 bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isCheckingConnection ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wifi className="h-3.5 w-3.5" />}
                  测试连接
                </button>
                <button
                  onClick={() => pullModel(localConfig.embedding_model)}
                  disabled={isPullingModel}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border/50 bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isPullingModel ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                  {isPullingModel ? "拉取中..." : "拉取模型"}
                </button>
              </div>

              {isPullingModel && (
                <div className="space-y-1.5 rounded-lg border border-border/20 bg-background/50 p-3">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <Loader2 className="h-3 w-3 animate-spin text-primary" />
                      {pullProgress?.status || "连接中..."}
                    </span>
                    {pullProgress && pullProgress.total > 0 && (
                      <span className="font-mono">
                        {Math.round((pullProgress.completed / pullProgress.total) * 100)}%
                        <span className="text-muted-foreground/70 ml-1">
                          ({formatBytes(pullProgress.completed)} / {formatBytes(pullProgress.total)})
                        </span>
                      </span>
                    )}
                  </div>
                  {pullProgress && pullProgress.total > 0 && (
                    <div className="h-1.5 rounded-full bg-muted/40">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${Math.round((pullProgress.completed / pullProgress.total) * 100)}%` }}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── Search Settings ── */}
          <div className="rounded-xl border border-border/30 bg-card/50 p-5">
            <h3 className="mb-3 text-sm font-semibold text-primary/80">搜索设置</h3>
            <div className="grid grid-cols-2 gap-4">
              {/* top-K */}
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <label className="text-xs font-medium text-foreground">
                    检索结果数（top-K）
                  </label>
                  <HelpButton id="top_k" activeId={openHelp} onToggle={toggleHelp} />
                </div>
                {openHelp === "top_k" && (
                  <div className="col-span-2 mb-2"><HelpPanel id="top_k" /></div>
                )}
                <select
                  value={localConfig.top_k}
                  onChange={(e) => handleSelectChange("top_k", Number(e.target.value))}
                  className="w-full rounded-lg border border-border/50 bg-background px-3.5 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
                >
                  {[3, 5, 7, 10, 15, 20].map((v) => (
                    <option key={v} value={v}>{v} 个分块</option>
                  ))}
                </select>
              </div>

              {/* Search mode */}
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <label className="text-xs font-medium text-foreground">搜索模式</label>
                  <HelpButton id="search_mode" activeId={openHelp} onToggle={toggleHelp} />
                </div>
                <select
                  value={localConfig.search_mode}
                  onChange={(e) => handleSelectChange("search_mode", e.target.value)}
                  className="w-full rounded-lg border border-border/50 bg-background px-3.5 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
                >
                  <option value="hybrid">混合（推荐）</option>
                  <option value="semantic">仅语义</option>
                  <option value="keyword">仅关键词（最快）</option>
                </select>
              </div>
            </div>
            {/* Help panels for search settings (full width) */}
            {openHelp === "search_mode" && <div className="mt-3"><HelpPanel id="search_mode" /></div>}
          </div>

          {/* ── Index Status ── */}
          <div className={`rounded-xl border bg-card/50 p-5 ${
            indexStale ? "border-amber-500/40 ring-1 ring-amber-500/10" : "border-border/30"
          }`}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-primary/80">索引状态</h3>
              {indexStale && (
                <div className="flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-meta font-medium text-amber-500">
                  <AlertTriangle className="h-3 w-3" />
                  设置已更改——需要重建
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-lg bg-accent/20 px-3 py-2.5">
                <span className="text-muted-foreground">已索引文件</span>
                <p className="mt-0.5 text-sm font-medium text-foreground">
                  {indexStatus?.indexed_files ?? 0} / {indexStatus?.total_files ?? 0}
                </p>
              </div>
              <div className="rounded-lg bg-accent/20 px-3 py-2.5">
                <span className="text-muted-foreground">分块总数</span>
                <p className="mt-0.5 text-sm font-medium text-foreground">
                  {indexStatus?.total_chunks ?? 0}
                </p>
              </div>
              <div className="rounded-lg bg-accent/20 px-3 py-2.5">
                <span className="text-muted-foreground">token 总数</span>
                <p className="mt-0.5 text-sm font-medium text-foreground">
                  {indexStatus?.total_tokens ? `~${Math.round(indexStatus.total_tokens / 1000)}k` : "0"}
                </p>
              </div>
              <div className="rounded-lg bg-accent/20 px-3 py-2.5">
                <span className="text-muted-foreground">上次索引</span>
                <p className="mt-0.5 text-sm font-medium text-foreground truncate">
                  {indexStatus?.last_indexed_at
                    ? new Date(indexStatus.last_indexed_at).toLocaleString()
                    : "从未"}
                </p>
              </div>
            </div>

            {isIndexing && indexProgress && (
              <div className="mt-3 space-y-1.5">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{indexProgress.status}</span>
                  <span>{indexProgress.filesDone}/{indexProgress.filesTotal} 个文件</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted/40">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{
                      width: indexProgress.filesTotal > 0
                        ? `${Math.round((indexProgress.filesDone / indexProgress.filesTotal) * 100)}%`
                        : "0%",
                    }}
                  />
                </div>
              </div>
            )}

            <div className="mt-4 flex items-center gap-2">
              <button
                onClick={handleRebuild}
                disabled={isIndexing}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  indexStale
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
                    : "border-border/50 bg-background text-foreground hover:bg-accent"
                }`}
              >
                {isIndexing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                {confirmRebuild ? "确认重建" : indexStale ? "需要重建" : hasIndex ? "重建索引" : "构建索引"}
              </button>
              <button
                onClick={handleClearIndex}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                  confirmClear
                    ? "border-destructive/50 bg-destructive/10 text-destructive hover:bg-destructive/20"
                    : "border-border/50 bg-background text-foreground hover:bg-accent"
                }`}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {confirmClear ? "确认清除" : "清除索引"}
              </button>
            </div>
          </div>

          {/* ── Advanced Settings ── */}
          <div className="rounded-xl border border-border/30 bg-card/50">
            <button
              onClick={() => setAdvancedOpen(!advancedOpen)}
              className="flex w-full items-center justify-between px-5 py-3.5 text-sm font-semibold text-primary/80 transition-colors hover:bg-accent/20"
            >
              <span>高级设置</span>
              {advancedOpen
                ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                : <ChevronRight className="h-4 w-4 text-muted-foreground" />
              }
            </button>

            {advancedOpen && (
              <div className="border-t border-border/20 px-5 py-4 space-y-5">

                {/* Chunk Size */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
                      分块大小
                      <HelpButton id="chunk_size" activeId={openHelp} onToggle={toggleHelp} />
                      <RebuildBadge show={hasIndex && localConfig.chunk_size !== (ragConfig?.chunk_size ?? 512)} />
                    </label>
                    <span className="text-xs text-muted-foreground font-mono">{localConfig.chunk_size} tokens</span>
                  </div>
                  {openHelp === "chunk_size" && <HelpPanel id="chunk_size" />}
                  <input
                    type="range" min={128} max={2048} step={64}
                    value={localConfig.chunk_size}
                    onChange={(e) => updateField("chunk_size", Number(e.target.value))}
                    onMouseUp={handleFieldBlur} onTouchEnd={handleFieldBlur}
                    className="w-full accent-primary mt-1.5"
                  />
                  <div className="flex justify-between text-meta text-muted-foreground/60">
                    <span>128——精确</span><span>2048——宽泛</span>
                  </div>
                </div>

                {/* Chunk Overlap */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
                      分块重叠
                      <HelpButton id="chunk_overlap" activeId={openHelp} onToggle={toggleHelp} />
                      <RebuildBadge show={hasIndex && localConfig.chunk_overlap !== (ragConfig?.chunk_overlap ?? 64)} />
                    </label>
                    <span className="text-xs text-muted-foreground font-mono">{localConfig.chunk_overlap} tokens</span>
                  </div>
                  {openHelp === "chunk_overlap" && <HelpPanel id="chunk_overlap" />}
                  <input
                    type="range" min={0} max={512} step={16}
                    value={localConfig.chunk_overlap}
                    onChange={(e) => updateField("chunk_overlap", Number(e.target.value))}
                    onMouseUp={handleFieldBlur} onTouchEnd={handleFieldBlur}
                    className="w-full accent-primary mt-1.5"
                  />
                  <div className="flex justify-between text-meta text-muted-foreground/60">
                    <span>0——无重叠</span><span>512——最大连续性</span>
                  </div>
                </div>

                {/* Similarity Threshold */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
                      相似度阈值
                      <HelpButton id="similarity_threshold" activeId={openHelp} onToggle={toggleHelp} />
                      {localConfig.search_mode !== "semantic" && (
                        <span className="rounded-full bg-muted/60 px-1.5 py-0.5 text-meta text-muted-foreground/60">
                          仅语义模式有效
                        </span>
                      )}
                    </label>
                    <span className="text-xs text-muted-foreground font-mono">{localConfig.similarity_threshold.toFixed(2)}</span>
                  </div>
                  {openHelp === "similarity_threshold" && <HelpPanel id="similarity_threshold" />}
                  <input
                    type="range" min={0} max={0.9} step={0.05}
                    value={localConfig.similarity_threshold}
                    onChange={(e) => updateField("similarity_threshold", Number(e.target.value))}
                    onMouseUp={handleFieldBlur} onTouchEnd={handleFieldBlur}
                    className="w-full accent-primary mt-1.5"
                  />
                  <div className="flex justify-between text-meta text-muted-foreground/60">
                    <span>0.0——全部包含</span><span>0.9——严格</span>
                  </div>
                </div>

                {/* Semantic Weight */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
                      语义权重
                      <HelpButton id="semantic_weight" activeId={openHelp} onToggle={toggleHelp} />
                      {localConfig.search_mode !== "hybrid" && (
                        <span className="rounded-full bg-muted/60 px-1.5 py-0.5 text-meta text-muted-foreground/60">
                          仅混合模式有效
                        </span>
                      )}
                    </label>
                    <span className="text-xs text-muted-foreground font-mono">
                      语义 {Math.round(localConfig.semantic_weight * 100)}% / 关键词 {Math.round((1 - localConfig.semantic_weight) * 100)}%
                    </span>
                  </div>
                  {openHelp === "semantic_weight" && <HelpPanel id="semantic_weight" />}
                  <input
                    type="range" min={0} max={1} step={0.05}
                    value={localConfig.semantic_weight}
                    onChange={(e) => updateField("semantic_weight", Number(e.target.value))}
                    onMouseUp={handleFieldBlur} onTouchEnd={handleFieldBlur}
                    className="w-full accent-primary mt-1.5"
                  />
                  <div className="flex justify-between text-meta text-muted-foreground/60">
                    <span>0.0——关键词</span><span>1.0——语义</span>
                  </div>
                </div>

                {/* Ollama URL */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-foreground">
                    Ollama 地址
                  </label>
                  <input
                    type="text"
                    value={localConfig.ollama_url}
                    onChange={(e) => updateField("ollama_url", e.target.value)}
                    onBlur={handleFieldBlur}
                    placeholder="http://localhost:11434"
                    className="w-full rounded-lg border border-border/50 bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
                  />
                </div>

                {/* Batch Size */}
                <div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <label className="text-xs font-medium text-foreground">批处理大小</label>
                    <HelpButton id="batch_size" activeId={openHelp} onToggle={toggleHelp} />
                  </div>
                  {openHelp === "batch_size" && <HelpPanel id="batch_size" />}
                  <select
                    value={localConfig.batch_size}
                    onChange={(e) => handleSelectChange("batch_size", Number(e.target.value))}
                    className="w-full rounded-lg border border-border/50 bg-background px-3.5 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20 mt-1"
                  >
                    {[8, 16, 32, 64].map((v) => (
                      <option key={v} value={v}>{v} 分块/请求</option>
                    ))}
                  </select>
                </div>

                {/* Reset */}
                <button
                  onClick={handleResetDefaults}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border/50 bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  恢复默认
                </button>
              </div>
            )}
          </div>

          {/* ── How it works during meetings ── */}
          <div className="rounded-xl border border-border/20 bg-accent/10 px-4 py-3">
            <p className="text-xs text-muted-foreground/70 leading-relaxed">
              <span className="font-semibold text-foreground/70">会议期间：</span>
              实时转写文本以滚动上下文窗口的形式发送（在「通用」设置中配置），不会存入 RAG 索引。
              RAG 会从预索引文档中检索最相关的 top-{localConfig.top_k} 个分块，二者一起注入 LLM 提示词。
            </p>
          </div>
        </>
      )}

      <GeminiCachePanel />
    </div>
  );
}

// ─── Gemini Context Cache Panel ───────────────────────────────────────────────
function GeminiCachePanel() {
  const contextStrategy = useConfigStore((s) => s.contextStrategy);
  const [cache, setCache] = useState<GeminiCacheInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState("gemini-2.0-flash-001");
  const [ttl, setTtl] = useState(3600);

  useEffect(() => {
    if (contextStrategy !== "gemini_cache") return;
    getGeminiCacheStatus().then(setCache).catch(() => {});
  }, [contextStrategy]);

  if (contextStrategy !== "gemini_cache") return null;

  async function handleCreate() {
    setLoading(true);
    try {
      const info = await createGeminiContextCache(model, ttl);
      setCache(info);
      showToast(`缓存已创建——已缓存 ${info.total_token_count.toLocaleString()} 个 token`, "success");
    } catch (e: any) {
      showToast(String(e), "error");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    setLoading(true);
    try {
      await deleteGeminiContextCache();
      setCache(null);
      showToast("Gemini 缓存已清除", "success");
    } catch (e: any) {
      showToast(String(e), "error");
    } finally {
      setLoading(false);
    }
  }

  const expireLabel = cache
    ? new Date(cache.expire_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className="rounded-xl border border-border/30 bg-card/50 p-5 space-y-4">
      <div className="flex items-center gap-2">
        <FlameKindling className="h-4 w-4 text-orange-400" />
        <h3 className="text-sm font-semibold text-foreground">Gemini 上下文缓存</h3>
        {cache && (
          <span className="ml-auto flex items-center gap-1 rounded-full bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-400">
            <CheckCircle2 className="h-3 w-3" /> 使用中 · {expireLabel} 过期
          </span>
        )}
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">
        将上下文文档一次性上传到 Gemini 服务器。每次查询完全跳过本地向量化——
        在纯 CPU 机器上<span className="text-foreground/80 font-medium">每次回复快约 3–5 秒</span>。
      </p>

      {!cache ? (
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="mb-1 block text-xs text-muted-foreground">模型</label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
              >
                <option value="gemini-2.0-flash-001">gemini-2.0-flash-001</option>
                <option value="gemini-1.5-flash-001">gemini-1.5-flash-001</option>
                <option value="gemini-1.5-pro-001">gemini-1.5-pro-001</option>
              </select>
            </div>
            <div className="w-28">
              <label className="mb-1 block text-xs text-muted-foreground">TTL</label>
              <select
                value={ttl}
                onChange={(e) => setTtl(Number(e.target.value))}
                className="w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
              >
                <option value={1800}>30 分钟</option>
                <option value={3600}>1 小时</option>
                <option value={7200}>2 小时</option>
                <option value={86400}>24 小时</option>
              </select>
            </div>
          </div>
          <button
            onClick={handleCreate}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Cloud className="h-3.5 w-3.5" />}
            从上下文文档创建缓存
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between rounded-lg border border-border/30 bg-background/50 px-4 py-3">
          <div className="text-xs text-muted-foreground space-y-0.5">
            <p><span className="text-foreground/70 font-medium">模型：</span> {cache.model.replace("models/", "")}</p>
            <p><span className="text-foreground/70 font-medium">已缓存 token：</span> {cache.total_token_count.toLocaleString()}</p>
          </div>
          <button
            onClick={handleDelete}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border/50 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-red-500/50 hover:text-red-400 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
            清除
          </button>
        </div>
      )}
    </div>
  );
}
