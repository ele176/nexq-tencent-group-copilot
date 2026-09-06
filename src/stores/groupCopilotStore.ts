// 群面战术盘 store：接收后端 group_copilot_update 事件，
// 管理建议失效（20 秒自动 / 用户发言立即），并把最终转写段推给后端。

import { create } from "zustand";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

export interface CandidateView {
  speaker: string;
  view: string;
  confidence: number;
}

export interface GroupDecision {
  action: string;
  should_speak: boolean;
  situation: string;
  gap: string;
  suggestion: string;
}

export interface GroupState {
  revision: number;
  transcript_seq: number;
  stage: string;
  situation: string;
  consensus: string[];
  disagreements: string[];
  gaps: string[];
  candidate_views: CandidateView[];
  my_contributions: string[];
  my_role: string;
  decision: GroupDecision;
}

interface GroupCopilotState {
  active: boolean;
  groupState: GroupState | null;
  status: "idle" | "analyzing" | "ok" | "error";
  statusMessage: string;
  /** 当前建议展示起始时间（用于 20s 自动失效） */
  suggestionShownAt: number | null;
  /** 已失效（用户发言后或超时），显示"不要抢话" */
  suggestionExpired: boolean;
  caseQuestion: string;
  durationMinutes: number;

  setActive: (v: boolean) => void;
  setMeta: (caseQuestion: string, durationMinutes: number) => void;
  applyGroupState: (s: GroupState) => void;
  setStatus: (status: GroupCopilotState["status"], message?: string) => void;
  /** 用户麦克风出声说完一段话后调用：立即失效当前建议 */
  expireSuggestion: () => void;
  /** 20 秒定时失效检查 */
  tickExpiry: () => void;

  start: (caseQuestion: string, durationMinutes: number) => Promise<void>;
  stop: () => Promise<void>;
  force: () => Promise<void>;
  pushFinalSegment: (source: string, speaker: string, text: string, ts: number) => Promise<void>;
}

const SUGGESTION_TTL_MS = 20_000;

let listenersStarted = false;
let expiryTimer: ReturnType<typeof setInterval> | null = null;

/** 全局事件监听（幂等；两个 Tauri 窗口各自加载本模块，都会注册）。
 * active 状态以后端为权威：由 group_copilot_status 事件驱动，
 * 避免 launcher/overlay 双窗口 Zustand 状态不同步。 */
export function startGlobalListeners() {
  if (listenersStarted) return;
  listenersStarted = true;

  listen<GroupState>("group_copilot_update", (e) => {
    useGroupCopilotStore.getState().applyGroupState(e.payload);
  }).then((u) => unlisteners.push(u));

  listen<{ status: string; message: string }>("group_copilot_status", (e) => {
    const s = e.payload.status;
    // 后端启停是权威信号：双窗口同步 active
    if (s === "started") {
      useGroupCopilotStore.setState({ active: true, status: "analyzing" });
      return;
    }
    if (s === "stopped") {
      useGroupCopilotStore.setState({ active: false, status: "idle" });
      return;
    }
    useGroupCopilotStore.getState().setStatus(
      s as GroupCopilotState["status"],
      e.payload.message
    );
  }).then((u) => unlisteners.push(u));

  // 20 秒失效定时器
  expiryTimer = setInterval(() => {
    useGroupCopilotStore.getState().tickExpiry();
  }, 1000);
}

let unlisteners: UnlistenFn[] = [];

export const useGroupCopilotStore = create<GroupCopilotState>((set, get) => ({
  active: false,
  groupState: null,
  status: "idle",
  statusMessage: "",
  suggestionShownAt: null,
  suggestionExpired: false,
  caseQuestion: "",
  durationMinutes: 30,

  setActive: (v) => set({ active: v }),
  setMeta: (caseQuestion, durationMinutes) => set({ caseQuestion, durationMinutes }),

  applyGroupState: (s) =>
    set({
      groupState: s,
      status: "ok",
      suggestionShownAt: s.decision.should_speak ? Date.now() : null,
      suggestionExpired: false,
    }),

  setStatus: (status, message = "") => set({ status, statusMessage: message }),

  expireSuggestion: () => {
    const { groupState, suggestionExpired } = get();
    if (groupState?.decision.should_speak && !suggestionExpired) {
      set({ suggestionExpired: true });
    }
  },

  tickExpiry: () => {
    const { groupState, suggestionShownAt, suggestionExpired } = get();
    if (
      groupState?.decision.should_speak &&
      suggestionShownAt !== null &&
      !suggestionExpired &&
      Date.now() - suggestionShownAt > SUGGESTION_TTL_MS
    ) {
      set({ suggestionExpired: true });
    }
  },

  start: async (caseQuestion, durationMinutes) => {
    get().setMeta(caseQuestion, durationMinutes);
    // active 由后端 group_copilot_status(started) 事件置位（双窗口同步）
    set({ groupState: null, status: "analyzing", statusMessage: "", suggestionExpired: false, suggestionShownAt: null });
    await invoke("group_copilot_start", {
      caseQuestion,
      durationMinutes,
    });
  },

  stop: async () => {
    try {
      await invoke("group_copilot_stop");
    } catch {
      /* ignore */
    } finally {
      // 后端 stopped 事件会同步置 active=false；这里兜底（事件丢失时）
      useGroupCopilotStore.setState({ active: false, status: "idle" });
    }
  },

  force: async () => {
    try {
      await invoke("group_copilot_force");
      set({ status: "analyzing" });
    } catch (e) {
      console.warn("[groupCopilot] force failed:", e);
    }
  },

  pushFinalSegment: async (source, speaker, text, ts) => {
    const { active } = get();
    if (!active) return;
    // 用户本人发言 → 旧建议立即失效
    if (source === "you") {
      get().expireSuggestion();
    }
    try {
      await invoke("group_copilot_push_segment", { source, speaker, text, timestampMs: ts });
    } catch {
      /* ignore */
    }
  },
}));

