#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio;

use audio::{Job, Outcome, MAX_FILES};
use serde::Serialize;
use std::{path::PathBuf, sync::Mutex};
use tauri::{AppHandle, DragDropEvent, Emitter, Manager, WindowEvent};
use tauri_plugin_dialog::DialogExt;

const MAIN: &str = "main";
const BUSY: &str = "正在转换，请等当前批次结束。";

#[derive(Default)]
struct Queue {
    jobs: Vec<Job>,
    busy: bool,
}
type State = Mutex<Queue>;

#[derive(Clone, Serialize)]
struct Row {
    input: String,
    output: String,
    status: String,
    message: String,
}

#[derive(Clone, Serialize)]
struct QueueView {
    files: Vec<String>,
    message: String,
}

fn display(path: &std::path::Path) -> String {
    path.to_string_lossy().into_owned()
}

fn lock(app: &AppHandle) -> Result<tauri::State<'_, State>, String> {
    app.try_state::<State>()
        .ok_or_else(|| "无法读取任务队列。".into())
}

fn add_paths(app: &AppHandle, paths: Vec<PathBuf>) -> Result<QueueView, String> {
    let state = lock(app)?;
    let mut queue = state.lock().map_err(|_| "任务队列暂不可用。")?;
    if queue.busy {
        return Err(BUSY.into());
    }
    let mut accepted = 0;
    let mut skipped = 0;
    for path in paths {
        if queue.jobs.len() < MAX_FILES && !queue.jobs.iter().any(|job| job.input == path) {
            if let Ok(job) = audio::plan(&path) {
                queue.jobs.push(job);
                accepted += 1;
                continue;
            }
        }
        skipped += 1;
    }
    Ok(view(&queue, format!(
        "已添加 {accepted} 个；跳过 {skipped} 个（非 WAV、重复、不可读取或超过 {MAX_FILES} 个上限）。"
    )))
}

fn view(queue: &Queue, message: String) -> QueueView {
    QueueView {
        files: queue.jobs.iter().map(|job| display(&job.input)).collect(),
        message,
    }
}

fn row(job: &Job, status: &str, message: String) -> Row {
    Row {
        input: display(&job.input),
        output: display(&job.output),
        status: status.into(),
        message,
    }
}

#[tauri::command]
async fn choose_wav(app: AppHandle) -> Result<QueueView, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let files = app
            .dialog()
            .file()
            .add_filter("WAV", &["wav"])
            .blocking_pick_files()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|p| p.into_path().ok())
            .collect();
        add_paths(&app, files)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn clear_queue(app: AppHandle) -> Result<QueueView, String> {
    let state = lock(&app)?;
    let mut queue = state.lock().map_err(|_| "任务队列暂不可用。")?;
    if queue.busy {
        return Err(BUSY.into());
    }
    queue.jobs.clear();
    Ok(view(&queue, "已清空队列。".into()))
}

#[tauri::command]
async fn preview(app: AppHandle) -> Result<Vec<Row>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = lock(&app)?;
        let jobs = {
            let queue = state.lock().map_err(|_| "任务队列暂不可用。")?;
            if queue.busy {
                return Err(BUSY.into());
            }
            queue.jobs.clone()
        };
        Ok(jobs
            .iter()
            .map(|job| match audio::plan(&job.input) {
                Err(e) => row(job, "error", e),
                Ok(_) => match audio::output_exists(&job.output) {
                    Ok(true) => row(job, "skipped", "已有同名输出，将跳过。".into()),
                    Ok(false) => row(job, "ready", "Vorbis · 质量 5 · 原目录另存".into()),
                    Err(e) => row(job, "error", format!("无法检查输出：{e}")),
                },
            })
            .collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Clone, Serialize)]
struct Progress {
    completed: usize,
    total: usize,
    result: Row,
}

struct RunGuard(AppHandle);
impl Drop for RunGuard {
    fn drop(&mut self) {
        if let Ok(state) = lock(&self.0) {
            if let Ok(mut queue) = state.lock() {
                queue.busy = false;
            }
        }
    }
}

#[tauri::command]
async fn convert_audio(app: AppHandle) -> Result<Vec<Row>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let program = audio::ffmpeg_program()?;
        let state = lock(&app)?;
        let jobs = {
            let mut queue = state.lock().map_err(|_| "任务队列暂不可用。")?;
            if queue.busy {
                return Err(BUSY.into());
            }
            if queue.jobs.is_empty() {
                return Err("请先添加 WAV 文件。".into());
            }
            queue.busy = true;
            queue.jobs.clone()
        };
        let _run = RunGuard(app.clone());
        let total = jobs.len();
        Ok(jobs
            .iter()
            .enumerate()
            .map(|(i, job)| {
                let result = match audio::convert(job, &program) {
                    Ok(Outcome::Done) => row(job, "done", "已完成，原文件未修改。".into()),
                    Ok(Outcome::Exists) => row(job, "skipped", "输出已存在，未覆盖。".into()),
                    Err(e) => row(job, "error", e),
                };
                let _ = app.emit_to(
                    MAIN,
                    "audio-progress",
                    Progress {
                        completed: i + 1,
                        total,
                        result: result.clone(),
                    },
                );
                result
            })
            .collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(State::default())
        .invoke_handler(tauri::generate_handler![
            choose_wav,
            clear_queue,
            preview,
            convert_audio
        ])
        .on_window_event(|window, event| {
            if window.label() != MAIN {
                return;
            }
            if let WindowEvent::DragDrop(event) = event {
                match event {
                    DragDropEvent::Enter { .. } | DragDropEvent::Over { .. } => {
                        let _ = window.emit_to(MAIN, "audio-hover", true);
                    }
                    DragDropEvent::Leave => {
                        let _ = window.emit_to(MAIN, "audio-hover", false);
                    }
                    DragDropEvent::Drop { paths, .. } => {
                        let _ = window.emit_to(MAIN, "audio-hover", false);
                        match add_paths(window.app_handle(), paths.clone()) {
                            Ok(queue) => {
                                let _ = window.emit_to(MAIN, "audio-queue", queue);
                            }
                            Err(error) => {
                                let _ = window.emit_to(MAIN, "audio-error", error);
                            }
                        }
                    }
                    _ => {}
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("启动 Aboom Toolbox 失败");
}
