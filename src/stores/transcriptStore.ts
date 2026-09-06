import { create } from "zustand";
import type { TranscriptSegment } from "../lib/types";

interface TranscriptState {
  segments: TranscriptSegment[];
  searchQuery: string;
  autoScroll: boolean;
  /** 已推送给群面引擎的 final 段 id（防重复推送，内部使用） */
  _groupPushedIds: Set<string>;

  // Actions
  appendSegment: (segment: TranscriptSegment) => void;
  updateInterimSegment: (segment: TranscriptSegment) => void;
  finalizeAllInterim: () => void;
  clearSegments: () => void;
  setSearchQuery: (query: string) => void;
  setAutoScroll: (auto: boolean) => void;
  reassignSpeaker: (fromId: string, toId: string) => void;
}

export const useTranscriptStore = create<TranscriptState>((set) => ({
  segments: [],
  searchQuery: "",
  autoScroll: true,

  // 已推送给群面引擎的 final 段 id（web_speech 路径同一段会本地更新+事件自环各处理一次，需去重）
  _groupPushedIds: new Set<string>() as Set<string>,

  appendSegment: (segment) => {
    set((state) => ({
      segments: [...state.segments, segment],
    }));
  },

  updateInterimSegment: (segment) => {
    // 群面 Copilot：最终段推送（按 id 去重，fire-and-forget）
    if (segment.is_final) {
      const state = useTranscriptStore.getState();
      if (!state._groupPushedIds.has(segment.id)) {
        state._groupPushedIds.add(segment.id);
        // 集合防膨胀：最多记录 500 条
        if (state._groupPushedIds.size > 500) {
          const it = state._groupPushedIds.values().next();
          if (!it.done) state._groupPushedIds.delete(it.value);
        }
        import("./groupCopilotStore")
          .then(({ useGroupCopilotStore }) => {
            const source = segment.speaker === "User" ? "you" : "them";
            useGroupCopilotStore
              .getState()
              .pushFinalSegment(source, segment.speaker, segment.text, segment.timestamp_ms);
          })
          .catch(() => {});
      }
    }
    set((state) => {
      const existing = state.segments.findIndex(
        (s) => s.id === segment.id
      );
      if (existing >= 0) {
        const updated = [...state.segments];
        updated[existing] = segment;
        return { segments: updated };
      }
      return { segments: [...state.segments, segment] };
    });
  },

  finalizeAllInterim: () =>
    set((state) => ({
      segments: state.segments.map((s) =>
        s.is_final ? s : { ...s, is_final: true }
      ),
    })),

  clearSegments: () => set({ segments: [] }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setAutoScroll: (auto) => set({ autoScroll: auto }),
  reassignSpeaker: (fromId, toId) =>
    set((state) => ({
      segments: state.segments.map((s) =>
        s.speaker_id === fromId ? { ...s, speaker_id: toId } : s
      ),
    })),
}));
