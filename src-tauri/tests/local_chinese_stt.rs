use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use nexq_lib::audio::{AudioChunk, AudioSource};
use nexq_lib::stt::ort_streaming::OrtStreamingSTT;
use nexq_lib::stt::provider::STTProvider;

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// End-to-end smoke test for the exact offline Chinese model shipped with the
/// dedicated Tencent group-interview build. The WAV is generated locally by
/// Windows' zh-CN voice before this test is run.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn local_chinese_zipformer_transcribes_windows_tts() {
    let _ = env_logger::builder().is_test(true).try_init();

    let model_dir = PathBuf::from(
        std::env::var("NEXQ_CHINESE_MODEL_DIR")
            .expect("NEXQ_CHINESE_MODEL_DIR must point to the extracted Zipformer model"),
    );
    let wav_path = PathBuf::from(
        std::env::var("NEXQ_CHINESE_WAV")
            .expect("NEXQ_CHINESE_WAV must point to a 16 kHz mono PCM WAV"),
    );

    let mut reader = hound::WavReader::open(&wav_path).expect("test WAV must open");
    let spec = reader.spec();
    assert_eq!(spec.sample_rate, 16_000, "test WAV must be 16 kHz");
    assert_eq!(spec.channels, 1, "test WAV must be mono");
    assert_eq!(spec.bits_per_sample, 16, "test WAV must be 16-bit PCM");

    let mut samples: Vec<i16> = reader
        .samples::<i16>()
        .collect::<Result<Vec<_>, _>>()
        .expect("test WAV samples must decode");
    // The provider finalizes after about three seconds of blank frames.
    samples.extend(std::iter::repeat_n(0_i16, 16_000 * 4));

    let (result_tx, mut result_rx) = tokio::sync::mpsc::channel(128);
    let mut provider = OrtStreamingSTT::new(model_dir);
    provider.set_language("zh-CN");
    assert!(provider.test_connection().await.expect("model discovery must run"));
    provider
        .start_stream(result_tx)
        .await
        .expect("streaming provider must start");

    for (index, pcm_data) in samples.chunks(5_120).enumerate() {
        provider
            .feed_audio(AudioChunk {
                pcm_data: pcm_data.to_vec(),
                source: AudioSource::System,
                timestamp_ms: now_ms() + index as u64 * 320,
                is_speech: pcm_data.iter().any(|sample| sample.unsigned_abs() > 200),
            })
            .await
            .expect("audio chunk must be accepted");
        tokio::time::sleep(Duration::from_millis(10)).await;
    }

    let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
    let mut transcript = String::new();
    while tokio::time::Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        let wait_for_result = remaining.min(Duration::from_secs(3));
        match tokio::time::timeout(wait_for_result, result_rx.recv()).await {
            Ok(Some(result)) if !result.text.trim().is_empty() => {
                transcript = result.text;
                if result.is_final {
                    break;
                }
            }
            Ok(Some(_)) => {}
            Ok(None) => break,
            Err(_) if !transcript.is_empty() => break,
            Err(_) => {}
        }
    }

    provider.stop_stream().await.expect("provider must stop cleanly");
    assert!(
        !transcript.trim().is_empty(),
        "Chinese Zipformer produced no transcript for the local zh-CN TTS sample"
    );
    println!("LOCAL_CHINESE_STT_TRANSCRIPT={transcript}");
}
