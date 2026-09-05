import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Speaker, IntelligenceMode } from "./types";

// shadcn/ui utility
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Strip <think>...</think> blocks from LLM output.
 * Handles both complete blocks and unclosed tags (mid-stream).
 */
export function stripThinkTags(text: string): string {
  let result = text.replace(/<think>[\s\S]*?<\/think>\s*/g, "");
  const openIdx = result.indexOf("<think>");
  if (openIdx !== -1) {
    result = result.substring(0, openIdx);
  }
  return result.trimStart();
}

// Format milliseconds to MM:SS
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

// Format milliseconds to HH:MM:SS for long meetings
export function formatDurationLong(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return formatDuration(ms);
}

// Format timestamp for transcript display
export function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

// Format ISO date string to relative time
export function formatRelativeTime(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "刚刚";
  if (diffMins < 60) return `${diffMins} 分钟前`;
  if (diffHours < 24) return `${diffHours} 小时前`;
  if (diffDays < 7) return `${diffDays} 天前`;
  return date.toLocaleDateString();
}

// Get speaker display color class
export function getSpeakerColor(speaker: Speaker): string {
  switch (speaker) {
    case "User":
      return "text-speaker-user";
    case "Interviewer":
    case "Them":
      return "text-speaker-interviewer";
    default:
      return "text-muted-foreground";
  }
}

// Get speaker label
export function getSpeakerLabel(speaker: Speaker): string {
  switch (speaker) {
    case "User":
      return "你";
    case "Interviewer":
      return "面试官";
    case "Them":
      return "对方";
    default:
      return speaker || "未知";
  }
}

// Get intelligence mode label
export function getModeLabel(mode: IntelligenceMode): string {
  switch (mode) {
    case "Assist":
      return "AI 助手";
    case "WhatToSay":
      return "我该说什么";
    case "Shorten":
      return "缩短总结";
    case "FollowUp":
      return "追问建议";
    case "Recap":
      return "讨论回顾";
    case "AskQuestion":
      return "自由提问";
    case "MeetingSummary":
      return "会议摘要";
    case "ActionItemsExtraction":
      return "行动项";
    case "BookmarkSuggestions":
      return "书签推荐";
  }
}

// Get mode keyboard shortcut
export function getModeShortcut(mode: IntelligenceMode): string {
  switch (mode) {
    case "Assist":
      return "Space";
    case "WhatToSay":
      return "Ctrl+1";
    case "Shorten":
      return "Ctrl+2";
    case "FollowUp":
      return "Ctrl+3";
    case "Recap":
      return "Ctrl+4";
    case "AskQuestion":
      return "Ctrl+5";
    case "MeetingSummary":
      return "";
    case "ActionItemsExtraction":
      return "";
    case "BookmarkSuggestions":
      return "";
  }
}

// Format file size
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Group meetings by date category
export function getDateGroup(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffDays = Math.floor(
    (now.getTime() - date.getTime()) / 86400000
  );

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return "This Week";
  return "Earlier";
}
