// 发布版在 Windows 上不弹出控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("--selftest") {
        let resources = args.get(2).map(Into::into).expect("用法：zimeidazi --selftest <资源目录>");
        std::process::exit(zimeidazi_lib::selftest(resources));
    }
    zimeidazi_lib::run_app()
}
