// Prevents an extra console window on Windows in release builds (future-proof).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{Manager, RunEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Handle del processo sidecar (server Node compilato) per lo shutdown pulito.
struct ServerChild(Mutex<Option<CommandChild>>);

/// Porta dinamica + token di sessione comunicati dal server interno
/// (riga `#[tauri-session] {...}` sul suo stdout).
#[derive(Clone)]
struct SessionInfo(std::sync::Arc<Mutex<Option<serde_json::Value>>>);

fn random_hex(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    getrandom::fill(&mut buf).expect("entropia non disponibile");
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

fn now_line(log: &mut std::fs::File, name: &str) {
    writeln!(log, "[setup] ▶ {name}").ok();
    eprintln!("[setup] ▶ {name}");
}

fn log_line(log: &mut std::fs::File, message: &str) {
    writeln!(log, "{message}").ok();
    println!("{message}");
}

/// Quando l'app arriva da un download, macOS mette com.apple.quarantine su
/// TUTTI i file del bundle: il "Apri comunque" sblocca l'app principale, ma
/// i processi figli quarantinati vengono uccisi con SIGKILL al lancio.
/// Rimuovere l'attributo dai file che dobbiamo eseguire (operazione filesystem
/// normale sui propri file, senza entitlement) risolve. Best-effort.
fn clear_quarantine(path: &Path, log: &mut std::fs::File) {
    match xattr::get(path, "com.apple.quarantine") {
        Ok(Some(_)) => match xattr::remove(path, "com.apple.quarantine") {
            Ok(()) => log_line(
                log,
                &format!("[setup] quarantena rimossa da {}", path.display()),
            ),
            Err(e) => log_line(
                log,
                &format!(
                    "[setup] ⚠ rimozione quarantena fallita su {}: {e}",
                    path.display()
                ),
            ),
        },
        Ok(None) => log_line(
            log,
            &format!("[setup] nessuna quarantena su {}", path.display()),
        ),
        Err(e) => log_line(
            log,
            &format!(
                "[setup] ⚠ lettura attributi fallita {}: {e}",
                path.display()
            ),
        ),
    }
}

/// Informa la UI su porta e token del server interno (chiamata IPC).
#[tauri::command]
fn session_info(state: tauri::State<SessionInfo>) -> Result<serde_json::Value, String> {
    for _ in 0..80 {
        if let Some(info) = state.0.lock().unwrap().clone() {
            return Ok(info);
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    Err("Sessione server non ancora disponibile".into())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(SessionInfo(std::sync::Arc::new(Mutex::new(None))))
        .invoke_handler(tauri::generate_handler![session_info])
        .setup(|app| {
            // Il log di setup viene creato PER PRIMO: qualunque fallimento
            // successivo resta tracciato nel file, anche senza Terminale.
            let log_dir = app
                .path()
                .app_log_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("android-device-control-logs"));
            std::fs::create_dir_all(&log_dir)?;
            let server_log_path = log_dir.join("poc-server.log");
            let mut setup_log = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&server_log_path)?;

            now_line(&mut setup_log, "percorsi utente");
            let data_dir = app.path().app_data_dir()?;
            let screenshots = data_dir.join("screenshots");
            std::fs::create_dir_all(&screenshots)?;
            std::fs::create_dir_all(data_dir.join("ui-dumps"))?;
            std::fs::create_dir_all(&log_dir)?;

            // Percorso applicativo UNICO per server interno (stessa radice).
            let data_dir_str = data_dir.to_string_lossy().into_owned();

            now_line(&mut setup_log, "tool bundled");
            let resource_dir = app.path().resource_dir()?;
            let tools = resource_dir.join("tools");
            let adb = tools.join("adb");
            let scrcpy = tools.join("scrcpy");
            let scrcpy_server = tools.join("scrcpy-server");
            if !adb.exists() || !scrcpy.exists() {
                return Err("Tool adb/scrcpy mancanti nelle risorse dell'app".into());
            }

            now_line(&mut setup_log, "binario sidecar");
            let exe_dir = std::env::current_exe()?
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_default();
            let sidecar_path: PathBuf = exe_dir.join("poc-server");
            if !sidecar_path.exists() {
                return Err(format!("Sidecar non trovato in {}", sidecar_path.display()).into());
            }

            clear_quarantine(&sidecar_path, &mut setup_log);
            clear_quarantine(&adb, &mut setup_log);
            clear_quarantine(&scrcpy, &mut setup_log);
            clear_quarantine(&scrcpy_server, &mut setup_log);

            // Token di sessione: senza di lui nessuno parla col server interno.
            let session_token = random_hex(24);

            now_line(&mut setup_log, "avvio server interno");
            let sidecar = app.shell().sidecar("poc-server")?;
            let (mut rx, child) = sidecar
                .env("POC_PORT", "0")
                .env("POC_SESSION_TOKEN", &session_token)
                .env("POC_DATA_DIR", &data_dir_str)
                .env("POC_ADB_BIN", adb.to_string_lossy().into_owned())
                .env("POC_SCRCPY_BIN", scrcpy.to_string_lossy().into_owned())
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

            // Forward stdout/stderr del server su file + cattura sessione.
            let session_log = server_log_path.clone();
            let state_handle = app.state::<SessionInfo>().inner().clone();
            if let Ok(mut file) = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&session_log)
            {
                tauri::async_runtime::spawn(async move {
                    use std::io::Write as _;
                    while let Some(event) = rx.recv().await {
                        match event {
                            CommandEvent::Stdout(line) => {
                                let text = String::from_utf8_lossy(&line).to_string();
                                if let Some(rest) = text.strip_prefix("#[tauri-session] ") {
                                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(rest) {
                                        *state_handle.0.lock().unwrap() = Some(v.clone());
                                    }
                                }
                                let _ = writeln!(file, "{text}");
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

            log_line(&mut setup_log, "[setup] server interno avviato");
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
