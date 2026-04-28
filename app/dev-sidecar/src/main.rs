// Dev sidecar launcher: in dev mode, proxies to `npx tsx src/index.ts` from
// the deal-hunter project root. In release mode, uses the bundled Node.exe +
// node_modules + src that Tauri ships as resources alongside the main app
// binary. Sees release vs dev by checking whether the bundled resources
// exist next to its own binary location.

use std::env;
use std::path::PathBuf;
use std::process::{Command, Stdio};

const DEFAULT_PROJECT_ROOT: &str = r"C:\Programming\Important Projects\deal-hunter";

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    let exe_dir = env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(PathBuf::from));

    // Release mode: bundled Node + node_modules + dist live next to the
    // sidecar binary in the Tauri MSI's install dir, populated by
    // `npm run prepare-sidecar` before `cargo tauri build`. dist/ is the
    // compiled JS (tsc output); we run it with plain Node, no tsx.
    let bundled = exe_dir.as_ref().and_then(|dir| {
        let node = dir.join("sidecar-runtime").join("node.exe");
        let entry = dir.join("sidecar-runtime").join("dist").join("index.js");
        let modules_root = dir.join("sidecar-runtime");
        if node.exists() && entry.exists() {
            Some((node, entry, modules_root))
        } else {
            None
        }
    });

    if let Some((node_exe, entry, cwd)) = bundled {
        let mut cmd_args: Vec<String> = vec![entry.to_string_lossy().to_string()];
        cmd_args.extend(args.clone());
        let status = Command::new(node_exe)
            .args(&cmd_args)
            .current_dir(&cwd)
            .stdin(Stdio::inherit())
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .status()
            .expect("Failed to spawn bundled Node");
        std::process::exit(status.code().unwrap_or(1));
    }

    // Dev fallback: shell out to npx tsx in the project root.
    let project_root = env::var("HERON_PROJECT_ROOT")
        .or_else(|_| env::var("DEAL_HUNTER_PROJECT_ROOT")) // legacy alias
        .unwrap_or_else(|_| DEFAULT_PROJECT_ROOT.to_string());

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
