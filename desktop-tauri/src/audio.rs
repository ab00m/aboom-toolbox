use std::{
    ffi::OsString,
    fs::{self, File, OpenOptions},
    io::{self, Read},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::atomic::{AtomicU64, Ordering},
};

pub const MAX_FILES: usize = 120;

#[derive(Clone, Debug)]
pub struct Job {
    pub input: PathBuf,
    pub output: PathBuf,
}

pub fn plan(path: &Path) -> Result<Job, String> {
    if !path.is_absolute() {
        return Err("请选择本地 WAV 文件。".into());
    }
    if !path
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("wav"))
    {
        return Err("首版只支持 WAV 文件，不导入文件夹。".into());
    }
    let metadata = fs::symlink_metadata(path).map_err(|e| format!("无法读取文件：{e}"))?;
    if !metadata.is_file() {
        return Err("只处理普通文件，不跟随符号链接。".into());
    }
    // Keep the selected path for display and for choosing the sibling output.
    Ok(Job {
        input: path.to_path_buf(),
        output: path.with_extension("ogg"),
    })
}

// symlink_metadata also detects dangling symlinks; never follow or replace them.
pub fn output_exists(path: &Path) -> io::Result<bool> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e),
    }
}

pub fn ffmpeg_program() -> Result<OsString, String> {
    match std::env::var_os("ABOOM_FFMPEG") {
        Some(p) if !p.is_empty() => {
            if !Path::new(&p).is_absolute() || !Path::new(&p).is_file() {
                return Err("ABOOM_FFMPEG 应指向 FFmpeg 可执行文件的绝对路径。".into());
            }
            Ok(p)
        }
        _ => Ok(OsString::from("ffmpeg")),
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum Outcome {
    Done,
    Exists,
}

struct StagedFile(PathBuf);
impl Drop for StagedFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}
static STAGE_ID: AtomicU64 = AtomicU64::new(0);

fn staging(output: &Path) -> io::Result<(StagedFile, File)> {
    let dir = output.parent().ok_or(io::ErrorKind::InvalidInput)?;
    for _ in 0..128 {
        let id = STAGE_ID.fetch_add(1, Ordering::Relaxed);
        let path = dir.join(format!(".aboom-{}-{id}.ogg.part", std::process::id()));
        match OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(file) => return Ok((StagedFile(path), file)),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    }
    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "temporary output collision",
    ))
}

pub fn convert(job: &Job, program: &std::ffi::OsStr) -> Result<Outcome, String> {
    let checked = plan(&job.input)?;
    let input = fs::canonicalize(&checked.input).map_err(|e| format!("无法打开 WAV：{e}"))?;
    let output = &checked.output;
    if output_exists(output).map_err(|e| format!("无法检查输出：{e}"))? {
        return Ok(Outcome::Exists);
    }
    let (stage, file) = staging(output).map_err(|e| format!("无法在源目录新建临时文件：{e}"))?;
    let mut command = Command::new(program);
    // Pass arguments directly, not through a shell; force WAV input and local protocols.
    command
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-protocol_whitelist",
            "file,pipe",
            "-f",
            "wav",
            "-i",
        ])
        .arg(&input)
        .args([
            "-map",
            "0:a:0",
            "-c:a",
            "libvorbis",
            "-q:a",
            "5",
            "-f",
            "ogg",
            "pipe:1",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::from(file))
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let result = command.output().map_err(|e| {
        if e.kind() == io::ErrorKind::NotFound {
            "找不到 FFmpeg。请安装后加入 PATH，或设置 ABOOM_FFMPEG，再重开应用。".into()
        } else {
            format!("无法启动 FFmpeg：{e}")
        }
    })?;
    if !result.status.success() {
        let stderr = String::from_utf8_lossy(&result.stderr);
        let detail: String = stderr.trim().chars().take(500).collect();
        return Err(format!("FFmpeg 转换失败：{detail}"));
    }
    let mut magic = [0; 4];
    File::open(&stage.0)
        .and_then(|mut f| f.read_exact(&mut magic))
        .map_err(|e| format!("无法验证转换输出：{e}"))?;
    if &magic != b"OggS" {
        return Err("FFmpeg 未生成有效的 OGG 文件头。".into());
    }
    match fs::hard_link(&stage.0, output) {
        Ok(()) => Ok(Outcome::Done),
        Err(e) if e.kind() == io::ErrorKind::AlreadyExists => Ok(Outcome::Exists),
        Err(_) => {
            // FAT/exFAT and network shares may not support hard links. Exclusive creation
            // still refuses to overwrite an output created after the preview.
            let mut from = File::open(&stage.0).map_err(|e| format!("无法读取转换结果：{e}"))?;
            let mut dest = match OpenOptions::new().write(true).create_new(true).open(output) {
                Ok(f) => f,
                Err(e) if e.kind() == io::ErrorKind::AlreadyExists => return Ok(Outcome::Exists),
                Err(e) => return Err(format!("无法创建输出：{e}")),
            };
            if let Err(e) = io::copy(&mut from, &mut dest).and_then(|_| dest.sync_all()) {
                return Err(format!("无法完整保存输出，请检查可能存在的不完整文件：{e}"));
            }
            Ok(Outcome::Done)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let id = STAGE_ID.fetch_add(1, Ordering::Relaxed);
            let root =
                std::env::temp_dir().join(format!("aboom-audio-test-{}-{id}", std::process::id()));
            fs::create_dir(&root).unwrap();
            Self(root)
        }
        fn wav(&self) -> PathBuf {
            let file = self.0.join("测试 音频.WAV");
            let mut bytes = b"RIFF".to_vec();
            let data_len = 1600u32;
            bytes.extend((36 + data_len).to_le_bytes());
            bytes.extend(b"WAVEfmt ");
            bytes.extend(16u32.to_le_bytes());
            bytes.extend(1u16.to_le_bytes());
            bytes.extend(1u16.to_le_bytes());
            bytes.extend(8000u32.to_le_bytes());
            bytes.extend(16000u32.to_le_bytes());
            bytes.extend(2u16.to_le_bytes());
            bytes.extend(16u16.to_le_bytes());
            bytes.extend(b"data");
            bytes.extend(data_len.to_le_bytes());
            bytes.resize(bytes.len() + data_len as usize, 0);
            fs::write(&file, bytes).unwrap();
            file
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn preview_is_read_only_and_keeps_sibling_path() {
        let dir = Fixture::new();
        let wav = dir.wav();
        let job = plan(&wav).unwrap();
        assert_eq!(job.output, dir.0.join("测试 音频.ogg"));
        assert!(!output_exists(&job.output).unwrap());
        assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 1);
        assert!(plan(Path::new("relative.wav")).is_err());
        assert!(plan(&dir.0.join("other.mp3")).is_err());
    }

    #[test]
    fn existing_output_is_never_overwritten() {
        let dir = Fixture::new();
        let job = plan(&dir.wav()).unwrap();
        fs::write(&job.output, b"keep existing").unwrap();
        assert_eq!(
            convert(&job, std::ffi::OsStr::new("not-called")).unwrap(),
            Outcome::Exists
        );
        assert_eq!(fs::read(&job.output).unwrap(), b"keep existing");
    }

    #[cfg(unix)]
    #[test]
    fn dangling_symlink_is_not_a_free_output_path() {
        let dir = Fixture::new();
        let job = plan(&dir.wav()).unwrap();
        let missing = dir.0.join("missing");
        std::os::unix::fs::symlink(&missing, &job.output).unwrap();
        assert_eq!(
            convert(&job, std::ffi::OsStr::new("not-called")).unwrap(),
            Outcome::Exists
        );
        assert!(!missing.exists());
    }

    #[test]
    fn launch_failure_leaves_no_temporary_file() {
        let dir = Fixture::new();
        let job = plan(&dir.wav()).unwrap();
        assert!(convert(&job, dir.0.join("missing-ffmpeg").as_os_str()).is_err());
        assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 1);
    }

    #[test]
    #[ignore = "requires FFmpeg with libvorbis; run explicitly"]
    fn real_ffmpeg_creates_ogg_and_preserves_wav() {
        let dir = Fixture::new();
        let job = plan(&dir.wav()).unwrap();
        let original = fs::read(&job.input).unwrap();
        assert_eq!(
            convert(&job, &ffmpeg_program().unwrap()).unwrap(),
            Outcome::Done
        );
        assert!(fs::read(&job.output).unwrap().starts_with(b"OggS"));
        assert_eq!(fs::read(&job.input).unwrap(), original);
        assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 2);
        assert_eq!(
            convert(&job, &ffmpeg_program().unwrap()).unwrap(),
            Outcome::Exists
        );
    }
}
