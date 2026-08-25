const { app, BrowserWindow, Tray, Menu, nativeImage } = require("electron");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");

const PORT = 4173;

let mainWindow = null;
let tray = null;
let serverProcess = null;
let isQuitting = false;

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
        return;
    }

    const serverPath = getServerPath();

    serverProcess = spawn(process.execPath, [serverPath], {
        env: { ...process.env, PORT: String(PORT), HOSTNAME: "127.0.0.1", NODE_ENV: "production" },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
    });

    serverProcess.stdout.on("data", (data) => {
        console.log(`[dashboard-server] ${data}`);
    });

    serverProcess.stderr.on("data", (data) => {
        console.error(`[dashboard-server] ${data}`);
    });

    serverProcess.on("error", (error) => {
        console.error("Falha ao iniciar o servidor da dashboard:", error);
    });
}

function waitForServer(retries = 60) {
    return new Promise((resolve, reject) => {
        const tryOnce = (remaining) => {
            const request = http.get(`http://127.0.0.1:${PORT}`, () => {
                request.destroy();
                resolve();
            });

            request.on("error", () => {
                request.destroy();
                if (remaining <= 0) {
                    reject(new Error("O servidor da dashboard não respondeu a tempo."));
                    return;
                }
                setTimeout(() => tryOnce(remaining - 1), 500);
            });
        };

        tryOnce(retries);
    });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 960,
        minHeight: 640,
        title: "A3-OS Dashboard",
        icon: path.join(__dirname, "build", "icon.png"),
        backgroundColor: "#0b0b16",
        autoHideMenuBar: true,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    mainWindow.loadURL(`http://127.0.0.1:${PORT}`);

    mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
        console.error(`[window] falha ao carregar: ${errorCode} ${errorDescription}`);
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
    const icon = nativeImage.createFromPath(path.join(__dirname, "build", "icon.png"));
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

if (singleInstanceLock) {
    app.on("second-instance", () => {
        if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
        }
    });

    app.whenReady().then(async () => {
        await startServer();

        try {
            await waitForServer();
        } catch (error) {
            console.error(error);
        }

        createWindow();
        createTray();
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
