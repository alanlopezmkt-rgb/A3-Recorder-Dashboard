const fs = require("fs");
const path = require("path");

const dashboardDir = path.join(__dirname, "..", "dashboard");
const standaloneDir = path.join(dashboardDir, ".next", "standalone");

function copyDir(from, to) {
    if (!fs.existsSync(from)) {
        return;
    }
    fs.rmSync(to, { recursive: true, force: true });
    fs.cpSync(from, to, { recursive: true });
}

copyDir(path.join(dashboardDir, ".next", "static"), path.join(standaloneDir, ".next", "static"));
copyDir(path.join(dashboardDir, "public"), path.join(standaloneDir, "public"));

console.log("Arquivos estáticos copiados para .next/standalone.");
