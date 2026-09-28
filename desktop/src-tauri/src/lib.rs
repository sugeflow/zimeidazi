mod dist;
mod paths;
mod services;
mod setup;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, RunEvent, Url, WebviewWindow};
use tauri_plugin_opener::OpenerExt;

use paths::Paths;
use services::Services;

struct AppState {
    paths: Paths,
    services: Arc<Services>,
    /// 准备/启动流程是否正在进行，防止重复点击
    busy: AtomicBool,
    /// 本地页面（准备页）的地址，服务崩溃时回到这里
    home: Mutex<Option<Url>>,
}

#[tauri::command]
fn app_info(app: AppHandle) -> serde_json::Value {
    let state = app.state::<AppState>();
    serde_json::json!({
        "version": app.package_info().version.to_string(),
        "platform": paths::PLATFORM,
        "dataDir": state.paths.root,
    })
}

#[tauri::command]
fn open_logs(app: AppHandle) -> Result<(), String> {
    let logs = app.state::<AppState>().paths.logs.clone();
    let _ = std::fs::create_dir_all(&logs);
    app.opener().open_path(logs.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}

/// 准备环境并启动服务；进度通过 dazi://progress 事件推送，失败推送 dazi://error。
#[tauri::command]
fn start(app: AppHandle) {
    let state = app.state::<AppState>();
    if state.busy.swap(true, Ordering::SeqCst) {
        return;
    }
    tauri::async_runtime::spawn(async move {
        let result = run(&app).await;
        let state = app.state::<AppState>();
        state.busy.store(false, Ordering::SeqCst);
        if let Err(e) = result {
            state.services.stop_all();
            let _ = app.emit("dazi://error", format!("{e:#}"));
        }
    });
}

async fn run(app: &AppHandle) -> anyhow::Result<()> {
    let state = app.state::<AppState>();
    let paths = state.paths.clone();
    let resources = app.path().resource_dir()?;
    let emit = |p: setup::Progress| {
        let _ = app.emit("dazi://progress", p);
    };

    // 清理上次异常退出留下的服务进程
    let mut st = paths.load_state();
    services::kill_stale(&st.pids);
    st.pids.clear();
    paths.save_state(&st)?;

    setup::prepare(&paths, &resources, &emit).await?;

    emit(setup::Progress { step: "start", label: "启动工作台".into(), percent: None, detail: String::new() });
    state.services.stop_all();
    services::check_ports()?;
    state.services.start(&paths).await?;

    let mut st = paths.load_state();
    st.pids = state.services.pids();
    paths.save_state(&st)?;

    let win = main_window(app)?;
    win.navigate(Url::parse(services::WEB_URL)?)?;
    watch(app.clone());
    Ok(())
}

/// 服务意外退出时回到准备页，由页面自动重新启动
fn watch(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(2));
        let state = app.state::<AppState>();
        if state.services.stopping.load(Ordering::SeqCst) {
            return;
        }
        if let Some(name) = state.services.crashed() {
            state.services.stop_all();
            if let (Ok(win), Some(mut home)) = (main_window(&app), state.home.lock().unwrap().clone()) {
                home.set_query(Some(&format!("crashed={name}")));
                let _ = win.navigate(home);
            }
            return;
        }
    });
}

/// 收到 SIGTERM / SIGINT / SIGHUP（注销、kill）时走正常退出流程，确保服务被关闭
#[cfg(unix)]
fn exit_on_signals(app: AppHandle) {
    use signal_hook::consts::{SIGHUP, SIGINT, SIGTERM};
    if let Ok(mut signals) = signal_hook::iterator::Signals::new([SIGTERM, SIGINT, SIGHUP]) {
        std::thread::spawn(move || {
            if signals.forever().next().is_some() {
                app.exit(0);
            }
        });
    }
}

#[cfg(windows)]
fn exit_on_signals(_app: AppHandle) {}

fn main_window(app: &AppHandle) -> anyhow::Result<WebviewWindow> {
    app.get_webview_window("main").ok_or_else(|| anyhow::anyhow!("主窗口不存在"))
}

/// 无窗口自检：准备环境 → 启动服务 → 检查 → 关闭并确认进程已清理。供 CI 在各平台验证。
/// 用法：zimeidazi --selftest <资源目录>；进度写入 <数据目录>/logs/selftest.log
pub fn selftest(resources: std::path::PathBuf) -> i32 {
    let resources = std::fs::canonicalize(&resources).unwrap_or(resources);
    let paths = match Paths::new() {
        Ok(p) => p,
        Err(e) => {
            eprintln!("{e:#}");
            return 2;
        }
    };
    let _ = std::fs::create_dir_all(&paths.logs);
    let log = std::sync::Mutex::new(std::fs::File::create(paths.logs.join("selftest.log")).ok());
    let say = |msg: String| {
        eprintln!("[selftest] {msg}");
        if let Some(f) = log.lock().unwrap().as_mut() {
            use std::io::Write;
            let _ = writeln!(f, "{msg}");
        }
    };
    let rt = tokio::runtime::Builder::new_multi_thread().enable_all().build().unwrap();
    let services = Services::new().expect("无法创建进程管理器");
    let result = rt.block_on(async {
        let t0 = std::time::Instant::now();
        let last = std::sync::Mutex::new(String::new());
        let emit = |p: setup::Progress| {
            let line = format!("{} {}", p.label, p.detail);
            if *last.lock().unwrap() != p.label {
                say(format!("{:>4}s {line}", t0.elapsed().as_secs()));
                *last.lock().unwrap() = p.label.clone();
            }
        };
        setup::prepare(&paths, &resources, &emit).await?;
        services::check_ports()?;
        services.start(&paths).await?;
        let body = reqwest::Client::builder().no_proxy().build()?
            .get(format!("{}api/status", services::WEB_URL)).send().await?.bytes().await?;
        let status: serde_json::Value = serde_json::from_slice(&body)?;
        let skills = status["skills"].as_array().map(|a| a.len()).unwrap_or(0);
        anyhow::ensure!(status["gateway"] == true, "后端报告 gateway 不在线");
        anyhow::ensure!(skills >= 50, "技能数量异常：{skills}");
        say(format!("{:>4}s 服务正常：gateway 在线，{skills} 个技能", t0.elapsed().as_secs()));
        let pids = services.pids();
        services.stop_all();
        std::thread::sleep(Duration::from_secs(2));
        anyhow::ensure!(services::check_ports().is_ok(), "关闭后端口仍被占用，进程没有清理干净");
        say(format!("{:>4}s 已关闭，进程已清理（{pids:?}）", t0.elapsed().as_secs()));
        anyhow::Ok(())
    });
    services.stop_all();
    match result {
        Ok(()) => {
            say("自检通过".into());
            0
        }
        Err(e) => {
            say(format!("自检失败：{e:#}"));
            1
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run_app() {
    let paths = Paths::new().expect("无法确定数据目录");
    let services = Arc::new(Services::new().expect("无法创建进程管理器"));

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Ok(win) = main_window(app) {
                let _ = win.unminimize();
                let _ = win.show();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            paths,
            services: services.clone(),
            busy: AtomicBool::new(false),
            home: Mutex::new(None),
        })
        .setup(|app| {
            let home = main_window(app.handle())?.url()?;
            *app.state::<AppState>().home.lock().unwrap() = Some(home);
            exit_on_signals(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![app_info, open_logs, start])
        .build(tauri::generate_context!())
        .expect("启动自媒搭子失败");

    app.run(move |_handle, event| {
        if let RunEvent::Exit = event {
            services.stop_all();
        }
    });
}
