// Meeting Audio Presets — one-click configuration profiles.

import type {
  AudioDevice,
  MeetingAudioConfig,
  STTProviderType,
} from "../lib/types";

export interface MeetingPreset {
  name: string;
  description: string;
  badge?: string;
  you: { hint: DeviceHint; stt: STTProviderType; model?: string };
  them: { hint: DeviceHint; stt: STTProviderType; model?: string };
  requiresKey?: string;
  requiresDownload?: string;
  windowsOnly?: boolean;
}

/** Hints for resolving device IDs at apply time. */
export type DeviceHint =
  | "default_mic"    // Default input device
  | "default_output" // Default output device
  | "mic_2";         // Second mic (for in-person with two mics)

export const BUILT_IN_PRESETS: MeetingPreset[] = [
  {
    name: "腾讯群面 · 本地中文",
    description: "双路 Sherpa-ONNX 中文流式转写 — 全程离线、无需 STT API Key",
    badge: "Default",
    you: {
      hint: "default_mic",
      stt: "sherpa_onnx",
      model: "streaming-zipformer-multi",
    },
    them: {
      hint: "default_output",
      stt: "sherpa_onnx",
      model: "streaming-zipformer-multi",
    },
    requiresDownload: "sherpa_onnx",
    windowsOnly: true,
  },
  {
    name: "零配置",
    description: "Web Speech + Windows 内置识别 — 打开即用",
    you: { hint: "default_mic", stt: "web_speech" },
    them: { hint: "default_output", stt: "windows_native" },
  },
  {
    name: "最佳质量",
    description: "Deepgram 云端 — 速度最快、识别最准",
    badge: "Recommended",
    you: { hint: "default_mic", stt: "web_speech" },
    them: { hint: "default_output", stt: "deepgram" },
    requiresKey: "deepgram",
  },
  {
    name: "完全离线",
    description: "Sherpa-ONNX — 无需联网",
    badge: "Free",
    you: { hint: "default_mic", stt: "sherpa_onnx" },
    them: { hint: "default_output", stt: "sherpa_onnx" },
    requiresDownload: "sherpa_onnx",
  },
  {
    name: "全云端",
    description: "双方均使用 Deepgram",
    you: { hint: "default_mic", stt: "deepgram" },
    them: { hint: "default_output", stt: "deepgram" },
    requiresKey: "deepgram",
  },
  {
    name: "仅本地（Whisper）",
    description: "双方均使用 Whisper.cpp — 离线、免费",
    you: { hint: "default_mic", stt: "whisper_cpp" },
    them: { hint: "default_output", stt: "whisper_cpp" },
    requiresDownload: "whisper_cpp",
  },
  {
    name: "线下会议",
    description: "双方均用麦克风输入 — Web Speech + Whisper.cpp",
    you: { hint: "default_mic", stt: "web_speech" },
    them: { hint: "mic_2", stt: "whisper_cpp" },
    requiresDownload: "whisper_cpp",
  },
];

/** Resolve a device hint to an actual device ID. */
function resolveHint(hint: DeviceHint, devices: AudioDevice[]): { device_id: string; is_input: boolean } {
  switch (hint) {
    case "default_mic": {
      const mic = devices.find((d) => d.is_input && d.is_default)
        ?? devices.find((d) => d.is_input);
      return { device_id: mic?.id ?? "default", is_input: true };
    }
    case "default_output": {
      const out = devices.find((d) => !d.is_input && d.is_default)
        ?? devices.find((d) => !d.is_input);
      return { device_id: out?.id ?? "default", is_input: false };
    }
    case "mic_2": {
      // Second microphone — skip the default
      const mics = devices.filter((d) => d.is_input);
      const second = mics.find((d) => !d.is_default) ?? mics[0];
      return { device_id: second?.id ?? "default", is_input: true };
    }
  }
}

/** Apply a preset using the current list of audio devices. */
export function applyPreset(
  preset: MeetingPreset,
  devices: AudioDevice[]
): MeetingAudioConfig {
  const youDevice = resolveHint(preset.you.hint, devices);
  const themDevice = resolveHint(preset.them.hint, devices);

  return {
    you: {
      role: "You",
      device_id: youDevice.device_id,
      is_input_device: youDevice.is_input,
      stt_provider: preset.you.stt,
      local_model_id: preset.you.model,
    },
    them: {
      role: "Them",
      device_id: themDevice.device_id,
      is_input_device: themDevice.is_input,
      stt_provider: preset.them.stt,
      local_model_id: preset.them.model,
    },
    recording_enabled: false,
    preset_name: preset.name,
  };
}
