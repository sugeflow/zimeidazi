//! 首次准备 / 升级后准备：运行时 → 浏览器 → 应用代码 → Agent 配置。
//! 每一步完成后写入 state.json，中途失败或关掉，下次从没完成的那一步继续。

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use anyhow::{bail, Context, Result};
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::dist;
use crate::paths::{copy_tree, Paths};
use crate::services;

#[derive(Clone, Serialize)]
pub struct Progress {
    /// 步骤编号：runtime / browsers / app / configure / start
    pub step: &'static str,
    pub label: String,
    /// 0–100；None 表示不确定进度
    pub percent: Option<f64>,
    pub detail: String,
}

pub type Emit<'a> = &'a (dyn Fn(Progress) + Send + Sync);

/// 首次创建 .env 时写入的内容；之后不会被安装包覆盖
const ENV_TEMPLATE: &str = "\
# 自媒搭子配置（由软件自动维护，请勿手动修改）
# 模型由激活后自动写入；开发测试时可以手动填写下面三项
DAZI_LLM_BASE_URL=
DAZI_LLM_API_KEY=
DAZI_LLM_MODEL=
";

pub async fn prepare(paths: &Paths, resources: &Path, emit: Emit<'_>) -> Result<()> {
    let mut state = paths.load_state();
    std::fs::create_dir_all(&paths.root)?;

    // 1. 运行时包、浏览器包
    let needs_runtime = state.runtime.is_none() || !paths.python().exists() || !paths.openclaw().exists();
    let needs_browsers = state.browsers.is_none() || !paths.browsers.exists();
    let manifest = if needs_runtime || needs_browsers {
        emit(Progress { step: "runtime", label: "检查创作环境".into(), percent: None, detail: String::new() });
        Some(dist::fetch_manifest().await.context("获取运行时清单失败，请检查网络")?)
    } else {
        None
    };
    if let Some(m) = &manifest {
        if state.runtime.as_deref() != Some(&m.files.runtime.sha256) || needs_runtime {
            install_pack(paths, &m.files.runtime, "runtime", &paths.runtime, "runtime", "创作环境", emit).await?;
            state.runtime = Some(m.files.runtime.sha256.clone());
            paths.save_state(&state)?;
        }
        if state.browsers.as_deref() != Some(&m.files.browsers.sha256) || needs_browsers {
            install_pack(paths, &m.files.browsers, "browsers", &paths.browsers, "browsers", "发布用浏览器", emit).await?;
            state.browsers = Some(m.files.browsers.sha256.clone());
            paths.save_state(&state)?;
        }
    }

    // 2. 应用代码：安装目录 → 数据目录（保留 .env、profiles、outputs 等用户数据）
    let bundled = resources.join("easel");
    // .build-id 是分发代码的内容指纹（scripts/stage_easel.py 生成），代码有任何变化都会变
    let build_id = std::fs::read_to_string(bundled.join(".build-id")).unwrap_or_default();
    let app_id = format!("{}+{}", env!("CARGO_PKG_VERSION"), build_id.trim());
    if state.app_synced.as_deref() != Some(&app_id) || !paths.app.join("web").join("app.py").exists() {
        emit(Progress { step: "app", label: "更新创作技能".into(), percent: None, detail: app_id.clone() });
        let (src, dst) = (bundled.clone(), paths.app.clone());
        tokio::task::spawn_blocking(move || copy_tree(&src, &dst, &[".env"])).await??;
        state.app_synced = Some(app_id.clone());
        paths.save_state(&state)?;
    }
    let env_file = paths.app.join(".env");
    if !env_file.exists() {
        std::fs::write(&env_file, ENV_TEMPLATE)?;
    }

    // 3. OpenClaw 配置：只在 Agent 相关内容（技能、人设文件、配置脚本）、运行时或 .env 变化时重做。
    //    只改界面的升级不会触发，省掉每次升级约 1 分钟的等待
    let agent_id = std::fs::read_to_string(bundled.join(".agent-id")).unwrap_or_else(|_| app_id.clone());
    let fingerprint = {
        let mut h = Sha256::new();
        h.update(agent_id.trim().as_bytes());
        h.update(std::fs::read(resources.join("bootstrap").join("configure.py")).unwrap_or_default());
        h.update(state.runtime.clone().unwrap_or_default().as_bytes());
        h.update(std::fs::read(&env_file).unwrap_or_default());
        h.finalize().iter().map(|b| format!("{b:02x}")).collect::<String>()
    };
    if state.configured.as_deref() != Some(&fingerprint) {
        configure(paths, resources, emit).await?;
        state.configured = Some(fingerprint);
        paths.save_state(&state)?;
    }
    Ok(())
}

async fn install_pack(
    paths: &Paths,
    entry: &dist::FileEntry,
    step: &'static str,
    target: &Path,
    top: &str,
    what: &str,
    emit: Emit<'_>,
) -> Result<()> {
    let mb = |b: u64| b as f64 / 1_048_576.0;
    let label = format!("下载{what}");
    let on_dl = |done: u64, total: u64| {
        emit(Progress {
            step,
            label: label.clone(),
            percent: Some(done as f64 * 100.0 / total.max(1) as f64),
            detail: format!("{:.0} / {:.0} MB", mb(done), mb(total)),
        })
    };
    on_dl(0, entry.size);
    let archive = dist::download(entry, &paths.downloads, &on_dl).await?;

    let label = format!("安装{what}（首次需要几分钟）");
    let on_x = |done: u64, total: u64| {
        emit(Progress {
            step,
            label: label.clone(),
            percent: Some(done as f64 * 100.0 / total.max(1) as f64),
            detail: String::new(),
        })
    };
    tokio::task::block_in_place(|| dist::extract_replace(&archive, top, target, &on_x))?;
    let _ = std::fs::remove_file(&archive);
    Ok(())
}

/// 运行 bootstrap/configure.py，把它输出的 JSON 进度行转发给界面
async fn configure(paths: &Paths, resources: &Path, emit: Emit<'_>) -> Result<()> {
    emit(Progress { step: "configure", label: "配置 Agent".into(), percent: None, detail: String::new() });
    std::fs::create_dir_all(&paths.logs)?;
    let script: PathBuf = resources.join("bootstrap").join("configure.py");
    let log_path = paths.logs.join("setup.log");
    let mut cmd = Command::new(paths.python());
    cmd.arg(&script)
        .args(["--app".as_ref(), paths.app.as_os_str()])
        .args(["--node".as_ref(), paths.node().as_os_str()])
        .args(["--openclaw".as_ref(), paths.openclaw().as_os_str()])
        .args(["--log-file".as_ref(), paths.logs.join("openclaw.log").as_os_str()])
        .current_dir(&paths.app)
        .envs(services::child_env(paths))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(std::fs::File::create(&log_path)?);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let paths_logs = log_path.clone();
    let status = tokio::task::block_in_place(|| -> Result<std::process::ExitStatus> {
        let mut child = cmd.spawn().context("无法运行配置脚本")?;
        let stdout = child.stdout.take().unwrap();
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) {
                if let Some(msg) = v.get("message").and_then(|m| m.as_str()) {
                    emit(Progress { step: "configure", label: msg.to_string(), percent: None, detail: String::new() });
                }
            }
        }
        Ok(child.wait()?)
    })?;
    if !status.success() {
        bail!("Agent 配置失败。日志末尾：\n{}", services::log_tail(&paths_logs, 20));
    }
    Ok(())
}
