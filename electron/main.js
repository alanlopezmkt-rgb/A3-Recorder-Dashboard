const { app, BrowserWindow, Tray, Menu, nativeImage, dialog, session, ipcMain } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const fs = require("fs");
const http = require("http");
const { spawn } = require("child_process");

const PORT = 4173;
// Marca colocada em app.setLoginItemSettings({ args: [...] }) — é assim que
// sabemos, ao iniciar via Windows, que fomos abertos automaticamente no
// login (e não por um duplo-clique manual do usuário), pra decidir se a
// janela some ficando só o ícone na bandeja.
const START_MINIMIZED_FLAG = "--start-minimized";

let mainWindow = null;
let tray = null;
let serverProcess = null;
let isQuitting = false;
const startMinimized = process.argv.includes(START_MINIMIZED_FLAG);

const logFilePath = path.join(app.getPath("userData"), "main.log");

function log(...args) {
    const line = `[${new Date().toISOString()}] ${args.map((a) => (a instanceof Error ? a.stack : String(a))).join(" ")}\n`;
    console.log(line.trim());
    try {
        fs.appendFileSync(logFilePath, line);
    } catch {
        // ignora falha ao gravar log
    }
}

process.on("uncaughtException", (error) => {
    log("uncaughtException:", error);
});

app.setAppUserModelId("A3-OS Dashboard");

const singleInstanceLock = app.requestSingleInstanceLock();

if (!singleInstanceLock) {
    app.quit();
}

function getServerPath() {
    if (app.isPackaged) {
        return path.join(process.resourcesPath, "app", "server.js");
    }
    return path.join(__dirname, "..", "dashboard", ".next", "standalone", "server.js");
}

function getIconPath() {
    if (app.isPackaged) {
        return path.join(process.resourcesPath, "build", "icon.png");
    }
    return path.join(__dirname, "build", "icon.png");
}

function isServerAlreadyRunning() {
    return new Promise((resolve) => {
        const request = http.get(`http://127.0.0.1:${PORT}`, () => {
            request.destroy();
            resolve(true);
        });
        request.on("error", () => {
            request.destroy();
            resolve(false);
        });
    });
}

async function startServer() {
    if (await isServerAlreadyRunning()) {
        log("Servidor já respondendo, não vou iniciar outro.");
        return;
    }

    const serverPath = getServerPath();
    log("Iniciando servidor da dashboard em:", serverPath, "existe:", fs.existsSync(serverPath));

    serverProcess = spawn(process.execPath, [serverPath], {
        env: { ...process.env, PORT: String(PORT), HOSTNAME: "127.0.0.1", NODE_ENV: "production", ELECTRON_RUN_AS_NODE: "1" },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
    });

    serverProcess.stdout.on("data", (data) => {
        log(`[dashboard-server]`, data.toString());
    });

    serverProcess.stderr.on("data", (data) => {
        log(`[dashboard-server:err]`, data.toString());
    });

    serverProcess.on("error", (error) => {
        log("Falha ao iniciar o servidor da dashboard:", error);
    });

    serverProcess.on("exit", (code, signal) => {
        log(`[dashboard-server] processo encerrado. code=${code} signal=${signal}`);
    });
}

function waitForServer(retries = 60) {
    let lastError = null;

    return new Promise((resolve, reject) => {
        const tryOnce = (remaining) => {
            const request = http.get(`http://127.0.0.1:${PORT}`, () => {
                request.destroy();
                resolve();
            });

            request.on("error", (error) => {
                lastError = error;
                request.destroy();
                if (remaining <= 0) {
                    reject(new Error(`O servidor da dashboard não respondeu a tempo. ${lastError ? lastError.message : ""}`));
                    return;
                }
                setTimeout(() => tryOnce(remaining - 1), 500);
            });
        };

        tryOnce(retries);
    });
}

function configurarPermissoesNotificacao() {
    // Sem um handler explicito, o Electron nega silenciosamente o pedido de
    // permissao de notificacao feito pelo Notification.requestPermission()
    // da pagina, entao os avisos de "Transcricao concluida" etc nunca
    // aparecem — mesmo a pagina achando que tem permissao concedida.
    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
        callback(permission === "notifications");
    });
    session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
        return permission === "notifications";
    });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 960,
        minHeight: 640,
        title: "A3-OS Dashboard",
        icon: getIconPath(),
        backgroundColor: "#0b0b16",
        autoHideMenuBar: true,
        // Se fomos abertos automaticamente pelo login do Windows com a opção
        // "iniciar minimizado" ligada, a janela nasce escondida — só o ícone
        // na bandeja aparece. O usuário abre clicando no tray.
        show: !startMinimized,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload: path.join(__dirname, "preload.js"),
        },
    });

    log("Carregando janela em", `http://127.0.0.1:${PORT}`, "startMinimized:", startMinimized);
    mainWindow.loadURL(`http://127.0.0.1:${PORT}`);

    mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
        log(`[window] falha ao carregar: ${errorCode} ${errorDescription}`);
    });

    mainWindow.webContents.on("render-process-gone", (_event, details) => {
        log("[window] render-process-gone:", JSON.stringify(details));
    });

    mainWindow.webContents.on("did-finish-load", () => {
        log("[window] did-finish-load ok");
    });

    if (!app.isPackaged) {
        mainWindow.webContents.openDevTools();
    }

    mainWindow.on("close", (event) => {
        if (isQuitting) {
            return;
        }
        event.preventDefault();
        mainWindow.hide();
    });
}

function createTray() {
    const icon = nativeImage.createFromPath(getIconPath());
    tray = new Tray(icon.resize({ width: 16, height: 16 }));
    tray.setToolTip("A3-OS Dashboard");

    const menu = Menu.buildFromTemplate([
        {
            label: "Abrir A3-OS Dashboard",
            click: () => {
                mainWindow.show();
                mainWindow.focus();
            },
        },
        { type: "separator" },
        {
            label: "Sair",
            click: () => {
                isQuitting = true;
                app.quit();
            },
        },
    ]);

    tray.setContextMenu(menu);

    tray.on("click", () => {
        if (mainWindow.isVisible()) {
            mainWindow.hide();
        } else {
            mainWindow.show();
            mainWindow.focus();
        }
    });

    tray.on("double-click", () => {
        mainWindow.show();
        mainWindow.focus();
    });
}

function getAutostartState() {
    // No Windows, isPackaged=false roda via "electron ." (dev), e
    // setLoginItemSettings não funciona bem nesse modo — só faz sentido no
    // app empacotado (instalado de verdade).
    if (!app.isPackaged) {
        return { supported: false, enabled: false };
    }
    const settings = app.getLoginItemSettings({ args: [START_MINIMIZED_FLAG] });
    return { supported: true, enabled: settings.openAtLogin };
}

function setAutostartState(enabled) {
    if (!app.isPackaged) {
        return getAutostartState();
    }
    app.setLoginItemSettings({
        openAtLogin: enabled,
        args: [START_MINIMIZED_FLAG],
    });
    return getAutostartState();
}

ipcMain.handle("a3os:get-autostart", () => getAutostartState());
ipcMain.handle("a3os:set-autostart", (_event, enabled) => setAutostartState(Boolean(enabled)));

// --- Atualização automática (electron-updater + GitHub Releases) ---------

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.logger = { info: (...a) => log("[updater]", ...a), warn: (...a) => log("[updater][warn]", ...a), error: (...a) => log("[updater][erro]", ...a) };

function sendUpdateStatus(status) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("a3os:update-status", status);
    }
}

autoUpdater.on("checking-for-update", () => sendUpdateStatus({ state: "checking" }));
autoUpdater.on("update-available", (info) => sendUpdateStatus({ state: "available", version: info.version }));
autoUpdater.on("update-not-available", () => sendUpdateStatus({ state: "not-available", version: app.getVersion() }));
autoUpdater.on("download-progress", (progress) => sendUpdateStatus({ state: "downloading", percent: Math.round(progress.percent) }));
autoUpdater.on("update-downloaded", (info) => sendUpdateStatus({ state: "downloaded", version: info.version }));
autoUpdater.on("error", (error) => {
    log("Erro no autoUpdater:", error);
    sendUpdateStatus({ state: "error", message: error.message });
});

ipcMain.handle("a3os:check-for-update", async () => {
    if (!app.isPackaged) {
        return { supported: false };
    }
    try {
        await autoUpdater.checkForUpdates();
        return { supported: true };
    } catch (error) {
        sendUpdateStatus({ state: "error", message: error.message });
        return { supported: true };
    }
});

ipcMain.handle("a3os:download-update", async () => {
    if (!app.isPackaged) return;
    try {
        await autoUpdater.downloadUpdate();
    } catch (error) {
        sendUpdateStatus({ state: "error", message: error.message });
    }
});

ipcMain.handle("a3os:install-update", () => {
    isQuitting = true;
    autoUpdater.quitAndInstall();
});

ipcMain.handle("a3os:get-app-version", () => app.getVersion());

if (singleInstanceLock) {
    app.on("second-instance", () => {
        if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
        }
    });

    app.whenReady().then(async () => {
        log("App pronto. isPackaged =", app.isPackaged, "resourcesPath =", process.resourcesPath);
        configurarPermissoesNotificacao();
        await startServer();

        try {
            await waitForServer();
            log("Servidor respondendo em http://127.0.0.1:" + PORT);
        } catch (error) {
            log("Erro esperando o servidor:", error);
            dialog.showErrorBox(
                "A3-OS Dashboard - erro ao iniciar",
                `Não foi possível iniciar o servidor da dashboard.\n\n${error.message}\n\nLog completo em:\n${logFilePath}`
            );
        }

        createWindow();
        createTray();

        if (app.isPackaged) {
            // Checagem automática e silenciosa ao abrir — não baixa nada
            // sozinho, só avisa na Central de Notificações/Configurações
            // se houver versão nova (baixar/instalar continua manual).
            setTimeout(() => {
                autoUpdater.checkForUpdates().catch((error) => log("Checagem automática de atualização falhou:", error));
            }, 10000);
        }
    });

    app.on("window-all-closed", () => {
        // Não encerra o app: continua rodando na bandeja, como o Discord.
    });

    app.on("before-quit", () => {
        isQuitting = true;
        if (serverProcess) {
            serverProcess.kill();
        }
    });
}
