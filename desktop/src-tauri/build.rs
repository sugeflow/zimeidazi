fn main() {
    // 这个版本的桌面壳要用哪一版运行时包：来自 runtime/versions.json，编译进程序
    let versions = "../../runtime/versions.json";
    println!("cargo:rerun-if-changed={versions}");
    let text = std::fs::read_to_string(versions).expect("读取 runtime/versions.json 失败");
    let v: serde_json::Value = serde_json::from_str(&text).expect("runtime/versions.json 格式不对");
    let rv = v["runtime_version"].as_str().expect("缺少 runtime_version");
    println!("cargo:rustc-env=ZMDZ_RUNTIME_VERSION={rv}");
    tauri_build::build()
}
