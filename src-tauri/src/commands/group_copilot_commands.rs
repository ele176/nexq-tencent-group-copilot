// Group Copilot IPC commands.

use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager, State};

use crate::group_copilot::{spawn_scheduler, GroupCopilotEngine, GroupState, GroupStatusPayload};
use crate::state::AppState;

/// 开启群面模式：重置引擎 + 启动调度循环。
#[tauri::command]
pub async fn group_copilot_start(
    case_question: String,
    duration_minutes: u64,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // 个人背景：取 Context 文档全文（简历/JD 等）作为可引用素材
    let personal_context = load_personal_context(&app_handle);

    let engine_arc: Arc<std::sync::Mutex<GroupCopilotEngine>> = state
        .group_copilot
        .clone()
        .ok_or("Group copilot engine not initialized")?;

    {
        let mut engine = engine_arc.lock().map_err(|e| e.to_string())?;
        engine.reset(case_question, duration_minutes.saturating_mul(60), personal_context);
    }

    spawn_scheduler(engine_arc.clone(), app_handle.clone());

    let _ = app_handle.emit_status("analyzing", "群面 Copilot 已启动");
    log::info!("[GroupCopilot] started");
    Ok(())
}

/// 结束群面模式。
#[tauri::command]
pub async fn group_copilot_stop(
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if let Some(engine_arc) = state.group_copilot.as_ref() {
        if let Ok(mut engine) = engine_arc.lock() {
            engine.enabled = false;
            engine.stop_flag.store(true, std::sync::atomic::Ordering::SeqCst);
        }
    }
    let _ = app_handle.emit_status("idle", "群面 Copilot 已停止");
    Ok(())
}

/// 前端推送一条最终转写片段。
#[tauri::command]
pub async fn group_copilot_push_segment(
    source: String,
    speaker: String,
    text: String,
    timestamp_ms: u64,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if let Some(engine_arc) = state.group_copilot.as_ref() {
        if let Ok(mut engine) = engine_arc.lock() {
            if engine.enabled {
                engine.push_segment(source, speaker, text, timestamp_ms);
            }
        }
    }
    Ok(())
}

/// 热键强制分析：绕过最小间隔，仍遵守单并发（排队到当前请求结束后立即执行）。
#[tauri::command]
pub async fn group_copilot_force(
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if let Some(engine_arc) = state.group_copilot.as_ref() {
        let mut engine = engine_arc.lock().map_err(|e| e.to_string())?;
        if !engine.enabled {
            return Err("群面模式未启动".into());
        }
        engine.force_requested = true;
        let _ = app_handle.emit_status("analyzing", "手动触发分析");
    }
    Ok(())
}

/// 用户刚说完一段话 → 旧建议立即失效（前端显示层处理，这里仅透传状态）。
#[tauri::command]
pub async fn group_copilot_get_state(
    state: State<'_, AppState>,
) -> Result<Option<GroupState>, String> {
    if let Some(engine_arc) = state.group_copilot.as_ref() {
        let engine = engine_arc.lock().map_err(|e| e.to_string())?;
        return Ok(engine.state.clone());
    }
    Ok(None)
}

/// 从 Context 资源聚合个人背景文本（限制长度防止 token 爆炸）。
fn load_personal_context(app_handle: &AppHandle) -> String {
    let app_state: tauri::State<AppState> = app_handle.state::<AppState>();
    if let Some(ctx) = app_state.context.as_ref() {
        if let Ok(manager) = ctx.lock() {
            let assembled = manager.get_assembled_context();
            if !assembled.trim().is_empty() {
                return truncate_text(&assembled, 8000);
            }
        }
    }
    String::new()
}

fn truncate_text(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        s.to_string()
    } else {
        s.chars().take(max_chars).collect::<String>() + "\n...(已截断)"
    }
}

/// 小工具：在 commands 里直接发状态事件。
trait EmitStatus {
    fn emit_status(&self, status: &str, message: &str) -> ();
}
impl EmitStatus for AppHandle {
    fn emit_status(&self, status: &str, message: &str) {
        let _ = self.emit(
            "group_copilot_status",
            GroupStatusPayload {
                status: status.to_string(),
                message: message.to_string(),
            },
        );
    }
}
