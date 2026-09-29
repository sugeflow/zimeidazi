//! 启动、守护、关闭 OpenClaw gateway 和 Easel 后端。
//!
//! Windows：所有子进程放进一个 Job Object（关闭时结束全部进程），壳崩溃时系统也会回收它们，
//!          并用 CREATE_NO_WINDOW 避免弹出黑色控制台窗口。
//! macOS：  每个服务是独立进程组，退出时对整组发 SIGTERM，超时后 SIGKILL。

use std::collections::HashMap;
use std::ffi::OsString;
use std::fs::File;
use std::net::TcpListener;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::{bail, Context, Result};

use crate::paths::Paths;

pub const GATEWAY_PORT: u16 = 18789;
pub const WEB_PORT: u16 = 7860;
pub const WEB_URL: &str = "http://127.0.0.1:7860/";

/// 服务名 → 进程
pub struct Services {
    children: Mutex<HashMap<&'static str, Child>>,
    #[cfg(windows)]
    job: win32job::Job,
    /// 为 true 时表示是我们主动关闭，守护线程不要当作崩溃
    pub stopping: Arc<std::sync::atomic::AtomicBool>,
}

impl Services {
    pub fn new() -> Result<Self> {
        #[cfg(windows)]
        let job = {
            let job = win32job::Job::create()?;
            let mut info = job.query_extended_limit_info()?;
            info.limit_kill_on_job_close();
            job.set_extended_limit_info(&mut info)?;
            job
        };
        Ok(Self {
            children: Mutex::new(HashMap::new()),
            #[cfg(windows)]
            job,
            stopping: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        })
    }

    pub fn pids(&self) -> Vec<u32> {
        self.children.lock().unwrap().values().map(|c| c.id()).collect()
    }

    /// 同时启动 gateway 和后端，等两者都就绪。
    pub async fn start(&self, paths: &Paths) -> Result<()> {
        self.stopping.store(false, std::sync::atomic::Ordering::SeqCst);
        std::fs::create_dir_all(&paths.logs)?;
        let env = child_env(paths);

        self.spawn(
            "gateway",
            paths.node(),
            &[
                paths.openclaw().into_os_string(),
                "--profile".into(), "easel".into(),
                "gateway".into(), "run".into(), "--force".into(), "--allow-unconfigured".into(),
                "--bind".into(), "loopback".into(), "--port".into(), GATEWAY_PORT.to_string().into(),
            ],
            &paths.app,
            &env,
            &paths.logs.join("gateway.log"),
        )?;
        // 后端启动不依赖 gateway，两者同时启动，最后一起等就绪（每次打开省几秒）
        self.spawn(
            "web",
            paths.python(),
            &[paths.app.join("web").join("app.py").into_os_string()],
            &paths.app,
            &env,
            &paths.logs.join("web.log"),
        )?;
        self.wait_ready("gateway", &format!("http://127.0.0.1:{GATEWAY_PORT}/healthz"), &paths.logs.join("gateway.log"))
            .await
            .context("Agent 引擎启动失败")?;
        self.wait_ready("web", &format!("http://127.0.0.1:{WEB_PORT}/api/status"), &paths.logs.join("web.log"))
            .await
            .context("工作台后端启动失败")?;
        Ok(())
    }

    fn spawn(
        &self,
        name: &'static str,
        program: impl AsRef<Path>,
        args: &[OsString],
        cwd: &Path,
        env: &HashMap<String, OsString>,
        log: &Path,
    ) -> Result<u32> {
        rotate(log);
        let out = File::create(log)?;
        let mut cmd = Command::new(program.as_ref());
        cmd.args(args)
            .current_dir(cwd)
            .envs(env)
            .stdin(Stdio::null())
            .stdout(out.try_clone()?)
            .stderr(out);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            cmd.process_group(0);
        }
        let child = cmd.spawn().with_context(|| format!("无法启动 {name}"))?;
        #[cfg(windows)]
        {
            use std::os::windows::io::AsRawHandle;
            self.job.assign_process(child.as_raw_handle() as isize)?;
        }
        let pid = child.id();
        self.children.lock().unwrap().insert(name, child);
        Ok(pid)
    }

    /// 轮询 url 直到返回 2xx；进程提前退出则立即失败。首次冷启动较慢，最多等 5 分钟。
    async fn wait_ready(&self, name: &'static str, url: &str, log: &Path) -> Result<()> {
        let client = reqwest::Client::builder().no_proxy().timeout(Duration::from_secs(5)).build()?;
        let deadline = Instant::now() + Duration::from_secs(300);
        while Instant::now() < deadline {
            if let Ok(r) = client.get(url).send().await {
                if r.status().is_success() {
                    return Ok(());
                }
            }
            if self.crashed() == Some(name) {
                bail!("进程意外退出。日志末尾：\n{}", log_tail(log, 20));
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
        bail!("5 分钟内没有就绪。日志末尾：\n{}", log_tail(log, 20))
    }

    /// 有服务意外退出时返回它的名字
    pub fn crashed(&self) -> Option<&'static str> {
        let mut children = self.children.lock().unwrap();
        children
            .iter_mut()
            .find_map(|(n, c)| matches!(c.try_wait(), Ok(Some(_))).then_some(*n))
    }

    pub fn stop_all(&self) {
        self.stopping.store(true, std::sync::atomic::Ordering::SeqCst);
        let mut children = self.children.lock().unwrap();
        // 先停后端再停 gateway
        for name in ["web", "gateway"] {
            if let Some(mut child) = children.remove(name) {
                terminate(&mut child);
            }
        }
    }
}

#[cfg(unix)]
fn terminate(child: &mut Child) {
    let pgid = child.id() as i32;
    unsafe { libc::kill(-pgid, libc::SIGTERM) };
    // gateway 默认会等 5 分钟排空任务，这里最多等 3 秒
    let deadline = Instant::now() + Duration::from_secs(3);
    while Instant::now() < deadline {
        if matches!(child.try_wait(), Ok(Some(_))) {
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    unsafe { libc::kill(-pgid, libc::SIGKILL) };
    let _ = child.wait();
}

#[cfg(windows)]
fn terminate(child: &mut Child) {
    // 结束整棵进程树；Job Object 是兜底
    let _ = {
        use std::os::windows::process::CommandExt;
        Command::new("taskkill")
            .args(["/T", "/F", "/PID", &child.id().to_string()])
            .creation_flags(0x0800_0000)
            .output()
    };
    let _ = child.wait();
}

/// 上次异常退出残留的进程：只清理 state 里记录过、且仍在运行的
pub fn kill_stale(pids: &[u32]) {
    for &pid in pids {
        #[cfg(unix)]
        unsafe {
            libc::kill(-(pid as i32), libc::SIGKILL);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            let _ = Command::new("taskkill")
                .args(["/T", "/F", "/PID", &pid.to_string()])
                .creation_flags(0x0800_0000)
                .output();
        }
    }
}

pub fn check_ports() -> Result<()> {
    for (port, what) in [(GATEWAY_PORT, "Agent 引擎"), (WEB_PORT, "工作台")] {
        if TcpListener::bind(("127.0.0.1", port)).is_err() {
            bail!("端口 {port} 被其他程序占用，{what}无法启动。请关闭占用该端口的程序（例如另一个 Easel）后重试");
        }
    }
    Ok(())
}

pub fn child_env(paths: &Paths) -> HashMap<String, OsString> {
    let mut env = HashMap::new();
    let mut path: Vec<_> = paths.bin_dirs();
    if let Some(sys) = std::env::var_os("PATH") {
        path.extend(std::env::split_paths(&sys));
    }
    env.insert("PATH".into(), std::env::join_paths(path).unwrap_or_default());
    let mut set = |k: &str, v: OsString| {
        env.insert(k.into(), v);
    };
    let _ = std::fs::create_dir_all(&paths.home);
    set("HOME", paths.home.clone().into_os_string());
    set("USERPROFILE", paths.home.clone().into_os_string());
    set("EASEL_ROOT", paths.app.clone().into_os_string());
    set("EASEL_PORT", WEB_PORT.to_string().into());
    set("PLAYWRIGHT_BROWSERS_PATH", paths.browsers.clone().into_os_string());
    set("EASEL_RAW_STREAM_PATH", paths.logs.join("raw-stream.jsonl").into_os_string());
    set("PYTHONUTF8", "1".into());
    set("PYTHONIOENCODING", "utf-8".into());
    set("HF_ENDPOINT", "https://hf-mirror.com".into());
    set("NO_PROXY", "localhost,127.0.0.1".into());
    set("no_proxy", "localhost,127.0.0.1".into());
    env
}

/// 日志最后几行，放进错误信息里方便排查
pub fn log_tail(log: &Path, lines: usize) -> String {
    let text = std::fs::read(log).map(|b| String::from_utf8_lossy(&b).into_owned()).unwrap_or_default();
    let all: Vec<&str> = text.lines().collect();
    all[all.len().saturating_sub(lines)..].join("\n")
}

/// 保留上一次的日志为 .1
fn rotate(log: &Path) {
    if log.exists() {
        let _ = std::fs::rename(log, log.with_extension("log.1"));
    }
}
