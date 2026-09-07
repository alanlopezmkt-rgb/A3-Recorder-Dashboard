const { contextBridge, ipcRenderer } = require("electron");

// Ponte segura entre a página (dashboard Next.js, contextIsolation ligado)
// e o processo principal do Electron. Só expõe o que a página realmente
// precisa — nada de nodeIntegration/acesso livre a APIs do Node.
contextBridge.exposeInMainWorld("a3os", {
    isElectron: true,
    getAutostart: () => ipcRenderer.invoke("a3os:get-autostart"),
    setAutostart: (enabled) => ipcRenderer.invoke("a3os:set-autostart", enabled),
    getAppVersion: () => ipcRenderer.invoke("a3os:get-app-version"),
    checkForUpdate: () => ipcRenderer.invoke("a3os:check-for-update"),
    downloadUpdate: () => ipcRenderer.invoke("a3os:download-update"),
    installUpdate: () => ipcRenderer.invoke("a3os:install-update"),
    onUpdateStatus: (callback) => {
        const listener = (_event, status) => callback(status);
        ipcRenderer.on("a3os:update-status", listener);
        return () => ipcRenderer.removeListener("a3os:update-status", listener);
    },
});
