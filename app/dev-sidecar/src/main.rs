// Dev-only sidecar launcher: proxies to `npx tsx src/index.ts` with forwarded args.
// During development this lets Tauri's sidecar mechanism work without needing
// a compiled TS binary. Replace with real `bun build --compile` output for release.

use std::env;
use std::process::{Command, Stdio};

const DEFAULT_PROJECT_ROOT: &str = r"C:\Programming\Important Projects\deal-hunter";

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();

    let project_root = env::var("HERON_PROJECT_ROOT")
        .or_else(|_| env::var("DEAL_HUNTER_PROJECT_ROOT")) // legacy alias
        .unwrap_or_else(|_| DEFAULT_PROJECT_ROOT.to_string());

    // Use cmd /C to invoke npx since it's a .cmd on Windows
    let mut cmd_args = vec![
        "/C".to_string(),
        "npx".to_string(),
        "tsx".to_string(),
        "src/index.ts".to_string(),
    ];
    cmd_args.extend(args);

    let status = Command::new("cmd")
        .args(&cmd_args)
        .current_dir(&project_root)
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .expect("Failed to spawn npx tsx — is Node.js installed?");

    std::process::exit(status.code().unwrap_or(1));
}
