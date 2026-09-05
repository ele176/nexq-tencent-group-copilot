import { useState, useEffect, useCallback, useMemo } from "react";
import { useAIActionsStore } from "../stores/aiActionsStore";
import type { ActionConfig, InstructionPresets } from "../lib/types";
import {
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Trash2,
  Plus,
  MessageSquare,
  Zap,
  Layers,
  Sparkles,
  HelpCircle,
  X,
} from "lucide-react";

// ─── Constants ───────────────────────────────────────────

const BUILT_IN_MODES = [
  "Assist",
  "WhatToSay",
  "Shorten",
  "FollowUp",
  "Recap",
  "AskQuestion",
];

const ACTION_DESCRIPTIONS: Record<string, string> = {
  Assist: "检测到其他参会者提问时自动回答",
  WhatToSay: "以第一人称建议你接下来该说什么",
  Shorten: "将上一条回复浓缩为简短、口语化的版本",
  FollowUp: "建议你可以向其他参会者提出的问题",
  Recap: "总结目前为止的会议要点与行动项",
  AskQuestion: "输入任意问题，AI 根据上下文回答",
};

const TONE_OPTIONS = [
  { label: "专业", value: "Professional" },
  { label: "轻松", value: "Casual" },
  { label: "正式", value: "Formal" },
  { label: "友好", value: "Friendly" },
  { label: "直接", value: "Direct" },
];

const FORMAT_OPTIONS = [
  { label: "要点列表", value: "bullets" },
  { label: "段落", value: "paragraphs" },
  { label: "编号列表", value: "numbered" },
  { label: "一句话", value: "oneliner" },
];

const LENGTH_OPTIONS = [
  { label: "简短", value: "brief" },
  { label: "标准", value: "standard" },
  { label: "详细", value: "detailed" },
];

const OPINION_OPTIONS = [
  { label: "仅陈述事实", value: null },
  { label: "加入我的观点", value: "add" },
];


/** Help content for each setting — shown via HelpButton/HelpPanel toggle */
const HELP: Record<string, { title: string; body: string }> = {
  tone: {
    title: "语气",
    body: "设置 AI 回复的对话语气。\n\n专业 — 面向客户的会议与正式场合\n轻松 — 团队站会与内部同步\n正式 — 董事会汇报与高管简报\n友好 — 1 对 1 与辅导面谈\n直接 — 快速问答与时间紧迫的通话\n\n再次点击已选中的选项即可取消选择。",
  },
  format: {
    title: "格式",
    body: "控制 AI 组织输出的方式。\n\n要点列表 — 适合行动项、会议笔记\n段落 — 最适合叙述性总结与解释\n编号列表 — 适合分步骤流程\n一句话 — 极简、一目了然的建议",
  },
  length: {
    title: "长度",
    body: "调整回复的详细程度。\n\n简短（1-2 句）— 节奏快的通话，悬浮窗更易读\n标准（3-5 句）— 大多数会议的均衡选择\n详细 — 有时间细读时的深入分析",
  },
  opinion: {
    title: "视角",
    body: "控制 AI 是否加入自己的分析。\n\n仅陈述事实 — 回答严格基于转写/记忆上下文，不做解读（默认）\n加入我的观点 — 在事实性回答后附上简短的「## 我的观点」部分，包含 AI 自己的分析、解读或建议",
  },
  instructions: {
    title: "附加指令",
    body: "注入每次 AI 提示词的自由文本。可用于：\n\n• 角色背景（例如“我是产品经理”）\n• 领域术语或缩写\n• 额外的格式或风格规则\n\n会与上方预设选项组合生效。若与预设内容重复，请清空此栏。",
  },
  autoTrigger: {
    title: "自动触发",
    body: "开启后，NexQ 会在会议中监听指向你的提问，并自动生成建议回答。\n\n在做演示或希望完全手动控制时请关闭。你仍可通过悬浮窗按钮手动触发操作。",
  },
  temperature: {
    title: "温度",
    body: "控制 AI 的创造性与随机性。\n\n低（0.0–0.3）— 精确、稳定、客观。最适合技术讨论、数据评审和合规话题。\n中（0.4–0.6）— 准确性与多样性的平衡。\n高（0.7–1.0）— 多样、有创造性。适合头脑风暴和创意讨论。",
  },
  transcriptWindow: {
    title: "转写窗口",
    body: "AI 回复前读取最近多少分钟的对话。\n\n短（1-5 分钟）— 聚焦当前话题，回复更快。适合快速会议。\n长（10-30 分钟）— 为引用早前内容的复杂多话题讨论提供更充分的上下文。",
  },
};

// ─── Helpers ─────────────────────────────────────────────

function secsToMin(secs: number): number {
  return Math.round(secs / 60);
}

function minToSecs(min: number): number {
  return min * 60;
}

function formatWindowDisplay(seconds: number | null): string {
  if (seconds === null) return "默认";
  if (seconds === 0) return "全部";
  return `${secsToMin(seconds)} 分钟`;
}

/** Section header with icon badge */
function SectionHeader({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex items-center gap-2.5 mb-4">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10">
        <Icon className="h-3.5 w-3.5 text-primary" />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-primary/80">{title}</h3>
        <p className="text-meta text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}

/** Toggleable help icon — matches ContextStrategySettings pattern */
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
      onClick={(e) => {
        e.stopPropagation();
        onToggle(isOpen ? null : id);
      }}
      className={`inline-flex items-center justify-center rounded-full border transition-colors ${
        isOpen
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-border/40 text-muted-foreground/60 hover:border-border/60 hover:text-muted-foreground"
      } h-[18px] w-[18px]`}
      title="显示说明"
    >
      {isOpen ? <X className="h-2.5 w-2.5" /> : <HelpCircle className="h-2.5 w-2.5" />}
    </button>
  );
}

/** Expandable help panel — matches ContextStrategySettings pattern */
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

/** Small toggle switch (h-5 w-9) */
function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`relative h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ${
        checked ? "bg-primary" : "bg-muted"
      }`}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
          checked ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
  );
}

// ─── Main Component ──────────────────────────────────────

export function AIActionsSettings() {
  const configs = useAIActionsStore((s) => s.configs);
  const loadConfigs = useAIActionsStore((s) => s.loadConfigs);
  const updateGlobalDefaults = useAIActionsStore((s) => s.updateGlobalDefaults);
  const updateActionConfig = useAIActionsStore((s) => s.updateActionConfig);
  const resetActionPrompt = useAIActionsStore((s) => s.resetActionPrompt);
  const addCustomAction = useAIActionsStore((s) => s.addCustomAction);
  const removeCustomAction = useAIActionsStore((s) => s.removeCustomAction);
  const setInstructionPresets = useAIActionsStore((s) => s.setInstructionPresets);
  const setCustomInstructions = useAIActionsStore((s) => s.setCustomInstructions);

  const [expandedActions, setExpandedActions] = useState<Record<string, boolean>>({});
  const [expandedOverrides, setExpandedOverrides] = useState<Record<string, boolean>>({});
  const [showNewActionForm, setShowNewActionForm] = useState(false);
  const [newActionName, setNewActionName] = useState("");
  const [newActionPrompt, setNewActionPrompt] = useState("");
  const [openHelp, setOpenHelp] = useState<string | null>(null);

  useEffect(() => {
    loadConfigs();
  }, []);

  const toggleExpanded = useCallback((mode: string) => {
    setExpandedActions((prev) => ({ ...prev, [mode]: !prev[mode] }));
  }, []);

  const toggleOverride = useCallback((mode: string) => {
    setExpandedOverrides((prev) => ({ ...prev, [mode]: !prev[mode] }));
  }, []);

  const handlePresetToggle = useCallback(
    (category: keyof InstructionPresets, value: string) => {
      const current = configs.instructionPresets[category];
      const newPresets: InstructionPresets = {
        ...configs.instructionPresets,
        [category]: current === value ? null : value,
      };
      setInstructionPresets(newPresets);
    },
    [configs.instructionPresets, setInstructionPresets]
  );

  const handleOpinionChange = useCallback(
    (value: string | null) => {
      setInstructionPresets({ ...configs.instructionPresets, opinion: value });
    },
    [configs.instructionPresets, setInstructionPresets]
  );

  const handleCustomInstructionsChange = useCallback(
    (text: string) => {
      setCustomInstructions(text);
    },
    [setCustomInstructions]
  );

  const handleGlobalDefaultChange = useCallback(
    (key: string, value: number | boolean) => {
      updateGlobalDefaults({ [key]: value });
    },
    [updateGlobalDefaults]
  );

  const handleActionToggleVisible = useCallback(
    (mode: string, visible: boolean) => {
      updateActionConfig(mode, { visible });
    },
    [updateActionConfig]
  );

  const handleActionPromptChange = useCallback(
    (mode: string, systemPrompt: string) => {
      updateActionConfig(mode, { systemPrompt, isDefaultPrompt: false });
    },
    [updateActionConfig]
  );

  const handleResetPrompt = useCallback(
    (mode: string) => {
      resetActionPrompt(mode);
    },
    [resetActionPrompt]
  );

  const handleContextToggle = useCallback(
    (mode: string, key: string, value: boolean) => {
      updateActionConfig(mode, { [key]: value });
    },
    [updateActionConfig]
  );

  const handleOverrideChange = useCallback(
    (mode: string, key: string, value: number | null) => {
      updateActionConfig(mode, { [key]: value });
    },
    [updateActionConfig]
  );

  const handleAddCustomAction = useCallback(() => {
    if (!newActionName.trim() || !newActionPrompt.trim()) return;
    addCustomAction(newActionName.trim(), newActionPrompt.trim());
    setNewActionName("");
    setNewActionPrompt("");
    setShowNewActionForm(false);
  }, [newActionName, newActionPrompt, addCustomAction]);

  const handleRemoveCustomAction = useCallback(
    (mode: string) => {
      removeCustomAction(mode);
    },
    [removeCustomAction]
  );

  const toggleHelp = useCallback((id: string | null) => {
    setOpenHelp((prev) => (prev === id ? null : id));
  }, []);

  const builtInActions = useMemo(() => {
    return BUILT_IN_MODES.map((mode) => configs.actions[mode]).filter(Boolean);
  }, [configs.actions]);

  const customActions = useMemo(() => {
    return Object.values(configs.actions).filter((a) => !a.isBuiltIn);
  }, [configs.actions]);

  const instructionTokens = useMemo(() => {
    const chars = configs.customInstructions.length;
    return Math.ceil(chars / 4);
  }, [configs.customInstructions]);

  const presetSummary = useMemo(() => {
    const parts: string[] = [];
    const p = configs.instructionPresets;
    if (p.tone) parts.push(`${p.tone} 语气。`);
    if (p.format) {
      const fm: Record<string, string> = {
        bullets: "使用要点列表。", paragraphs: "使用段落。",
        numbered: "使用编号列表。", oneliner: "保持一行。",
      };
      parts.push(fm[p.format] || `使用 ${p.format} 格式。`);
    }
    if (p.length) {
      const lm: Record<string, string> = {
        brief: "简短回复。", standard: "标准长度回复。",
        detailed: "详细回复。",
      };
      parts.push(lm[p.length] || `${p.length} 回复。`);
    }
    if (p.opinion === "add") {
      parts.push("添加「我的观点」部分，附上 AI 自己的分析。");
    }
    return parts.join(" ");
  }, [configs.instructionPresets]);

  const globalWindowMin = secsToMin(configs.globalDefaults.transcriptWindowSeconds);

  return (
    <div className="space-y-5">
      {/* ═══ Two-column grid: Response Style │ Behavior + Context ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* ─── Left Column: Response Style ─── */}
        <div className="rounded-xl border border-border/30 bg-card/50 p-4">
          <SectionHeader
            icon={MessageSquare}
            title="回复风格"
            subtitle="AI 组织和表达答案的方式"
          />

          <div className="space-y-4">
            {/* Tone */}
            <div>
              <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                语气
                <HelpButton id="tone" activeId={openHelp} onToggle={toggleHelp} />
              </label>
              {openHelp === "tone" && <HelpPanel id="tone" />}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {TONE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => handlePresetToggle("tone", opt.value)}
                    className={`rounded-full px-3 py-1 text-xs font-medium cursor-pointer transition-colors duration-150 ${
                      configs.instructionPresets.tone === opt.value
                        ? "bg-primary/20 text-primary ring-1 ring-primary/20"
                        : "text-muted-foreground hover:bg-accent/50"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Format */}
            <div>
              <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                格式
                <HelpButton id="format" activeId={openHelp} onToggle={toggleHelp} />
              </label>
              {openHelp === "format" && <HelpPanel id="format" />}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {FORMAT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => handlePresetToggle("format", opt.value)}
                    className={`rounded-full px-3 py-1 text-xs font-medium cursor-pointer transition-colors duration-150 ${
                      configs.instructionPresets.format === opt.value
                        ? "bg-primary/20 text-primary ring-1 ring-primary/20"
                        : "text-muted-foreground hover:bg-accent/50"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Length */}
            <div>
              <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                长度
                <HelpButton id="length" activeId={openHelp} onToggle={toggleHelp} />
              </label>
              {openHelp === "length" && <HelpPanel id="length" />}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {LENGTH_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => handlePresetToggle("length", opt.value)}
                    className={`rounded-full px-3 py-1 text-xs font-medium cursor-pointer transition-colors duration-150 ${
                      configs.instructionPresets.length === opt.value
                        ? "bg-primary/20 text-primary ring-1 ring-primary/20"
                        : "text-muted-foreground hover:bg-accent/50"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Perspective */}
            <div>
              <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                视角
                <HelpButton id="opinion" activeId={openHelp} onToggle={toggleHelp} />
              </label>
              {openHelp === "opinion" && <HelpPanel id="opinion" />}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {OPINION_OPTIONS.map((opt) => (
                  <button
                    key={opt.label}
                    onClick={() => handleOpinionChange(opt.value)}
                    className={`rounded-full px-3 py-1 text-xs font-medium cursor-pointer transition-colors duration-150 ${
                      (configs.instructionPresets.opinion ?? null) === opt.value
                        ? "bg-primary/20 text-primary ring-1 ring-primary/20"
                        : "text-muted-foreground hover:bg-accent/50"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Active preset summary */}
            {presetSummary && (
              <div className="rounded-lg border border-primary/10 bg-primary/5 px-3 py-2 flex items-center gap-2">
                <span className="text-meta font-semibold text-primary/80 uppercase tracking-wider shrink-0">
                  已启用
                </span>
                <span className="text-xs text-foreground/80">{presetSummary}</span>
              </div>
            )}

            <div className="h-px bg-border/20" />

            {/* Additional Instructions */}
            <div>
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  附加指令
                  <HelpButton id="instructions" activeId={openHelp} onToggle={toggleHelp} />
                </label>
                <div className="flex items-center gap-3 text-meta text-muted-foreground/70">
                  <span>{configs.customInstructions.length} 字符</span>
                  <span>约 {instructionTokens} token</span>
                </div>
              </div>
              {openHelp === "instructions" && <HelpPanel id="instructions" />}
              <textarea
                rows={3}
                value={configs.customInstructions}
                onChange={(e) => handleCustomInstructionsChange(e.target.value)}
                placeholder="添加预设之外的额外指令..."
                className="mt-2 w-full resize-none rounded-lg border border-border/50 bg-secondary/30 px-3 py-2.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20"
              />
            </div>
          </div>
        </div>

        {/* ─── Right Column: Behavior + Context ─── */}
        <div className="space-y-5">
          {/* AI Behavior */}
          <div className="rounded-xl border border-border/30 bg-card/50 p-4">
            <SectionHeader
              icon={Zap}
              title="AI 行为"
              subtitle="控制自动化与回复特性"
            />

            <div className="space-y-4">
              {/* Auto-Trigger */}
              <div>
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    自动触发
                    <HelpButton id="autoTrigger" activeId={openHelp} onToggle={toggleHelp} />
                  </label>
                  <Toggle
                    checked={configs.globalDefaults.autoTrigger}
                    onChange={(v) => handleGlobalDefaultChange("autoTrigger", v)}
                    label="切换自动触发"
                  />
                </div>
                {openHelp === "autoTrigger" && <HelpPanel id="autoTrigger" />}
              </div>

              <div className="h-px bg-border/20" />

              {/* Temperature */}
              <div>
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    温度
                    <HelpButton id="temperature" activeId={openHelp} onToggle={toggleHelp} />
                  </label>
                  <span className="rounded-md bg-secondary/50 px-2 py-0.5 text-xs font-medium tabular-nums text-foreground">
                    {configs.globalDefaults.temperature.toFixed(1)}
                  </span>
                </div>
                {openHelp === "temperature" && <HelpPanel id="temperature" />}
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.1}
                  value={configs.globalDefaults.temperature}
                  onChange={(e) =>
                    handleGlobalDefaultChange("temperature", Number(e.target.value))
                  }
                  className="mt-2 w-full cursor-pointer accent-primary"
                />
                <div className="mt-1 flex justify-between text-meta text-muted-foreground/70">
                  <span>精确 0.0</span>
                  <span>创造性 1.0</span>
                </div>
              </div>
            </div>
          </div>

          {/* Context Window */}
          <div className="rounded-xl border border-border/30 bg-card/50 p-4">
            <SectionHeader
              icon={Layers}
              title="上下文窗口"
              subtitle="AI 回复时参考的数据"
            />

            <div className="space-y-4">
              {/* Transcript Window */}
              <div>
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    转写窗口
                    <HelpButton id="transcriptWindow" activeId={openHelp} onToggle={toggleHelp} />
                  </label>
                  <span className="rounded-md bg-secondary/50 px-2 py-0.5 text-xs font-medium tabular-nums text-foreground">
                    {globalWindowMin} 分钟
                  </span>
                </div>
                {openHelp === "transcriptWindow" && <HelpPanel id="transcriptWindow" />}
                <input
                  type="range"
                  min={1}
                  max={30}
                  step={1}
                  value={globalWindowMin}
                  onChange={(e) =>
                    handleGlobalDefaultChange(
                      "transcriptWindowSeconds",
                      minToSecs(Number(e.target.value))
                    )
                  }
                  className="mt-2 w-full cursor-pointer accent-primary"
                />
                <div className="mt-1 flex justify-between text-meta text-muted-foreground/70">
                  <span>1 分钟</span>
                  <span>30 分钟</span>
                </div>
              </div>

              <div className="h-px bg-border/20" />

              {/* RAG Chunks — reference to Context Strategy */}
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground">
                    RAG 分块
                  </label>
                  <span className="text-xs text-muted-foreground/60">
                    在上下文策略中设置
                  </span>
                </div>
                <p className="mt-1 text-meta text-muted-foreground/50">
                  每次查询检索的文档分块数由「上下文策略」中的「检索结果数（top-K）」控制。可在每个操作的「覆盖默认值」中单独覆盖。
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ Actions (full width) ═══ */}
      <div className="rounded-xl border border-border/30 bg-card/50 p-4">
        <SectionHeader
          icon={Sparkles}
          title="操作"
          subtitle="内置与自定义 AI 操作模式"
        />

        {/* Built-in Actions */}
        <div>
          <h4 className="text-meta font-semibold uppercase tracking-wider text-muted-foreground/70 mb-2">
            内置（{builtInActions.length}）
          </h4>
          <div className="rounded-lg border border-border/20 divide-y divide-border/20 overflow-hidden">
            {builtInActions.map((action) => (
              <ActionCard
                key={action.mode}
                action={action}
                description={ACTION_DESCRIPTIONS[action.mode]}
                isExpanded={!!expandedActions[action.mode]}
                isOverrideExpanded={!!expandedOverrides[action.mode]}
                onToggleExpand={() => toggleExpanded(action.mode)}
                onToggleOverride={() => toggleOverride(action.mode)}
                onToggleVisible={(v) => handleActionToggleVisible(action.mode, v)}
                onPromptChange={(p) => handleActionPromptChange(action.mode, p)}
                onResetPrompt={() => handleResetPrompt(action.mode)}
                onContextToggle={(k, v) => handleContextToggle(action.mode, k, v)}
                onOverrideChange={(k, v) => handleOverrideChange(action.mode, k, v)}
                showReset={true}
              />
            ))}
          </div>
        </div>

        {/* Custom Actions */}
        <div className="mt-5">
          <h4 className="text-meta font-semibold uppercase tracking-wider text-muted-foreground/70 mb-2">
            自定义（{customActions.length}）
          </h4>

          {customActions.length > 0 && (
            <div className="rounded-lg border border-border/20 divide-y divide-border/20 overflow-hidden">
              {customActions.map((action) => (
                <ActionCard
                  key={action.mode}
                  action={action}
                  isExpanded={!!expandedActions[action.mode]}
                  isOverrideExpanded={!!expandedOverrides[action.mode]}
                  onToggleExpand={() => toggleExpanded(action.mode)}
                  onToggleOverride={() => toggleOverride(action.mode)}
                  onToggleVisible={(v) => handleActionToggleVisible(action.mode, v)}
                  onPromptChange={(p) => handleActionPromptChange(action.mode, p)}
                  onResetPrompt={undefined}
                  onContextToggle={(k, v) => handleContextToggle(action.mode, k, v)}
                  onOverrideChange={(k, v) => handleOverrideChange(action.mode, k, v)}
                  showReset={false}
                  onDelete={() => handleRemoveCustomAction(action.mode)}
                />
              ))}
            </div>
          )}

          {customActions.length === 0 && !showNewActionForm && (
            <p className="py-2 text-center text-meta text-muted-foreground/60">
              暂无自定义操作
            </p>
          )}

          {showNewActionForm && (
            <div className="rounded-lg border border-border/40 bg-secondary/20 p-3.5 space-y-2.5">
              <input
                type="text"
                value={newActionName}
                onChange={(e) => setNewActionName(e.target.value)}
                placeholder="操作名称"
                className="w-full rounded-lg border border-border/50 bg-secondary/30 px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20"
              />
              <textarea
                rows={3}
                value={newActionPrompt}
                onChange={(e) => setNewActionPrompt(e.target.value)}
                placeholder="该操作的系统提示词..."
                className="w-full resize-none rounded-lg border border-border/50 bg-secondary/30 px-3 py-2.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleAddCustomAction}
                  disabled={!newActionName.trim() || !newActionPrompt.trim()}
                  className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors duration-150 hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Plus className="h-3 w-3" />
                  添加
                </button>
                <button
                  onClick={() => {
                    setShowNewActionForm(false);
                    setNewActionName("");
                    setNewActionPrompt("");
                  }}
                  className="rounded-lg border border-border/50 bg-secondary/30 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground"
                >
                  取消
                </button>
              </div>
            </div>
          )}

          {!showNewActionForm && (
            <button
              onClick={() => setShowNewActionForm(true)}
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border/50 py-2 text-xs font-medium text-muted-foreground cursor-pointer transition-colors duration-150 hover:border-primary/30 hover:text-primary"
            >
              <Plus className="h-3.5 w-3.5" />
              添加自定义操作
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Action Card ─────────────────────────────────────────

interface ActionCardProps {
  action: ActionConfig;
  description?: string;
  isExpanded: boolean;
  isOverrideExpanded: boolean;
  onToggleExpand: () => void;
  onToggleOverride: () => void;
  onToggleVisible: (visible: boolean) => void;
  onPromptChange: (prompt: string) => void;
  onResetPrompt: (() => void) | undefined;
  onContextToggle: (key: string, value: boolean) => void;
  onOverrideChange: (key: string, value: number | null) => void;
  showReset: boolean;
  onDelete?: () => void;
}

function ActionCard({
  action,
  description,
  isExpanded,
  isOverrideExpanded,
  onToggleExpand,
  onToggleOverride,
  onToggleVisible,
  onPromptChange,
  onResetPrompt,
  onContextToggle,
  onOverrideChange,
  showReset,
  onDelete,
}: ActionCardProps) {
  const handleDeleteClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onDelete?.();
    },
    [onDelete]
  );

  const windowDisplayMin =
    action.transcriptWindowSeconds !== null
      ? action.transcriptWindowSeconds === 0
        ? 0
        : secsToMin(action.transcriptWindowSeconds)
      : null;

  return (
    <div>
      {/* Compact header row */}
      <button
        onClick={onToggleExpand}
        className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors duration-150 hover:bg-secondary/20"
      >
        {isExpanded ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground/70 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground/70 shrink-0" />
        )}
        <span className="text-xs font-medium text-foreground shrink-0">
          {action.name}
        </span>
        <span className="text-meta text-muted-foreground/60 shrink-0">
          {action.mode}
        </span>
        {description && (
          <span className="hidden sm:inline text-meta text-muted-foreground/60 truncate">
            &mdash; {description}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {onDelete && (
            <button
              onClick={handleDeleteClick}
              className="rounded-md p-1 text-muted-foreground/60 transition-colors duration-150 hover:bg-destructive/10 hover:text-destructive"
              aria-label={`删除 ${action.name}`}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
          <Toggle
            checked={action.visible}
            onChange={(v) => onToggleVisible(v)}
            label={`切换「${action.name}」可见性`}
          />
        </div>
      </button>

      {/* Expanded configuration */}
      {isExpanded && (
        <div className="border-t border-border/20 bg-secondary/10 px-3.5 py-3.5 space-y-3.5">
          {/* Purpose */}
          {description && (
            <p className="text-xs text-muted-foreground/80 italic">
              {description}
            </p>
          )}

          {/* System Prompt */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                系统提示词
              </label>
              {showReset && onResetPrompt && (
                <button
                  onClick={onResetPrompt}
                  disabled={action.isDefaultPrompt}
                  className="flex items-center gap-1 text-meta font-medium text-muted-foreground transition-colors duration-150 hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <RotateCcw className="h-3 w-3" />
                  重置
                </button>
              )}
            </div>
            <textarea
              rows={3}
              value={action.systemPrompt}
              onChange={(e) => onPromptChange(e.target.value)}
              className="w-full resize-none rounded-lg border border-border/50 bg-secondary/30 px-3 py-2.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20"
            />
          </div>

          {/* Context Sources — two-column grid */}
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              上下文来源
            </label>
            <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1.5">
              {[
                { key: "includeTranscript", label: "转写文本", checked: action.includeTranscript },
                { key: "includeRagChunks", label: "RAG 分块", checked: action.includeRagChunks },
                { key: "includeCustomInstructions", label: "自定义指令", checked: action.includeCustomInstructions },
                { key: "includeDetectedQuestion", label: "检测到的问题", checked: action.includeDetectedQuestion },
                { key: "webSearch", label: "网络搜索", checked: action.webSearch },
              ].map(({ key, label, checked }) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => onContextToggle(key, e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-border/50 accent-primary"
                  />
                  <span className="text-xs text-foreground">{label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Override Defaults (Collapsible) */}
          <div>
            <button
              onClick={onToggleOverride}
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground"
            >
              {isOverrideExpanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              覆盖默认值
            </button>

            {isOverrideExpanded && (
              <div className="mt-2.5 space-y-3 rounded-lg border border-border/30 bg-secondary/10 p-3">
                {/* Transcript Window Override */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-meta font-medium text-muted-foreground">
                      转写窗口
                    </label>
                    <span className="rounded bg-secondary/50 px-1.5 py-0.5 text-meta font-medium tabular-nums text-foreground">
                      {formatWindowDisplay(action.transcriptWindowSeconds)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={action.transcriptWindowSeconds !== null}
                        onChange={(e) =>
                          onOverrideChange(
                            "transcriptWindowSeconds",
                            e.target.checked ? 120 : null
                          )
                        }
                        className="h-3 w-3 rounded border-border/50 accent-primary"
                      />
                      <span className="text-meta text-muted-foreground">覆盖</span>
                    </label>
                    {action.transcriptWindowSeconds !== null && (
                      <input
                        type="range"
                        min={0}
                        max={30}
                        step={1}
                        value={windowDisplayMin ?? 2}
                        onChange={(e) => {
                          const min = Number(e.target.value);
                          onOverrideChange(
                            "transcriptWindowSeconds",
                            min === 0 ? 0 : minToSecs(min)
                          );
                        }}
                        className="flex-1 cursor-pointer accent-primary"
                      />
                    )}
                  </div>
                  {action.transcriptWindowSeconds !== null && (
                    <div className="mt-1 flex justify-between text-meta text-muted-foreground/60">
                      <span>全部</span>
                      <span>30 分钟</span>
                    </div>
                  )}
                </div>

                {/* RAG Top-K Override */}
                <div className="flex items-center justify-between">
                  <label className="text-meta font-medium text-muted-foreground">
                    RAG Top-K
                  </label>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={action.ragTopK !== null}
                        onChange={(e) =>
                          onOverrideChange("ragTopK", e.target.checked ? 5 : null)
                        }
                        className="h-3 w-3 rounded border-border/50 accent-primary"
                      />
                      <span className="text-meta text-muted-foreground">覆盖</span>
                    </label>
                    {action.ragTopK !== null && (
                      <select
                        value={action.ragTopK}
                        onChange={(e) =>
                          onOverrideChange("ragTopK", Number(e.target.value))
                        }
                        className="rounded border border-border/50 bg-secondary/30 px-2 py-1 text-meta text-foreground focus:border-primary/50 focus:outline-none"
                      >
                        {[3, 5, 7, 10, 15, 20].map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>

                {/* Temperature Override */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-meta font-medium text-muted-foreground">
                      温度
                    </label>
                    <span className="rounded bg-secondary/50 px-1.5 py-0.5 text-meta font-medium tabular-nums text-foreground">
                      {action.temperature === null
                        ? "默认"
                        : action.temperature.toFixed(1)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={action.temperature !== null}
                        onChange={(e) =>
                          onOverrideChange("temperature", e.target.checked ? 0.3 : null)
                        }
                        className="h-3 w-3 rounded border-border/50 accent-primary"
                      />
                      <span className="text-meta text-muted-foreground">覆盖</span>
                    </label>
                    {action.temperature !== null && (
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.1}
                        value={action.temperature}
                        onChange={(e) =>
                          onOverrideChange("temperature", Number(e.target.value))
                        }
                        className="flex-1 cursor-pointer accent-primary"
                      />
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
