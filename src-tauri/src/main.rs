// Prevents an extra console window on Windows in release builds (future-proof).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;

use tauri::{Manager, RunEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Handle del processo sidecar (server Node compilato) per lo shutdown pulito.
struct ServerChild(Mutex<Option<CommandChild>>);

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Tool bundled (adb + scrcpy) dentro le risorse dell'app
            let resource_dir = app.path().resource_dir()?;
            let tools = resource_dir.join("tools");
            let adb = tools.join("adb");
            let scrcpy = tools.join("scrcpy");
            if !adb.exists() || !scrcpy.exists() {
                return Err("Tool adb/scrcpy mancanti nelle risorse dell'app".into());
            }

            // Cartelle utente: screenshot e log (fuori dal bundle, scrivibili)
            let data_dir = app.path().app_data_dir()?;
            let screenshots = data_dir.join("screenshots");
            let log_dir = app
                .path()
                .app_log_dir()
                .unwrap_or_else(|_| data_dir.clone());
            std::fs::create_dir_all(&screenshots)?;
            std::fs::create_dir_all(data_dir.join("ui-dumps"))?;
            std::fs::create_dir_all(&log_dir)?;

            let sidecar = app.shell().sidecar("poc-server")?;
            let (mut rx, child) = sidecar
                .env("POC_ADB_BIN", adb.to_string_lossy().into_owned())
                .env("POC_SCRCPY_BIN", scrcpy.to_string_lossy().into_owned())
                .env(
                    "POC_SCREENSHOT_DIR",
                    screenshots.to_string_lossy().into_owned(),
                )
                // Dump XML uiautomator: percorso assoluto (il CWD del sidecar
                // lanciato da Finder è "/", un path relativo non è scrivibile)
                .env(
                    "POC_UI_DUMP_DIR",
                    data_dir.join("ui-dumps").to_string_lossy().into_owned(),
                )
                // Lettore UI senza idle (jar dex): se manca, il server ripiega su uiautomator
                .env(
                    "POC_UI_DUMPER_JAR",
                    tools.join("ui-dump.jar").to_string_lossy().into_owned(),
                )
                .env("POC_LOG_DIR", log_dir.to_string_lossy().into_owned())
                .env("POC_PARENT_WATCHDOG", "1")
                // scrcpy individua adb dal PATH: aggiungiamo la cartella tool
                .env(
                    "PATH",
                    format!(
                        "{}:{}",
                        tools.display(),
                        std::env::var("PATH").unwrap_or_default()
                    ),
                )
                .spawn()?;

            // Forward stdout/stderr del server su un file di log (debug tester)
            let server_log = log_dir.join("poc-server.log");
            if let Ok(mut file) = std::fs::File::create(&server_log) {
                tauri::async_runtime::spawn(async move {
                    use std::io::Write as _;
                    while let Some(event) = rx.recv().await {
                        match event {
                            CommandEvent::Stdout(line) => {
                                let _ = writeln!(file, "{}", String::from_utf8_lossy(&line));
                            }
                            CommandEvent::Stderr(line) => {
                                let _ =
                                    writeln!(file, "[stderr] {}", String::from_utf8_lossy(&line));
                            }
                            CommandEvent::Terminated(status) => {
                                let _ = writeln!(file, "[terminated] {status:?}");
                            }
                            CommandEvent::Error(err) => {
                                let _ = writeln!(file, "[error] {err}");
                            }
                            other => {
                                let _ = writeln!(file, "[event] {other:?}");
                            }
                        }
                        let _ = file.flush();
                    }
                });
            }

            app.manage(ServerChild(Mutex::new(Some(child))));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("errore durante l'avvio dell'app")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(state) = app.try_state::<ServerChild>() {
                    if let Some(child) = state.0.lock().unwrap().take() {
                        let _ = child.kill();
                    }
                }
            }
        });
}
