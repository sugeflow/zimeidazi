//! 用户数据目录布局和 state.json。
//!
//! Windows: %LOCALAPPDATA%\ZimeiDazi\
//! macOS:   ~/Library/Application Support/ZimeiDazi/

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

pub const PLATFORM: &str = if cfg!(windows) { "win-x64" } else { "mac-arm64" };

#[derive(Clone, Debug)]
pub struct Paths {
    pub root: PathBuf,
    /// Easel 项目根目录（代码 + profiles/outputs/.env）
    pub app: PathBuf,
    pub runtime: PathBuf,
    pub browsers: PathBuf,
    pub downloads: PathBuf,
    pub logs: PathBuf,
    /// 子进程使用的独立主目录：OpenClaw 配置（.openclaw-easel）、平台登录状态
    /// （.easel-browser-profiles）都落在这里，不与用户自己装的 Easel 互相影响
    pub home: PathBuf,
    state_file: PathBuf,
}

impl Paths {
    /// 默认在系统的用户数据目录下；`ZMDZ_DATA_DIR` 可以覆盖（自检、测试用）
    pub fn new() -> Result<Self> {
        if let Some(dir) = std::env::var_os("ZMDZ_DATA_DIR") {
            return Ok(Self::at(PathBuf::from(dir)));
        }
        let base = dirs::data_local_dir().context("找不到用户数据目录")?;
        Ok(Self::at(base.join("ZimeiDazi")))
    }

    pub fn at(root: PathBuf) -> Self {
        Self {
            app: root.join("app"),
            runtime: root.join("runtime"),
            browsers: root.join("browsers"),
            downloads: root.join("downloads"),
            logs: root.join("logs"),
            home: root.join("home"),
            state_file: root.join("state.json"),
            root,
        }
    }

    pub fn python(&self) -> PathBuf {
        if cfg!(windows) {
            self.runtime.join("python").join("python.exe")
        } else {
            self.runtime.join("python").join("bin").join("python3")
        }
    }

    pub fn node(&self) -> PathBuf {
        if cfg!(windows) {
            self.runtime.join("node").join("node.exe")
        } else {
            self.runtime.join("node").join("bin").join("node")
        }
    }

    pub fn openclaw(&self) -> PathBuf {
        let base = if cfg!(windows) {
            self.runtime.join("node")
        } else {
            self.runtime.join("node").join("lib")
        };
        base.join("node_modules").join("openclaw").join("openclaw.mjs")
    }

    /// 子进程 PATH 前面要加的目录
    pub fn bin_dirs(&self) -> Vec<PathBuf> {
        let rt = &self.runtime;
        if cfg!(windows) {
            vec![rt.join("node"), rt.join("python"), rt.join("python").join("Scripts"), rt.join("bin")]
        } else {
            vec![rt.join("node").join("bin"), rt.join("python").join("bin"), rt.join("bin")]
        }
    }

    pub fn load_state(&self) -> State {
        std::fs::read(&self.state_file)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default()
    }

    pub fn save_state(&self, s: &State) -> Result<()> {
        std::fs::create_dir_all(&self.root)?;
        let tmp = self.state_file.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(s)?)?;
        std::fs::rename(&tmp, &self.state_file)?;
        Ok(())
    }
}

/// 已完成的准备步骤。每一项记录"装的是哪一份"，对不上就重做。
#[derive(Default, Debug, Serialize, Deserialize)]
pub struct State {
    /// 运行时包的 sha256
    pub runtime: Option<String>,
    /// 浏览器包的 sha256
    pub browsers: Option<String>,
    /// 已同步的应用代码版本："<壳版本>+<上游 commit>"
    pub app_synced: Option<String>,
    /// 最近一次 OpenClaw 配置对应的指纹（代码版本 + 运行时 + .env 内容）
    pub configured: Option<String>,
    /// 上次启动的服务进程号，异常退出后下次启动时清理
    #[serde(default)]
    pub pids: Vec<u32>,
}

/// 目标文件存在且内容相同就不用再复制（升级时大部分文件没变）
fn same_content(a: &Path, b: &Path) -> bool {
    match (std::fs::metadata(a), std::fs::metadata(b)) {
        (Ok(ma), Ok(mb)) if ma.len() == mb.len() => std::fs::read(a).ok() == std::fs::read(b).ok(),
        _ => false,
    }
}

/// 递归复制目录，跳过 `skip` 里的相对路径（只在目标已存在时跳过）；内容相同的文件不重复复制。
/// 返回实际复制的文件数。
pub fn copy_tree(src: &Path, dst: &Path, skip: &[&str]) -> Result<u64> {
    fn walk(src: &Path, dst: &Path, rel: &Path, skip: &[&str], n: &mut u64) -> Result<()> {
        std::fs::create_dir_all(dst.join(rel))?;
        for entry in std::fs::read_dir(src.join(rel))? {
            let entry = entry?;
            let r = rel.join(entry.file_name());
            let target = dst.join(&r);
            let rs = r.to_string_lossy().replace('\\', "/");
            if skip.contains(&rs.as_str()) && target.exists() {
                continue;
            }
            if entry.file_type()?.is_dir() {
                walk(src, dst, &r, skip, n)?;
            } else if !same_content(&entry.path(), &target) {
                std::fs::copy(entry.path(), &target)
                    .with_context(|| format!("复制 {} 失败", r.display()))?;
                *n += 1;
            }
        }
        Ok(())
    }
    let mut n = 0;
    walk(src, dst, Path::new(""), skip, &mut n)?;
    Ok(n)
}
