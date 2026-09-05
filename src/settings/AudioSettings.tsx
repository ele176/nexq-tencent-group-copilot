// Sub-PRD 3: Audio device selection, level meters

import { useEffect, useState } from "react";
import { useConfigStore } from "../stores/configStore";
import { useAudioLevel } from "../hooks/useAudioLevel";
import {
  listAudioDevices,
  startAudioTest,
  stopAudioTest,
} from "../lib/ipc";
import { showToast } from "../stores/toastStore";
import type { AudioDeviceList } from "../lib/types";

export function AudioSettings() {
  const {
    micDeviceId,
    systemDeviceId,
    setMicDeviceId,
    setSystemDeviceId,
  } = useConfigStore();

  const { micLevel, systemLevel, micPeak, systemPeak } = useAudioLevel();

  const [devices, setDevices] = useState<AudioDeviceList>({
    inputs: [],
    outputs: [],
  });
  const [loadingDevices, setLoadingDevices] = useState(true);
  const [testingDevice, setTestingDevice] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    deviceId: string;
    success: boolean;
  } | null>(null);

  // Load devices on mount
  useEffect(() => {
    loadDevices();
  }, []);

  async function loadDevices() {
    setLoadingDevices(true);
    try {
      const deviceList = await listAudioDevices();
      setDevices(deviceList);

      // Auto-select default devices if none selected
      if (!micDeviceId) {
        const defaultInput = deviceList.inputs.find((d) => d.is_default);
        if (defaultInput) {
          setMicDeviceId(defaultInput.id);
        }
      }
      if (!systemDeviceId) {
        const defaultOutput = deviceList.outputs.find((d) => d.is_default);
        if (defaultOutput) {
          setSystemDeviceId(defaultOutput.id);
        }
      }
    } catch (err) {
      console.error("Failed to load audio devices:", err);
      showToast("无法检测音频设备——请检查设备连接", "error");
    } finally {
      setLoadingDevices(false);
    }
  }

  async function handleTestDevice(deviceId: string, isInput: boolean) {
    setTestingDevice(deviceId);
    setTestResult(null);
    try {
      // Start real audio capture test — this emits audio_level events
      await startAudioTest(deviceId, isInput);

      // Let it capture for 3 seconds so the user sees the level meter
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Stop test and get whether audio was detected
      const detected = await stopAudioTest();
      setTestResult({ deviceId, success: detected });
    } catch (err) {
      console.error("Audio test failed:", err);
      setTestResult({ deviceId, success: false });
    } finally {
      setTestingDevice(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Microphone Device */}
      <div className="space-y-2">
        <label className="text-sm font-medium">麦克风</label>
        <div className="flex gap-2">
          <select
            value={micDeviceId || ""}
            onChange={(e) => setMicDeviceId(e.target.value || null)}
            disabled={loadingDevices}
            aria-label="麦克风设备"
            className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="">
              {loadingDevices ? "正在检测麦克风..." : "选择麦克风"}
            </option>
            {devices.inputs.map((device) => (
              <option key={device.id} value={device.id}>
                {device.name}
                {device.is_default ? "（默认）" : ""}
              </option>
            ))}
          </select>
          <button
            onClick={() => micDeviceId && handleTestDevice(micDeviceId, true)}
            disabled={!micDeviceId || testingDevice !== null}
            aria-label="测试麦克风"
            className="rounded-md border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
          >
            {testingDevice === micDeviceId ? "测试中..." : "测试"}
          </button>
        </div>

        {/* Mic Level Meter */}
        <AudioLevelMeter
          level={micLevel}
          peak={micPeak}
          label="麦克风"
        />

        {testingDevice === micDeviceId && (
          <p className="text-xs text-info">
            请对着麦克风说话...
          </p>
        )}
        {testResult && testResult.deviceId === micDeviceId && !testingDevice && (
          <p
            className={`text-xs ${testResult.success ? "text-success" : "text-warning"}`}
          >
            {testResult.success
              ? "检测到音频——设备工作正常"
              : "未检测到音频——请大声说话或检查麦克风"}
          </p>
        )}
      </div>

      {/* System Audio Device */}
      <div className="space-y-2">
        <label className="text-sm font-medium">系统声音（输出）</label>
        <div className="flex gap-2">
          <select
            value={systemDeviceId || ""}
            onChange={(e) => setSystemDeviceId(e.target.value || null)}
            disabled={loadingDevices}
            aria-label="系统声音设备"
            className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="">
              {loadingDevices ? "正在检测输出设备..." : "选择输出设备"}
            </option>
            {devices.outputs.map((device) => (
              <option key={device.id} value={device.id}>
                {device.name}
                {device.is_default ? "（默认）" : ""}
              </option>
            ))}
          </select>
          <button
            onClick={() =>
              systemDeviceId && handleTestDevice(systemDeviceId, false)
            }
            disabled={!systemDeviceId || testingDevice !== null}
            aria-label="测试系统声音"
            className="rounded-md border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
          >
            {testingDevice === systemDeviceId ? "测试中..." : "测试"}
          </button>
        </div>

        {/* System Level Meter */}
        <AudioLevelMeter
          level={systemLevel}
          peak={systemPeak}
          label="系统"
        />

        {testingDevice === systemDeviceId && (
          <p className="text-xs text-info">
            请在电脑上播放一些音频...
          </p>
        )}
        {testResult && testResult.deviceId === systemDeviceId && !testingDevice && (
          <p
            className={`text-xs ${testResult.success ? "text-success" : "text-warning"}`}
          >
            {testResult.success
              ? "检测到音频——设备工作正常"
              : "未检测到音频——请尝试用扬声器播放内容"}
          </p>
        )}
      </div>

      {/* Refresh Devices */}
      <button
        onClick={loadDevices}
        disabled={loadingDevices}
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        {loadingDevices ? "刷新中..." : "刷新设备"}
      </button>
    </div>
  );
}

/**
 * Horizontal audio level meter with green/yellow/red zones.
 */
function AudioLevelMeter({
  level,
  peak,
  label,
}: {
  level: number;
  peak: number;
  label: string;
}) {
  const clampedLevel = Math.min(Math.max(level, 0), 1);
  const clampedPeak = Math.min(Math.max(peak, 0), 1);

  return (
    <div
      className="flex items-center gap-2"
      role="meter"
      aria-label={`${label}音量水平`}
      aria-valuenow={Math.round(clampedLevel * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span className="w-12 text-xs text-muted-foreground">{label}</span>
      <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-muted/20">
        {/* Gradient level bar — color follows position (green → yellow → red) */}
        <div
          className="absolute inset-y-0 left-0 rounded-full audio-level-gradient audio-bar-spring"
          style={{ width: `${clampedLevel * 100}%` }}
        />
        {/* Peak indicator */}
        {clampedPeak > 0.01 && (
          <div
            className="absolute inset-y-0 w-[2px] rounded-full bg-foreground/40 transition-all duration-150"
            style={{ left: `${clampedPeak * 100}%` }}
          />
        )}
      </div>
      <span className="w-8 text-right text-xs tabular-nums text-muted-foreground">
        {Math.round(clampedLevel * 100)}
      </span>
    </div>
  );
}
