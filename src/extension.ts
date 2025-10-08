import * as vscode from 'vscode';
import * as ftp from 'basic-ftp';
import { NodeSSH } from 'node-ssh'; // SSH/SFTP

interface ServerConfig {
    name: string;
    host: string;
    user: string;
    password: string;
    type: 'FTP' | 'SFTP' | 'SSH';
}

export function activate(context: vscode.ExtensionContext) {
    console.log('ConectaCode extension is active!');

    const serversKey = 'conectacode.servers';
    const servers: ServerConfig[] = context.globalState.get(serversKey, []);

    // -------------------------------
    // 1️⃣ TreeDataProvider para la barra lateral
    // -------------------------------
    const treeDataProvider = new ServerTreeProvider(servers);
    vscode.window.registerTreeDataProvider('conectacodeServersView', treeDataProvider);

    // -------------------------------
    // 2️⃣ Comando: Agregar conexión
    // -------------------------------
    const addServerCmd = vscode.commands.registerCommand('conectacode.addServer', async () => {
        const name = await vscode.window.showInputBox({ prompt: 'Nombre de la conexión' });
        if (!name) return;

        const host = await vscode.window.showInputBox({ prompt: 'Host del servidor' });
        if (!host) return;

        const user = await vscode.window.showInputBox({ prompt: 'Usuario' });
        if (!user) return;

        const password = await vscode.window.showInputBox({ prompt: 'Contraseña', password: true });
        if (!password) return;

        const type = await vscode.window.showQuickPick(['FTP', 'SFTP', 'SSH'], { placeHolder: 'Tipo de conexión' }) as 'FTP' | 'SFTP' | 'SSH';
        if (!type) return;

        const newServer: ServerConfig = { name, host, user, password, type };
        servers.push(newServer);
        await context.globalState.update(serversKey, servers);

        treeDataProvider.refresh();
        vscode.window.showInformationMessage(`✅ Servidor "${name}" agregado`);
    });
    context.subscriptions.push(addServerCmd);

    // -------------------------------
    // 3️⃣ Comando: Conectar a un servidor desde la lista
    // -------------------------------
    const connectCommand = vscode.commands.registerCommand('conectacode.connectServer', async (server: ServerConfig) => {
        if (server.type === 'FTP') {
            const client = new ftp.Client();
            client.ftp.verbose = true;
            try {
                await client.access({ host: server.host, user: server.user, password: server.password });
                vscode.window.showInformationMessage(`✅ Conectado a ${server.name} vía FTP`);
                const list = await client.list();
                vscode.window.showInformationMessage(`📁 Archivos: ${list.map(f => f.name).join(', ') || '(vacío)'}`);
                client.close();
            } catch (err: any) {
                vscode.window.showErrorMessage(`❌ Error FTP: ${err.message}`);
            }
        } else {
            const ssh = new NodeSSH();
            try {
                await ssh.connect({ host: server.host, username: server.user, password: server.password });
                vscode.window.showInformationMessage(`✅ Conectado a ${server.name} vía ${server.type}`);
                if (server.type === 'SFTP') {
                    const sftp = await ssh.requestSFTP();
                    vscode.window.showInformationMessage(`✅ SFTP listo`);
                    sftp.end();
                }
                ssh.dispose();
            } catch (err: any) {
                vscode.window.showErrorMessage(`❌ Error ${server.type}: ${err.message}`);
            }
        }
    });
    context.subscriptions.push(connectCommand);

const editServerCmd = vscode.commands.registerCommand('conectacode.editServer', async (item: ServerItem) => {
    const server = item.server; // <-- Aquí obtienes la conexión real
    if (!server) return;

    const panel = vscode.window.createWebviewPanel(
        'editServer',
        `Editar Servidor: ${server.name}`,
        vscode.ViewColumn.One,
        { enableScripts: true }
    );

    panel.webview.html = getWebviewContent(server);

    panel.webview.onDidReceiveMessage(async message => {
        if (message.command === 'save') {
            const index = servers.findIndex(s => s === server);
            if (index !== -1) {
                servers[index] = {
                    name: message.name,
                    host: message.host,
                    user: message.user,
                    password: message.password,
                    type: message.type
                };
                await context.globalState.update(serversKey, servers);
                treeDataProvider.refresh();
                vscode.window.showInformationMessage(`✅ Servidor "${message.name}" actualizado`);
            }
            panel.dispose();
        }
    }, undefined, context.subscriptions);
});
context.subscriptions.push(editServerCmd);



}

// -------------------------------
// 4️⃣ Clase TreeDataProvider para la barra lateral
// -------------------------------
class ServerTreeProvider implements vscode.TreeDataProvider<ServerItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ServerItem | undefined | void> = new vscode.EventEmitter<ServerItem | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<ServerItem | undefined | void> = this._onDidChangeTreeData.event;

    constructor(private servers: ServerConfig[]) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ServerItem): vscode.TreeItem {
        return element;
    }

    getChildren(): Thenable<ServerItem[]> {
        return Promise.resolve(this.servers.map(s => new ServerItem(s)));
    }
}

// -------------------------------
// TreeView Item para cada servidor
// -------------------------------
class ServerItem extends vscode.TreeItem {
    constructor(public readonly server: ServerConfig) {
        super(server.name, vscode.TreeItemCollapsibleState.None);
        this.description = `${server.host} (${server.type})`;
        this.contextValue = 'serverItem'; // <- esto es obligatorio
        this.command = {
            command: 'conectacode.connectServer',
            title: 'Conectar',
            arguments: [server]
        };
        this.iconPath = new vscode.ThemeIcon(server.type === 'FTP' ? 'cloud' : 'terminal');
    }
}




function getWebviewContent(server: ServerConfig): string {
    // Garantizar que todos los valores sean strings
    const name = server.name ?? '';
    const host = server.host ?? '';
    const user = server.user ?? '';
    const password = server.password ?? '';
    const type = server.type ?? 'FTP';

    return `
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Editar Servidor</title>
</head>
<body>
<h2>Editar Servidor: ${escapeHtml(name)}</h2>
<form id="editForm">
    <label>Nombre:</label><br>
    <input type="text" id="name" value="${escapeHtml(name)}"><br><br>

    <label>Host:</label><br>
    <input type="text" id="host" value="${escapeHtml(host)}"><br><br>

    <label>Usuario:</label><br>
    <input type="text" id="user" value="${escapeHtml(user)}"><br><br>

    <label>Contraseña:</label><br>
    <input type="password" id="password" value="${escapeHtml(password)}"><br><br>

    <label>Tipo de conexión:</label><br>
    <select id="type">
        <option value="FTP" ${type === 'FTP' ? 'selected' : ''}>FTP</option>
        <option value="SFTP" ${type === 'SFTP' ? 'selected' : ''}>SFTP</option>
        <option value="SSH" ${type === 'SSH' ? 'selected' : ''}>SSH</option>
    </select><br><br>

    <button type="submit">Guardar</button>
</form>

<script>
const vscode = acquireVsCodeApi();

document.getElementById('editForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('name').value;
    const host = document.getElementById('host').value;
    const user = document.getElementById('user').value;
    const password = document.getElementById('password').value;
    const type = document.getElementById('type').value;

    vscode.postMessage({
        command: 'save',
        name,
        host,
        user,
        password,
        type
    });
});
</script>
</body>
</html>
`;
}



export function deactivate() {}
function escapeHtml(unsafe: string): string {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


