//! 运行时包 / 浏览器包的下载、校验与解压。
//!
//! 下载源默认是 GitHub Releases（过渡用，M5 换成国内 OSS），可以用环境变量
//! `ZMDZ_DIST_BASE` 覆盖为另一个 URL 或本机目录（开发时指向 build/runtime）。

use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use anyhow::{anyhow, bail, Context, Result};
use futures_util::StreamExt;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tokio::io::AsyncWriteExt;

use crate::paths::PLATFORM;

const DEFAULT_DIST_BASE: &str =
    "https://github.com/sugeflow/zimeidazi/releases/download/runtime-r1";

#[derive(Debug, Deserialize)]
pub struct Manifest {
    pub files: ManifestFiles,
}

#[derive(Debug, Deserialize)]
pub struct ManifestFiles {
    pub runtime: FileEntry,
    pub browsers: FileEntry,
}

#[derive(Debug, Deserialize, Clone)]
pub struct FileEntry {
    pub file: String,
    pub size: u64,
    pub sha256: String,
}

/// 进度回调：(已完成, 总量)
pub type Progress<'a> = &'a (dyn Fn(u64, u64) + Send + Sync);

enum Source {
    Http(String),
    Dir(PathBuf),
}

fn source() -> Source {
    let base = std::env::var("ZMDZ_DIST_BASE").unwrap_or_else(|_| DEFAULT_DIST_BASE.into());
    if base.starts_with("http://") || base.starts_with("https://") {
        Source::Http(base.trim_end_matches('/').to_string())
    } else {
        Source::Dir(PathBuf::from(base.trim_start_matches("file://")))
    }
}

fn client() -> Result<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .user_agent(concat!("zimeidazi/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(20))
        .read_timeout(Duration::from_secs(60))
        .build()?)
}

pub async fn fetch_manifest() -> Result<Manifest> {
    let name = format!("manifest-{PLATFORM}.json");
    let bytes = match source() {
        Source::Http(base) => client()?
            .get(format!("{base}/{name}"))
            .send()
            .await?
            .error_for_status()?
            .bytes()
            .await?
            .to_vec(),
        Source::Dir(dir) => tokio::fs::read(dir.join(&name)).await?,
    };
    serde_json::from_slice(&bytes).context("运行时清单格式不对")
}

/// 下载到 `dir`，支持断点续传；校验 sha256 后返回文件路径。已下载且校验通过的直接复用。
pub async fn download(entry: &FileEntry, dir: &Path, progress: Progress<'_>) -> Result<PathBuf> {
    tokio::fs::create_dir_all(dir).await?;
    let dest = dir.join(&entry.file);
    if dest.exists() {
        if sha256_file(&dest)? == entry.sha256 {
            return Ok(dest);
        }
        tokio::fs::remove_file(&dest).await?;
    }

    match source() {
        Source::Dir(src) => {
            tokio::fs::copy(src.join(&entry.file), &dest).await?;
            progress(entry.size, entry.size);
        }
        Source::Http(base) => {
            let part = dest.with_extension("part");
            let mut last_err = None;
            for attempt in 0..5 {
                if attempt > 0 {
                    tokio::time::sleep(Duration::from_secs(2 * attempt)).await;
                }
                match download_http(&format!("{base}/{}", entry.file), &part, entry.size, progress).await {
                    Ok(()) => {
                        last_err = None;
                        break;
                    }
                    Err(e) => last_err = Some(e),
                }
            }
            if let Some(e) = last_err {
                return Err(e.context("下载失败，请检查网络后重试"));
            }
            tokio::fs::rename(&part, &dest).await?;
        }
    }

    let actual = sha256_file(&dest)?;
    if actual != entry.sha256 {
        let _ = tokio::fs::remove_file(&dest).await;
        bail!("文件校验失败（{}），请重试", entry.file);
    }
    Ok(dest)
}

async fn download_http(url: &str, part: &Path, total: u64, progress: Progress<'_>) -> Result<()> {
    let have = tokio::fs::metadata(part).await.map(|m| m.len()).unwrap_or(0);
    let mut req = client()?.get(url);
    if have > 0 && have < total {
        req = req.header(reqwest::header::RANGE, format!("bytes={have}-"));
    }
    let resp = req.send().await?.error_for_status()?;
    let resumed = resp.status() == reqwest::StatusCode::PARTIAL_CONTENT;
    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .append(resumed)
        .write(true)
        .truncate(!resumed)
        .open(part)
        .await?;
    let mut done = if resumed { have } else { 0 };
    let mut stream = resp.bytes_stream();
    let mut last = Instant::now();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        file.write_all(&chunk).await?;
        done += chunk.len() as u64;
        if last.elapsed() > Duration::from_millis(250) {
            progress(done, total);
            last = Instant::now();
        }
    }
    file.flush().await?;
    progress(done, total);
    if done != total {
        return Err(anyhow!("下载不完整：{done}/{total}"));
    }
    Ok(())
}

pub fn sha256_file(path: &Path) -> Result<String> {
    let mut f = std::fs::File::open(path)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(h.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// 把 tar.zst 解压并原子替换 `target`。压缩包顶层目录名为 `top`。
pub fn extract_replace(archive: &Path, top: &str, target: &Path, progress: Progress<'_>) -> Result<()> {
    let parent = target.parent().context("目标目录无效")?;
    let staging = parent.join(format!(".staging-{top}"));
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir_all(&staging)?;

    let total = std::fs::metadata(archive)?.len();
    let reader = CountingReader { inner: std::fs::File::open(archive)?, read: 0, total, last: Instant::now(), progress };
    let decoder = zstd::stream::read::Decoder::new(reader)?;
    let mut tar = tar::Archive::new(decoder);
    tar.set_preserve_permissions(true);
    tar.set_overwrite(true);
    tar.unpack(&staging).with_context(|| format!("解压 {} 失败", archive.display()))?;
    progress(total, total);

    let extracted = staging.join(top);
    if !extracted.is_dir() {
        bail!("压缩包里缺少 {top}/ 目录");
    }
    let old = parent.join(format!(".old-{top}"));
    let _ = std::fs::remove_dir_all(&old);
    if target.exists() {
        std::fs::rename(target, &old).context("旧版本正在被占用，请关闭其他自媒搭子窗口后重试")?;
    }
    std::fs::rename(&extracted, target)?;
    let _ = std::fs::remove_dir_all(&staging);
    let _ = std::fs::remove_dir_all(&old);
    Ok(())
}

struct CountingReader<'a, R> {
    inner: R,
    read: u64,
    total: u64,
    last: Instant,
    progress: Progress<'a>,
}

impl<R: Read> Read for CountingReader<'_, R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let n = self.inner.read(buf)?;
        self.read += n as u64;
        if self.last.elapsed() > Duration::from_millis(250) {
            (self.progress)(self.read, self.total);
            self.last = Instant::now();
        }
        Ok(n)
    }
}
