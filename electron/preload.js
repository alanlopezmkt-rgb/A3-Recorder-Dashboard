const { contextBridge, ipcRenderer } = require("electron");

// Ponte segura entre a página (dashboard Next.js, contextIsolation ligado)
// e o processo principal do Electron. Só expõe o que a página realmente
// precisa — nada de nodeIntegration/acesso livre a APIs do Node.
contextBridge.exposeInMainWorld("a3os", {
    isElectron: true,
    getAutostart: () => ipcRenderer.invoke("a3os:get-autostart"),
    setAutostart: (enabled) => ipcRenderer.invoke("a3os:set-autostart", enabled),
});
