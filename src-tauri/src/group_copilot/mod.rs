// Group Copilot — 腾讯群面战术引擎
// 群面状态机：维护完整 GroupState，调度 LLM 结构化分析，
// 以事件形式把战术盘数据推送给悬浮窗。
//
// 设计要点（对应方案文档）：
// - 单写入者：所有状态变更只发生在本引擎内
// - 单调 seq：每条最终转写片段递增编号，LLM 只看 last_analyzed_seq 之后的增量
// - revision：每次成功分析递增，防止旧响应覆盖新状态
// - 调度：发言结束后触发；最短 10s 间隔；连续讨论有新内容最长 15s 刷新；
//   热键强制（绕过最小间隔，但仍遵守单请求并发）
// - 失败安全：非法 JSON / 字段缺失 / 超长建议不覆盖现有状态

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

// ── 数据类型 ──────────────────────────────────────────────

/// 一条已确认（is_final）的转写片段。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptItem {
    pub seq: u64,
    /// "you" | "them"
    pub source: String,
    pub speaker: String,
    pub text: String,
    pub timestamp_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CandidateView {
    pub speaker: String,
    pub view: String,
    #[serde(default)]
    pub confidence: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupDecision {
    /// 等待 | 补充 | 总结 | 推进 | 反驳
    pub action: String,
    pub should_speak: bool,
    #[serde(default)]
    pub situation: String,
    #[serde(default)]
    pub gap: String,
    #[serde(default)]
    pub suggestion: String,
}

/// 模型返回的原始结构（revision 由引擎填充，不信任模型）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawGroupState {
    #[serde(default)]
    pub stage: String,
    #[serde(default)]
    pub situation: String,
    #[serde(default)]
    pub consensus: Vec<String>,
    #[serde(default)]
    pub disagreements: Vec<String>,
    #[serde(default)]
    pub gaps: Vec<String>,
    #[serde(default)]
    pub candidate_views: Vec<CandidateView>,
    #[serde(default)]
    pub my_contributions: Vec<String>,
    #[serde(default, rename = "my_role")]
    pub my_role: String,
    pub decision: Option<GroupDecision>,
}

/// 推送给前端的完整状态。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupState {
    pub revision: u64,
    pub transcript_seq: u64,
    pub stage: String,
    pub situation: String,
    pub consensus: Vec<String>,
    pub disagreements: Vec<String>,
    pub gaps: Vec<String>,
    pub candidate_views: Vec<CandidateView>,
    pub my_contributions: Vec<String>,
    pub my_role: String,
    pub decision: GroupDecision,
}

#[derive(Debug, Clone, Serialize)]
pub struct GroupStatusPayload {
    pub status: String, // idle | analyzing | ok | error
    pub message: String,
}

// ── 引擎 ──────────────────────────────────────────────────

pub struct GroupCopilotEngine {
    pub enabled: bool,
    pub stop_flag: Arc<AtomicBool>,
    pub case_question: String,
    pub duration_secs: u64,
    pub started_at: Option<Instant>,
    pub personal_context: String,
    /// 会话开始时的 Unix 毫秒时间戳（用于快照文件命名）。
    pub start_unix_ms: u64,
    /// 快照目录（app_data_dir/group_copilot）；None 则不落盘。
    pub snapshot_dir: Option<std::path::PathBuf>,

    /// 全部已确认片段（完整 transcript，不删减）。
    pub segments: Vec<TranscriptItem>,
    /// 已分析的最后一个 seq。
    pub last_analyzed_seq: u64,
    /// 状态版本号。
    pub revision: u64,
    /// 当前 GroupState 快照。
    pub state: Option<GroupState>,

    pub in_flight: bool,
    pub last_request_at: Option<Instant>,
    /// 热键强制标记（单并发内排队）。
    pub force_requested: bool,
    pub last_suggestion: String,
}

impl GroupCopilotEngine {
    pub fn new() -> Self {
        Self {
            enabled: false,
            stop_flag: Arc::new(AtomicBool::new(false)),
            case_question: String::new(),
            duration_secs: 1800,
            started_at: None,
            personal_context: String::new(),
            start_unix_ms: 0,
            snapshot_dir: None,
            segments: Vec::new(),
            last_analyzed_seq: 0,
            revision: 0,
            state: None,
            in_flight: false,
            last_request_at: None,
            force_requested: false,
            last_suggestion: String::new(),
        }
    }

    pub fn reset(
        &mut self,
        case_question: String,
        duration_secs: u64,
        personal_context: String,
        start_unix_ms: u64,
        snapshot_dir: Option<std::path::PathBuf>,
    ) {
        self.enabled = true;
        self.stop_flag = Arc::new(AtomicBool::new(false));
        self.case_question = case_question;
        self.duration_secs = duration_secs;
        self.started_at = Some(Instant::now());
        self.personal_context = personal_context;
        self.start_unix_ms = start_unix_ms;
        self.snapshot_dir = snapshot_dir;
        self.segments.clear();
        self.last_analyzed_seq = 0;
        self.revision = 0;
        self.state = None;
        self.in_flight = false;
        self.last_request_at = None;
        self.force_requested = false;
        self.last_suggestion = String::new();
    }

    pub fn push_segment(&mut self, source: String, speaker: String, text: String, timestamp_ms: u64) {
        let seq = self.segments.len() as u64 + 1;
        self.segments.push(TranscriptItem {
            seq,
            source,
            speaker,
            text,
            timestamp_ms,
        });
    }

    pub fn remaining_seconds(&self) -> u64 {
        let Some(started) = self.started_at else {
            return self.duration_secs;
        };
        let elapsed = started.elapsed().as_secs();
        self.duration_secs.saturating_sub(elapsed)
    }
}

// ── 调度循环 ──────────────────────────────────────────────

/// 启动调度循环（每秒 tick 一次，直到 stop_flag）。
pub fn spawn_scheduler(state: Arc<Mutex<GroupCopilotEngine>>, app_handle: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_millis(1000));
        loop {
            interval.tick().await;

            // 快照本轮决策参数后立刻释放锁
            let job = {
                let mut engine = match state.lock() {
                    Ok(e) => e,
                    Err(_) => continue,
                };
                if engine.stop_flag.load(Ordering::SeqCst) {
                    break;
                }
                if !engine.enabled || engine.in_flight {
                    continue;
                }
                let dirty = (engine.segments.len() as u64) > engine.last_analyzed_seq;
                if !dirty {
                    continue;
                }

                let since_last = engine
                    .last_request_at
                    .map(|t| t.elapsed())
                    .unwrap_or(Duration::from_secs(u64::MAX));

                let force = engine.force_requested;
                let min_interval_hit = since_last >= Duration::from_secs(10);
                // 连续讨论时有新内容：距上次成功分析超过 15s 且距上次请求超过 3s，提前刷新
                let max_refresh_hit = since_last >= Duration::from_secs(3)
                    && engine
                        .state
                        .as_ref()
                        .map(|_| engine.last_request_at.is_some())
                        .unwrap_or(false)
                    && engine.last_request_at.unwrap().elapsed() < Duration::from_secs(10)
                    && engine
                        .segments
                        .last()
                        .map(|s| s.timestamp_ms)
                        .unwrap_or(0)
                        .saturating_sub(now_ms().saturating_sub(15_000)) > 0;

                if !(force || engine.last_request_at.is_none() || min_interval_hit || max_refresh_hit)
                {
                    continue;
                }

                engine.force_requested = false;
                engine.in_flight = true;
                engine.last_request_at = Some(Instant::now());

                let new_items: Vec<TranscriptItem> = engine
                    .segments
                    .iter()
                    .filter(|s| s.seq > engine.last_analyzed_seq)
                    .cloned()
                    .collect();
                let previous_state = engine.state.clone();
                let case_question = engine.case_question.clone();
                let personal_context = engine.personal_context.clone();
                let remaining = engine.remaining_seconds();
                GroupJob {
                    new_items,
                    previous_state,
                    case_question,
                    personal_context,
                    remaining,
                }
            };

            // 无锁执行网络请求
            let result = run_analysis(&state, &app_handle, job).await;

            if let Ok(mut engine) = state.lock() {
                engine.in_flight = false;
                match result {
                    Ok(mut new_state) => {
                        // 建议去重：与上一条建议高度相似时，视为未推进讨论——
                        // 不覆盖旧建议（避免重复刷屏），也不重置失效计时。
                        let new_suggestion = new_state.decision.suggestion.trim().to_string();
                        let duplicate = !new_suggestion.is_empty()
                            && !engine.last_suggestion.is_empty()
                            && bigram_similarity(&new_suggestion, &engine.last_suggestion) > 0.82;

                        if duplicate {
                            log::info!("[GroupCopilot] suggestion deduplicated (similar to previous)");
                            if let Some(prev) = engine.state.as_ref() {
                                new_state.decision.suggestion = prev.decision.suggestion.clone();
                            }
                        }
                        if !duplicate && !new_suggestion.is_empty() {
                            engine.last_suggestion = new_suggestion;
                        }

                        engine.revision += 1;
                        engine.last_analyzed_seq = new_state.transcript_seq;
                        engine.state = Some(new_state.clone());
                        append_snapshot(&engine, &new_state);
                        let _ = app_handle.emit("group_copilot_update", &new_state);
                        let _ = app_handle.emit(
                            "group_copilot_status",
                            GroupStatusPayload {
                                status: "ok".into(),
                                message: String::new(),
                            },
                        );
                    }
                    Err(e) => {
                        log::warn!("[GroupCopilot] analysis failed: {}", e);
                        let _ = app_handle.emit(
                            "group_copilot_status",
                            GroupStatusPayload {
                                status: "error".into(),
                                message: e,
                            },
                        );
                    }
                }
            }
        }
    });
}

pub struct GroupJob {
    pub new_items: Vec<TranscriptItem>,
    pub previous_state: Option<GroupState>,
    pub case_question: String,
    pub personal_context: String,
    pub remaining: u64,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

// ── LLM 调用与解析 ────────────────────────────────────────

async fn run_analysis(
    state: &Arc<Mutex<GroupCopilotEngine>>,
    app_handle: &tauri::AppHandle,
    job: GroupJob,
) -> Result<GroupState, String> {
    let (provider_type, model) = {
        let app_state = app_handle.state::<crate::state::AppState>();
        let llm = app_state
            .llm
            .as_ref()
            .ok_or("LLM router not initialized")?;
        let router = llm.lock().map_err(|e| e.to_string())?;
        let ptype = router
            .active_provider_type()
            .map(|t| t.as_str().to_string())
            .unwrap_or_default();
        let model = router.active_model().to_string();
        (ptype, model)
    };

    let base_url = match provider_type.as_str() {
        "openrouter" => "https://openrouter.ai/api/v1",
        "groq" => "https://api.groq.com/openai/v1",
        "openai" => "https://api.openai.com/v1",
        "ollama" => "http://localhost:11434/v1",
        "lm_studio" => "http://localhost:1234/v1",
        other => {
            return Err(format!(
                "群面模式暂不支持该 LLM 服务商（{}），请在设置中切换到 OpenRouter / Groq / OpenAI / 本地模型",
                other
            ))
        }
    };

    let api_key = {
        let app_state = app_handle.state::<crate::state::AppState>();
        if let Some(creds) = app_state.credentials.as_ref() {
            let mgr = creds.lock().map_err(|e| e.to_string())?;
            mgr.get_key(&provider_type).unwrap_or(None)
        } else {
            None
        }
    };

    let system_prompt = build_system_prompt(&job.personal_context);
    let user_payload = build_user_payload(&job);

    let body = serde_json::json!({
        "model": model,
        "temperature": 0.1,
        "max_tokens": 900,
        "stream": false,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_payload}
        ]
    });

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|e| e.to_string())?;

    let mut request = client
        .post(format!("{}/chat/completions", base_url))
        .header("Content-Type", "application/json");

    if let Some(key) = &api_key {
        request = request.header("Authorization", format!("Bearer {}", key));
    }
    if provider_type == "openrouter" {
        request = request
            .header("HTTP-Referer", "https://github.com/ele176/nexq-tencent-group-copilot")
            .header("X-Title", "NexQ Tencent Group Copilot");
    }

    let mut response = request.json(&body).send().await.map_err(|e| e.to_string())?;

    // 某些服务商不支持 response_format，降级重试
    if response.status().as_u16() == 400 {
        let mut retry_body = body.clone();
        if let Some(obj) = retry_body.as_object_mut() {
            obj.remove("response_format");
        }
        let mut retry = client
            .post(format!("{}/chat/completions", base_url))
            .header("Content-Type", "application/json");
        if let Some(key) = &api_key {
            retry = retry.header("Authorization", format!("Bearer {}", key));
        }
        if provider_type == "openrouter" {
            retry = retry
                .header("HTTP-Referer", "https://github.com/ele176/nexq-tencent-group-copilot")
                .header("X-Title", "NexQ Tencent Group Copilot");
        }
        response = retry.json(&retry_body).send().await.map_err(|e| e.to_string())?;
    }

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("LLM 请求失败 ({}): {}", status, truncate(&text, 300)));
    }

    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    let content = json["choices"][0]["message"]["content"]
        .as_str()
        .ok_or("LLM 响应缺少 content")?;

    let raw = parse_state_json(content)?;
    build_final_state(state, raw, &job)
}

fn truncate(s: &str, n: usize) -> String {
    if s.len() <= n {
        s.to_string()
    } else {
        format!("{}...", &s[..n])
    }
}

/// 宽容解析：剥掉代码围栏、截取最外层花括号。
fn parse_state_json(content: &str) -> Result<RawGroupState, String> {
    let mut text = content.trim().to_string();
    if text.starts_with("```") {
        text = text
            .trim_start_matches("```json")
            .trim_start_matches("```")
            .trim_end_matches("```")
            .trim()
            .to_string();
    }
    let start = text.find('{').ok_or("响应中没有 JSON 对象")?;
    let end = text.rfind('}').ok_or("响应中 JSON 不完整")?;
    if end <= start {
        return Err("响应中 JSON 不完整".into());
    }
    serde_json::from_str::<RawGroupState>(&text[start..=end])
        .map_err(|e| format!("JSON 解析失败: {}", e))
}

fn build_final_state(
    state: &Arc<Mutex<GroupCopilotEngine>>,
    raw: RawGroupState,
    _job: &GroupJob,
) -> Result<GroupState, String> {
    let decision = raw.decision.ok_or("缺少 decision 字段")?;

    // 建议长度硬校验（150 字上限，超长截断）
    let mut suggestion = decision.suggestion.trim().to_string();
    if suggestion.chars().count() > 160 {
        suggestion = suggestion.chars().take(160).collect();
    }

    let engine = state.lock().map_err(|e| e.to_string())?;
    Ok(GroupState {
        revision: engine.revision + 1,
        transcript_seq: engine.segments.len() as u64,
        stage: raw.stage,
        situation: raw.situation,
        consensus: raw.consensus,
        disagreements: raw.disagreements,
        gaps: raw.gaps,
        candidate_views: raw.candidate_views,
        my_contributions: raw.my_contributions,
        my_role: raw.my_role,
        decision: GroupDecision {
            action: decision.action,
            should_speak: decision.should_speak,
            situation: decision.situation,
            gap: decision.gap,
            suggestion,
        },
    })
}

// ── 提示词 ────────────────────────────────────────────────

fn build_system_prompt(personal_context: &str) -> String {
    let mut p = String::from(
        r#"你是腾讯智慧行业直客销售岗位无领导小组讨论的实时战术助手。你将收到：上一版讨论状态 JSON、新增的转写片段、群面题目和剩余时间。

你的任务是一次性完成：
1. 更新当前讨论阶段（如：审题/框架搭建/方案比较/达成共识/总结汇报）
2. 更新局势（一句话概括正在发生什么）
3. 更新已达成的共识（保留未被推翻的旧共识，只追加/删除有依据的条目）
4. 更新分歧点（同上）
5. 更新尚未讨论到的关键维度（缺口），ToB 销售分析框架包括：客户需求、决策链、预算与采购、技术交付、ROI 与长期价值、风险
6. 更新各候选人的核心观点
7. 判断用户此刻的最佳动作：等待 | 补充 | 总结 | 推进 | 反驳
8. 生成一条建议发言

规则：
- 建议发言必须是第一人称、自然口语化的简体中文，可直接说出口
- 建议发言目标 80~120 字，绝不超过 150 字
- 不得编造用户的个人经历或腾讯内部信息
- 若新增内容没有值得补充的观点，should_speak 设为 false（不要为了刷存在感而强行发言）
- 只输出一个 JSON 对象，不要输出任何其他文字

JSON 格式：
{"stage":"...","situation":"...","consensus":["..."],"disagreements":["..."],"gaps":["..."],"candidate_views":[{"speaker":"...","view":"...","confidence":0.8}],"my_contributions":["..."],"my_role":"结构推进者/总结者/时间管理者/跟随者","decision":{"action":"等待|补充|总结|推进|反驳","should_speak":true,"situation":"...","gap":"...","suggestion":"..."}}"#,
    );
    if !personal_context.trim().is_empty() {
        p.push_str("\n\n[用户个人背景（建议可引用其中的真实经历）]\n");
        p.push_str(personal_context);
    }
    p
}

fn build_user_payload(job: &GroupJob) -> String {
    let previous = match &job.previous_state {
        Some(s) => serde_json::to_string(s).unwrap_or_else(|_| "null".into()),
        None => "null".into(),
    };
    let new_transcript: Vec<serde_json::Value> = job
        .new_items
        .iter()
        .map(|item| {
            serde_json::json!({
                "speaker": if item.source == "you" { "你" } else { &item.speaker },
                "text": item.text,
            })
        })
        .collect();
    serde_json::json!({
        "previous_group_state": previous,
        "new_transcript": new_transcript,
        "case_question": job.case_question,
        "remaining_seconds": job.remaining,
    })
    .to_string()
}

// ── 建议相似度（bigram Dice 系数）────────────────────────

fn bigram_set(s: &str) -> std::collections::HashSet<Vec<char>> {
    let chars: Vec<char> = s.chars().filter(|c| !c.is_whitespace()).collect();
    if chars.len() < 2 {
        let mut set = std::collections::HashSet::new();
        if !chars.is_empty() {
            set.insert(chars.clone());
        }
        return set;
    }
    chars.windows(2).map(|w| w.to_vec()).collect()
}

pub fn bigram_similarity(a: &str, b: &str) -> f64 {
    let set_a = bigram_set(a);
    let set_b = bigram_set(b);
    if set_a.is_empty() || set_b.is_empty() {
        return 0.0;
    }
    let inter = set_a.intersection(&set_b).count();
    (2.0 * inter as f64) / ((set_a.len() + set_b.len()) as f64)
}

// ── 会话快照（JSONL 追加写，用于会后复盘）────────────────
// 每次成功分析追加一行：{"saved_at_ms":..., "revision":..., "state":{...}}
// 文件：app_data_dir/group_copilot/group_copilot_<会话开始毫秒>.jsonl

fn append_snapshot(engine: &GroupCopilotEngine, state: &GroupState) {
    let Some(dir) = engine.snapshot_dir.as_ref() else {
        return;
    };
    if let Err(e) = std::fs::create_dir_all(dir) {
        log::warn!("[GroupCopilot] snapshot dir create failed: {}", e);
        return;
    }
    let path = dir.join(format!("group_copilot_{}.jsonl", engine.start_unix_ms));
    let entry = serde_json::json!({
        "saved_at_ms": now_ms(),
        "revision": state.revision,
        "transcript_seq": state.transcript_seq,
        "state": state,
    });
    use std::io::Write;
    match std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        Ok(mut f) => {
            if let Err(e) = writeln!(f, "{}", entry) {
                log::warn!("[GroupCopilot] snapshot write failed: {}", e);
            }
        }
        Err(e) => log::warn!("[GroupCopilot] snapshot open failed: {}", e),
    }
}
