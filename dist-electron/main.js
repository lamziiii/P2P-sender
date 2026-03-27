import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog, Notification } from 'electron';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import Hyperswarm from 'hyperswarm';
let window = null;
let tray = null;
let isQuitting = false;
// Single Instance Lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
}
else {
    app.on('second-instance', () => {
        if (window) {
            if (window.isMinimized())
                window.restore();
            if (!window.isVisible())
                window.show();
            window.focus();
        }
    });
}
// Storage Setup
const userDataPath = app.getPath('userData');
const friendsFile = path.join(userDataPath, 'friends.json');
const idFile = path.join(userDataPath, 'my_id.txt');
const configFile = path.join(userDataPath, 'config.json');
const messagesFile = path.join(userDataPath, 'messages.json');
// Configuration
let config = { downloadPath: '', autoLaunch: true };
try {
    config.downloadPath = app.getPath('downloads');
}
catch (e) { }
if (fs.existsSync(configFile)) {
    try {
        const c = JSON.parse(fs.readFileSync(configFile, 'utf8'));
        if (c.downloadPath)
            config.downloadPath = c.downloadPath;
        if (c.autoLaunch !== undefined)
            config.autoLaunch = c.autoLaunch;
    }
    catch (e) { }
}
else {
    // Save defaults on first boot
    fs.writeFileSync(configFile, JSON.stringify(config));
}
const saveConfig = () => fs.writeFileSync(configFile, JSON.stringify(config));
// Generate ID
let myId = '';
if (fs.existsSync(idFile)) {
    myId = fs.readFileSync(idFile, 'utf8');
}
else {
    myId = crypto.randomBytes(16).toString('hex');
    fs.writeFileSync(idFile, myId);
}
// Ensure friends persist
let friends = [];
if (fs.existsSync(friendsFile)) {
    try {
        friends = JSON.parse(fs.readFileSync(friendsFile, 'utf8'));
        // Heal corrupted local database containing ancient whitespace bugs
        friends = friends.map(f => ({ ...f, id: f.id?.trim() || '', name: f.name?.trim() || '' }));
        fs.writeFileSync(friendsFile, JSON.stringify(friends));
    }
    catch (e) { }
}
const saveFriends = () => {
    fs.writeFileSync(friendsFile, JSON.stringify(friends));
};
// Messages persistence
let messages = {};
if (fs.existsSync(messagesFile)) {
    try {
        messages = JSON.parse(fs.readFileSync(messagesFile, 'utf8'));
    }
    catch (e) { }
}
const saveMessages = () => fs.writeFileSync(messagesFile, JSON.stringify(messages));
// --- Chat Swarm ---
// topic = sorted(myId, friendId) so both peers join the same rendezvous point
const getChatTopic = (a, b) => crypto.createHash('sha256').update([a, b].sort().join(':')).digest();
const chatSwarm = new Hyperswarm();
const joinedChatTopics = new Set();
const joinChatWithFriend = (friendId) => {
    const key = [myId, friendId].sort().join(':');
    if (joinedChatTopics.has(key))
        return;
    joinedChatTopics.add(key);
    chatSwarm.join(getChatTopic(myId, friendId), { server: true, client: true });
};
// Join topics for already-known friends
for (const f of friends)
    joinChatWithFriend(f.id);
// Presence tracking
const onlineFriends = new Set();
const setFriendOnline = (friendId, online) => {
    const before = onlineFriends.has(friendId);
    if (online)
        onlineFriends.add(friendId);
    else
        onlineFriends.delete(friendId);
    if (before !== online) {
        window?.webContents.send('friend-status', { friendId, online });
    }
};
chatSwarm.on('connection', (socket) => {
    socket.on('error', () => { });
    let peerId = null;
    let buf = '';
    // Immediately announce ourselves so the other side knows who we are
    socket.write(JSON.stringify({ type: 'ping', from: myId }) + '\n');
    socket.on('data', (chunk) => {
        buf += chunk.toString();
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
            if (!line.trim())
                continue;
            try {
                const msg = JSON.parse(line);
                if (msg.type === 'ping' && msg.from) {
                    // Identify who this is and reply
                    const friend = friends.find(f => f.id === msg.from);
                    if (!friend)
                        continue;
                    peerId = msg.from;
                    setFriendOnline(msg.from, true);
                    // Reply with our own pong so they can also mark us online
                    socket.write(JSON.stringify({ type: 'pong', from: myId }) + '\n');
                }
                else if (msg.type === 'pong' && msg.from) {
                    const friend = friends.find(f => f.id === msg.from);
                    if (!friend)
                        continue;
                    peerId = msg.from;
                    setFriendOnline(msg.from, true);
                }
                else if (msg.type === 'chat' && msg.from && msg.text) {
                    const friend = friends.find(f => f.id === msg.from);
                    if (!friend)
                        continue;
                    // Drop message silently if sender is flooding
                    if (isRateLimited(msg.from))
                        continue;
                    if (!messages[msg.from])
                        messages[msg.from] = [];
                    const entry = { id: crypto.randomUUID(), from: msg.from, text: msg.text, ts: Date.now() };
                    messages[msg.from].push(entry);
                    saveMessages();
                    window?.webContents.send('new-message', { friendId: msg.from, message: entry });
                    if (Notification.isSupported()) {
                        const notif = new Notification({ title: `💬 ${friend.name}`, body: msg.text });
                        notif.on('click', () => {
                            if (window) {
                                if (!window.isVisible())
                                    window.show();
                                window.focus();
                                window.webContents.send('open-chat', msg.from);
                            }
                        });
                        notif.show();
                    }
                }
            }
            catch (e) { }
        }
    });
    socket.on('close', () => {
        if (peerId)
            setFriendOnline(peerId, false);
    });
});
// Chat IPC
ipcMain.handle('get-messages', (_e, friendId) => messages[friendId] ?? []);
// Rate limiting — 5 messages per 5 seconds per peer (both in and out)
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 5000;
const rateBuckets = new Map();
const isRateLimited = (key) => {
    const now = Date.now();
    const bucket = (rateBuckets.get(key) ?? []).filter(t => now - t < RATE_WINDOW_MS);
    if (bucket.length >= RATE_LIMIT)
        return true;
    bucket.push(now);
    rateBuckets.set(key, bucket);
    return false;
};
ipcMain.handle('send-message', (_e, { friendId, text }) => {
    // Guard outbound messages
    if (isRateLimited(`out:${friendId}`))
        return { error: 'rate_limited' };
    joinChatWithFriend(friendId);
    const entry = { id: crypto.randomUUID(), from: myId, text, ts: Date.now() };
    if (!messages[friendId])
        messages[friendId] = [];
    messages[friendId].push(entry);
    saveMessages();
    const payload = JSON.stringify({ type: 'chat', from: myId, text }) + '\n';
    for (const conn of chatSwarm.connections) {
        try {
            conn.write(payload);
        }
        catch (e) { }
    }
    return entry;
});
ipcMain.on('hide-window', () => window?.hide());
ipcMain.handle('get-my-id', () => myId);
ipcMain.handle('get-friends', () => friends);
ipcMain.handle('add-friend', (_e, { id, name }) => {
    id = id.trim();
    name = name.trim();
    // Prevent adding yourself as a friend (avoids self-sending loops)
    if (id === myId)
        return friends;
    if (!friends.find(f => f.id === id)) {
        friends.push({ id, name, online: false });
        saveFriends();
        joinChatWithFriend(id);
    }
    return friends;
});
ipcMain.handle('remove-friend', (_e, id) => {
    friends = friends.filter(f => f.id !== id);
    saveFriends();
    return friends;
});
ipcMain.handle('get-config', () => config);
ipcMain.handle('select-download-dir', async () => {
    if (!window)
        return null;
    const result = await dialog.showOpenDialog(window, {
        properties: ['openDirectory', 'createDirectory'],
        title: 'Choisir le dossier de téléchargement'
    });
    if (result.canceled || result.filePaths.length === 0)
        return null;
    config.downloadPath = result.filePaths[0];
    saveConfig();
    return config.downloadPath;
});
ipcMain.handle('set-auto-launch', (_e, enable) => {
    config.autoLaunch = enable;
    saveConfig();
    if (app.isPackaged) {
        app.setLoginItemSettings({
            openAtLogin: enable,
            openAsHidden: true
        });
    }
    return config.autoLaunch;
});
// --- Hyperswarm Incoming Server ---
const swarm = new Hyperswarm();
const myTopic = crypto.createHash('sha256').update(myId).digest();
swarm.join(myTopic, { server: true, client: false });
swarm.on('connection', (socket) => {
    socket.on('error', () => { });
    let isParsingHeader = true;
    let headerData = '';
    let writeStream = null;
    let expectedSize = 0;
    let receivedSize = 0;
    let currentFileName = '';
    let senderId = '';
    let speedLastTime = Date.now();
    let speedLastBytes = 0;
    socket.on('data', async (chunk) => {
        if (isParsingHeader) {
            const text = chunk.toString();
            const newlineIdx = text.indexOf('\n');
            if (newlineIdx !== -1) {
                headerData += text.slice(0, newlineIdx);
                try {
                    const header = JSON.parse(headerData);
                    if (header.type === 'file_offer') {
                        expectedSize = header.fileSize;
                        currentFileName = header.fileName;
                        senderId = header.from;
                        isParsingHeader = false;
                        if (window) {
                            // Security: Only accept files from users in our friend list
                            const friend = friends.find(f => f.id === senderId);
                            if (!friend) {
                                // Unknown sender - silently reject to prevent spam
                                socket.write(JSON.stringify({ type: 'offer_response', accept: false }) + '\n');
                                socket.end();
                                return;
                            }
                            const senderName = friend.name;
                            const offerId = crypto.randomUUID();
                            // --- System notification instead of blocking dialog ---
                            if (Notification.isSupported()) {
                                const notif = new Notification({
                                    title: `📁 ${senderName} vous envoie un fichier`,
                                    body: `"${currentFileName}" (${(expectedSize / (1024 * 1024)).toFixed(2)} Mo) — Cliquez pour accepter ou refuser.`,
                                });
                                notif.on('click', () => {
                                    if (window) {
                                        window.show();
                                        window.focus();
                                        window.webContents.send('show-file-offer', { offerId, senderName, senderId, fileName: currentFileName, fileSize: expectedSize });
                                    }
                                });
                                notif.show();
                            }
                            // Also show in-app offer card immediately if window is visible
                            window.webContents.send('show-file-offer', { offerId, senderName, senderId, fileName: currentFileName, fileSize: expectedSize });
                            // Wait for user response via IPC (resolves when user clicks Accept/Refuse in-app)
                            const accept = await new Promise((resolve) => {
                                ipcMain.once(`file-offer-response-${offerId}`, (_e, accepted) => resolve(accepted));
                                // Auto-refuse after 5 minutes if no response
                                setTimeout(() => resolve(false), 5 * 60 * 1000);
                            });
                            if (accept) {
                                socket.write(JSON.stringify({ type: 'offer_response', accept: true }) + '\n');
                                const savePath = path.join(config.downloadPath, currentFileName);
                                writeStream = fs.createWriteStream(savePath);
                                writeStream.on('error', () => { });
                                writeStream.on('finish', () => {
                                    if (Notification.isSupported()) {
                                        const notif = new Notification({
                                            title: `✅ Fichier reçu de ${senderName}`,
                                            body: `"${currentFileName}" a été téléchargé dans votre dossier.`,
                                        });
                                        notif.on('click', () => {
                                            if (window) {
                                                window.show();
                                                window.focus();
                                                window.webContents.send('switch-tab', 'transfers');
                                            }
                                        });
                                        notif.show();
                                    }
                                });
                                window.webContents.send('transfer-progress', { friendId: senderId, fileName: currentFileName, progress: 0, status: 'receiving', speed: 0 });
                                window.webContents.send('switch-tab', 'transfers');
                                const headerByteLength = Buffer.byteLength(text.slice(0, newlineIdx + 1), 'utf8');
                                const leftover = chunk.subarray(headerByteLength);
                                if (leftover.length > 0) {
                                    writeStream.write(leftover);
                                    receivedSize += leftover.length;
                                }
                            }
                            else {
                                socket.write(JSON.stringify({ type: 'offer_response', accept: false }) + '\n');
                                socket.end();
                            }
                        }
                    }
                }
                catch (err) { }
            }
            else {
                headerData += text;
            }
        }
        else if (writeStream) {
            writeStream.write(chunk);
            receivedSize += chunk.length;
            const now = Date.now();
            const elapsed = (now - speedLastTime) / 1000;
            let speed = 0;
            if (elapsed > 0.2) {
                speed = Math.round((receivedSize - speedLastBytes) / elapsed);
                speedLastTime = now;
                speedLastBytes = receivedSize;
            }
            const percent = Math.round((receivedSize / expectedSize) * 100);
            window?.webContents.send('transfer-progress', {
                friendId: senderId,
                fileName: currentFileName,
                progress: percent,
                speed,
                status: percent >= 100 ? 'completed' : 'receiving'
            });
            if (receivedSize >= expectedSize) {
                writeStream.end();
            }
        }
    });
});
ipcMain.handle('send-file', async (_e, friendId) => {
    if (!window)
        return false;
    const result = await dialog.showOpenDialog(window, {
        properties: ['openFile'],
        title: 'Sélectionner un fichier à envoyer'
    });
    if (result.canceled || result.filePaths.length === 0)
        return false;
    const filePath = result.filePaths[0];
    const fileName = path.basename(filePath);
    const fileSize = fs.statSync(filePath).size;
    // Discover friend topic and send
    const friendTopic = crypto.createHash('sha256').update(friendId).digest();
    const transferSwarm = new Hyperswarm();
    transferSwarm.join(friendTopic, { server: false, client: true });
    // Immediately inform UI that we are searching the DHT for the friend
    window?.webContents.send('switch-tab', 'transfers');
    window?.webContents.send('transfer-progress', {
        friendId,
        fileName,
        progress: 0,
        status: 'connecting'
    });
    let progress = 0;
    transferSwarm.on('connection', (socket) => {
        socket.on('error', () => { });
        // Connected to friend, wait for their consent popup to finish!
        window?.webContents.send('transfer-progress', {
            friendId,
            fileName,
            progress: 0,
            status: 'waiting_consent'
        });
        const header = JSON.stringify({ type: 'file_offer', from: myId, fileName, fileSize });
        socket.write(header + '\n');
        socket.once('data', (data) => {
            const responseText = data.toString().trim();
            let accept = false;
            try {
                const response = JSON.parse(responseText);
                if (response.type === 'offer_response' && response.accept) {
                    accept = true;
                }
            }
            catch (err) { }
            if (accept) {
                window?.webContents.send('switch-tab', 'transfers');
                // Use 1 MB chunks for maximum throughput (default is 64 KB)
                const readStream = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 });
                readStream.on('error', () => { });
                // Track progress without slowing down the stream
                let lastPercent = -1;
                readStream.on('data', (chunk) => {
                    progress += chunk.length;
                    const percent = Math.round((progress / fileSize) * 100);
                    // Only send IPC update every 1% to avoid flooding the renderer
                    if (percent !== lastPercent) {
                        lastPercent = percent;
                        window?.webContents.send('transfer-progress', {
                            friendId, fileName,
                            progress: percent,
                            status: percent >= 100 ? 'completed' : 'sending'
                        });
                    }
                });
                readStream.on('end', () => {
                    socket.end();
                });
                socket.on('close', () => transferSwarm.destroy());
                // pipe() handles backpressure automatically — fastest possible transfer
                readStream.pipe(socket, { end: false });
            }
            else {
                // Friend declined
                window?.webContents.send('transfer-progress', {
                    friendId,
                    fileName,
                    progress: 0,
                    status: 'declined'
                });
                socket.end();
                transferSwarm.destroy();
            }
        });
    });
    return true;
});
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Hide the dock icon on Mac since this is a tray app
// Hide the dock icon on Mac since this is a tray app
// Note: We will show it temporarily when the window is visible if needed, 
// but for now we follow the tray-first design.
if (process.platform === 'darwin') {
    // app.dock?.hide(); // Commented out to improve visibility on Mac
}
const createWindow = () => {
    const isDev = process.env.VITE_DEV_SERVER_URL !== undefined;
    const isMac = process.platform === 'darwin';
    const winIconFile = isMac ? 'icon.icns' : 'icon.png';
    const winIconPath = path.join(__dirname, isDev ? `../public/${winIconFile}` : `../dist/${winIconFile}`);
    window = new BrowserWindow({
        width: 380,
        height: 600,
        show: true, // Changed to true to fix "not seeing anything" issue
        frame: false,
        resizable: false,
        transparent: true,
        icon: winIconPath,
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'), // tsc builds to .cjs
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    window.on('close', (event) => {
        if (!isQuitting) {
            event.preventDefault();
            window?.hide();
        }
        return false;
    });
    if (process.env.VITE_DEV_SERVER_URL) {
        window.loadURL(process.env.VITE_DEV_SERVER_URL);
    }
    else {
        window.loadFile(path.join(__dirname, '../dist/index.html'));
    }
    // Handle focus loss
    // Commented out so the app doesn't close when clicking elsewhere
    /*
    window.on('blur', () => {
      if (!window?.webContents.isDevToolsOpened()) {
        window?.hide();
      }
    });
    */
};
const createTray = () => {
    const isDev = process.env.VITE_DEV_SERVER_URL !== undefined;
    const isMac = process.platform === 'darwin';
    // macOS: use .icns for best quality; Windows/Linux: use .png
    const iconFile = isMac ? 'icon.icns' : 'icon.png';
    const iconPath = path.join(__dirname, isDev ? `../public/${iconFile}` : `../dist/${iconFile}`);
    const icon = nativeImage.createFromPath(iconPath);
    // Set the dock icon on macOS (even though dock is hidden, it's used in alt-tab etc.)
    if (isMac && !icon.isEmpty()) {
        app.dock?.setIcon(icon);
    }
    // Resize icon for system tray to prevent rendering issues on certain OS
    const trayIcon = icon.resize({ width: 16, height: 16 });
    tray = new Tray(trayIcon);
    tray.setToolTip('P2P Share');
    tray.on('click', (_event, bounds) => {
        if (!window)
            return;
        if (window.isVisible()) {
            window.hide();
        }
        else {
            const { x, y, width, height } = bounds;
            const winBounds = window.getBounds();
            // Calculate position
            let winX = Math.round(x - (winBounds.width / 2) + (width / 2));
            let winY = Math.round(y - winBounds.height);
            if (process.platform === 'win32') {
                winY = Math.round(y - winBounds.height);
            }
            else if (process.platform === 'darwin') {
                winY = Math.round(y + height);
            }
            window.setPosition(winX, winY, false);
            window.show();
            window.focus();
        }
    });
    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Quit P2P Share', click: () => {
                isQuitting = true;
                app.quit();
            }
        }
    ]);
    tray.on('right-click', () => {
        tray?.popUpContextMenu(contextMenu);
    });
};
app.whenReady().then(() => {
    if (app.isPackaged) {
        app.setLoginItemSettings({
            openAtLogin: config.autoLaunch,
            openAsHidden: true
        });
    }
    createWindow();
    createTray();
});
app.on('activate', () => {
    if (window === null) {
        createWindow();
    }
    else {
        window.show();
    }
});
app.on('window-all-closed', () => {
    // Commented out to prevent app from quitting when windows are hidden
    /*
    if (process.platform !== 'darwin') {
      app.quit();
    }
    */
});
