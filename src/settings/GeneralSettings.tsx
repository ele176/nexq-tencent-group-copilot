import { useCallback } from "react";
import { useConfigStore } from "../stores/configStore";
import { FolderOpen, Sun, Moon, Monitor } from "lucide-react";
import type { ThemeMode } from "../lib/types";
import { Eye } from "lucide-react";

export function GeneralSettings() {
  const theme = useConfigStore((s) => s.theme);
  const setTheme = useConfigStore((s) => s.setTheme);
  const autoSummary = useConfigStore((s) => s.autoSummary);
  const setAutoSummary = useConfigStore((s) => s.setAutoSummary);
  const startOnLogin = useConfigStore((s) => s.startOnLogin);
  const setStartOnLogin = useConfigStore((s) => s.setStartOnLogin);
  const dataDirectory = useConfigStore((s) => s.dataDirectory);
  const overlayOpacity = useConfigStore((s) => s.overlayOpacity);
  const setOverlayOpacity = useConfigStore((s) => s.setOverlayOpacity);

  const handleChangeDataDir = useCallback(async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, title: "选择数据目录" });
      if (selected && typeof selected === "string") {
        useConfigStore.getState().setDataDirectory(selected);
      }
    } catch (err) {
      console.error("Failed to open directory picker:", err);
    }
  }, []);

  const themeOptions: { value: ThemeMode; label: string; icon: React.ReactNode }[] = [
    { value: "dark", label: "深色", icon: <Moon className="h-3.5 w-3.5" /> },
    { value: "light", label: "浅色", icon: <Sun className="h-3.5 w-3.5" /> },
    {
      value: "system",
      label: "跟随系统",
      icon: <Monitor className="h-3.5 w-3.5" />,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Theme Toggle */}
      <div className="rounded-xl border border-border/30 bg-card/50 p-5">
        <div className="flex items-center justify-between">
          <div>
            <label className="text-sm font-medium text-foreground">主题</label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              选择你偏好的外观
            </p>
          </div>
          <div className="flex rounded-lg border border-border/50 bg-secondary/30 p-0.5">
            {themeOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setTheme(opt.value)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-150 cursor-pointer ${
                  theme === opt.value
                    ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/50 active:scale-95"
                }`}
              >
                {opt.icon}
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Toggle Options */}
      <div className="rounded-xl border border-border/30 bg-card/50 p-5 space-y-5">
        <h3 className="text-sm font-semibold text-primary/80">行为</h3>

        {/* Auto-Summary Toggle */}
        <div className="flex items-center justify-between">
          <div>
            <label className="text-sm font-medium text-foreground">
              自动总结
            </label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              会议结束时自动生成会议纪要
            </p>
          </div>
          <button
            onClick={() => setAutoSummary(!autoSummary)}
            role="switch"
            aria-checked={autoSummary}
            aria-label="切换自动总结"
            className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-all duration-200 ${
              autoSummary ? "bg-primary shadow-[0_0_0_3px_hsl(var(--primary)/0.12)]" : "bg-muted"
            }`}
          >
            <span
              className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all duration-200 ${
                autoSummary ? "translate-x-5 scale-[1.05]" : "translate-x-0"
              }`}
            />
          </button>
        </div>

        <div className="h-px bg-border/20" />

        {/* Start on Login Toggle */}
        <div className="flex items-center justify-between">
          <div>
            <label className="text-sm font-medium text-foreground">
              登录时启动
            </label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              登录系统时自动启动 NexQ
            </p>
          </div>
          <button
            onClick={() => setStartOnLogin(!startOnLogin)}
            role="switch"
            aria-checked={startOnLogin}
            aria-label="切换登录时启动"
            className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-all duration-200 ${
              startOnLogin ? "bg-primary shadow-[0_0_0_3px_hsl(var(--primary)/0.12)]" : "bg-muted"
            }`}
          >
            <span
              className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all duration-200 ${
                startOnLogin ? "translate-x-5 scale-[1.05]" : "translate-x-0"
              }`}
            />
          </button>
        </div>
      </div>

      {/* Moved notice */}
      <div className="rounded-xl border border-info/20 bg-info/5 px-5 py-3">
        <p className="text-xs text-info/80">
          上下文窗口、自动触发和 AI 指令已移至 <strong className="text-info">AI 操作</strong> 标签页。
        </p>
      </div>

      {/* Overlay Opacity */}
      <div className="rounded-xl border border-border/30 bg-card/50 p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Eye className="h-3.5 w-3.5 text-muted-foreground" />
            <div>
              <label className="text-sm font-medium text-foreground">悬浮窗透明度</label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                控制悬浮窗背景的透明程度
              </p>
            </div>
          </div>
          <span className="text-xs font-mono text-muted-foreground w-10 text-right">
            {Math.round(overlayOpacity * 100)}%
          </span>
        </div>
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.01}
          value={overlayOpacity}
          onChange={(e) => setOverlayOpacity(parseFloat(e.target.value))}
          className="w-full h-1.5 rounded-full appearance-none bg-secondary cursor-pointer accent-primary"
        />
        <div className="flex justify-between mt-1">
          <span className="text-[10px] text-muted-foreground/50">透明</span>
          <span className="text-[10px] text-muted-foreground/50">不透明</span>
        </div>
      </div>

      {/* Data Directory */}
      <div className="rounded-xl border border-border/30 bg-card/50 p-5">
        <div className="mb-3">
          <label className="text-sm font-medium text-foreground">
            数据目录
          </label>
          <p className="mt-0.5 text-xs text-muted-foreground">
            会议数据和录音的存储位置
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 rounded-lg border border-border/50 bg-secondary/30 px-3.5 py-2.5">
            <p className="truncate text-xs text-muted-foreground">
              {dataDirectory || "默认应用数据目录"}
            </p>
          </div>
          <button
            onClick={handleChangeDataDir}
            className="flex items-center gap-1.5 rounded-lg border border-border/50 bg-secondary/30 px-3.5 py-2.5 text-xs font-medium text-muted-foreground transition-all duration-150 hover:bg-secondary hover:text-foreground hover:-translate-y-px active:translate-y-px active:scale-[0.97] cursor-pointer"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            更改
          </button>
        </div>
      </div>
    </div>
  );
}
