// 群面战术盘 — 400×250 极简四字段视图
// 【局势】【缺口】【动作】【建议发言】，should_speak=false 或建议失效时显示【不要抢话】

import { useEffect, useState } from "react";
import { useGroupCopilotStore } from "../stores/groupCopilotStore";
import { Zap, PauseCircle, RefreshCw, Loader2 } from "lucide-react";

const ACTION_COLORS: Record<string, string> = {
  推进: "bg-primary/15 text-primary border-primary/30",
  补充: "bg-success/15 text-success border-success/30",
  总结: "bg-info/15 text-info border-info/30",
  反驳: "bg-warning/15 text-warning border-warning/30",
  等待: "bg-muted/40 text-muted-foreground border-border/40",
};

export function GroupCopilotPanel() {
  const groupState = useGroupCopilotStore((s) => s.groupState);
  const status = useGroupCopilotStore((s) => s.status);
  const statusMessage = useGroupCopilotStore((s) => s.statusMessage);
  const suggestionExpired = useGroupCopilotStore((s) => s.suggestionExpired);
  const caseQuestion = useGroupCopilotStore((s) => s.caseQuestion);
  const durationMinutes = useGroupCopilotStore((s) => s.durationMinutes);
  const force = useGroupCopilotStore((s) => s.force);
  const [remaining, setRemaining] = useState(durationMinutes * 60);

  // 剩余时间倒计时
  useEffect(() => {
    const timer = setInterval(() => {
      setRemaining((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const analyzing = status === "analyzing";
  const decision = groupState?.decision;
  const showSuggestion =
    decision?.should_speak && decision.suggestion && !suggestionExpired;

  // 错误信息友好化：把后端原始报错翻译成用户能看懂的提示 + 排查动作
  const friendlyError = (() => {
    if (status !== "error" || !statusMessage) return null;
    const msg = statusMessage;
    if (/LLM router not initialized|No active LLM provider|No active model/i.test(msg)) {
      return { title: "AI 服务商未配置", detail: "请在 设置 → LLM 服务商 选择服务商、填入 API 密钥并选择模型" };
    }
    if (/401|403|AuthError|Authentication|密钥/i.test(msg)) {
      return { title: "API 密钥无效或过期", detail: "请在 设置 → LLM 服务商 重新测试连接" };
    }
    if (/429|rate.?limit/i.test(msg)) {
      return { title: "请求频率超限", detail: "稍等片刻会自动重试；也可按右上角按钮手动分析" };
    }
    if (/群面模式暂不支持该 LLM 服务商/i.test(msg)) {
      return { title: "当前 LLM 服务商不支持群面引擎", detail: "请在设置中切换到 OpenRouter / Groq / OpenAI / 本地模型" };
    }
    if (/timeout|timed? ?out|connection|网络/i.test(msg)) {
      return { title: "网络连接失败", detail: "检查网络后按右上角按钮重试" };
    }
    if (/JSON 解析失败|响应中|缺少/i.test(msg)) {
      return { title: "AI 返回格式异常", detail: "多为模型太弱导致，建议换 Gemini / GPT 系模型；会自动在下一轮重试" };
    }
    return { title: "分析失败", detail: msg.slice(0, 120) };
  })();

  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto px-3 py-2.5 text-foreground">
      {/* 顶栏：阶段 + 剩余时间 + 手动分析 */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
            {groupState?.stage || "监听中"}
          </span>
          {analyzing && (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              分析中…
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] tabular-nums text-muted-foreground">
            剩余 {mm}:{ss}
          </span>
          <button
            onClick={() => force()}
            title="立即分析（全局热键 Ctrl+Shift+G，会议中也能触发）"
            className="rounded-md border border-border/40 p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* 错误横幅：分析失败时醒目展示原因与排查建议 */}
      {friendlyError && (
        <div className="shrink-0 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12px] font-semibold text-destructive">
              {friendlyError.title}
            </p>
            <button
              onClick={() => force()}
              className="shrink-0 rounded-md border border-destructive/30 px-2 py-0.5 text-[10px] font-medium text-destructive transition-colors hover:bg-destructive/20"
            >
              重试
            </button>
          </div>
          <p className="mt-0.5 text-[11px] leading-relaxed break-all text-destructive/80">
            {friendlyError.detail}
          </p>
        </div>
      )}

      {/* 局势 */}
      <Section label="局势">
        {groupState?.situation || `等待讨论开始…${caseQuestion ? `题目：${caseQuestion}` : ""}`}
      </Section>

      {/* 缺口 */}
      <Section label="缺口">
        {groupState?.gaps?.length
          ? groupState.gaps.join("；")
          : "—"}
      </Section>

      {/* 动作 */}
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          动作
        </span>
        {decision ? (
          <span
            className={`rounded-md border px-2 py-0.5 text-[12px] font-semibold ${
              ACTION_COLORS[decision.action] ?? "bg-muted/40 text-foreground border-border/40"
            }`}
          >
            {decision.action}
          </span>
        ) : (
          <span className="text-[12px] text-muted-foreground">—</span>
        )}
        {groupState?.my_role && (
          <span className="ml-auto text-[11px] text-muted-foreground">
            建议角色：{groupState.my_role}
          </span>
        )}
      </div>

      {/* 建议发言 / 不要抢话 */}
      <div className="flex-1 rounded-xl border border-border/40 bg-secondary/30 p-3">
        {showSuggestion ? (
          <p className="text-[13px] leading-relaxed text-foreground">
            {decision!.suggestion}
          </p>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
            <div className="flex items-center gap-1.5 text-[14px] font-semibold text-muted-foreground">
              {decision && !decision.should_speak ? (
                <>
                  <PauseCircle className="h-4 w-4" />
                  不要抢话
                </>
              ) : (
                <>
                  <PauseCircle className="h-4 w-4" />
                  继续听
                </>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground/60">
              {decision && !decision.should_speak
                ? decision.situation || "当前时机不适合发言"
                : "发言结束后自动分析；在会议中按 Ctrl+Shift+G 可随时手动触发"}
            </p>
          </div>
        )}
      </div>

      {/* 底栏 */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground/60">
        <span>
          {groupState
            ? `v${groupState.revision} · 已分析 ${groupState.transcript_seq} 条发言`
            : "等待第一条发言…"}
        </span>
        {showSuggestion && (
          <span className="flex items-center gap-1 text-primary/70">
            <Zap className="h-3 w-3" /> 20 秒后自动失效
          </span>
        )}
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-foreground/90">{children}</p>
    </div>
  );
}
