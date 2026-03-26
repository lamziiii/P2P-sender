"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('electronAPI', {
    hideWindow: () => ipcRenderer.send('hide-window'),
    getMyId: () => ipcRenderer.invoke('get-my-id'),
    getFriends: () => ipcRenderer.invoke('get-friends'),
    addFriend: (id, name) => ipcRenderer.invoke('add-friend', { id, name }),
    removeFriend: (id) => ipcRenderer.invoke('remove-friend', id),
    getConfig: () => ipcRenderer.invoke('get-config'),
    setAutoLaunch: (enable) => ipcRenderer.invoke('set-auto-launch', enable),
    selectDownloadDir: () => ipcRenderer.invoke('select-download-dir'),
    selectAndSendFile: (friendId) => ipcRenderer.invoke('send-file', friendId),
    onTransferProgress: (callback) => {
        ipcRenderer.on('transfer-progress', (_event, data) => callback(data));
    },
    onSwitchTab: (callback) => {
        ipcRenderer.on('switch-tab', (_event, tab) => callback(tab));
    },
    // Chat
    getMessages: (friendId) => ipcRenderer.invoke('get-messages', friendId),
    sendMessage: (friendId, text) => ipcRenderer.invoke('send-message', { friendId, text }),
    onNewMessage: (callback) => {
        ipcRenderer.on('new-message', (_event, data) => callback(data));
    },
    onOpenChat: (callback) => {
        ipcRenderer.on('open-chat', (_event, friendId) => callback(friendId));
    },
    // File offer (replaces blocking dialog)
    onShowFileOffer: (callback) => {
        ipcRenderer.on('show-file-offer', (_event, offer) => callback(offer));
    },
    respondToFileOffer: (offerId, accepted) => ipcRenderer.send(`file-offer-response-${offerId}`, accepted),
    // Presence
    onFriendStatus: (callback) => {
        ipcRenderer.on('friend-status', (_event, data) => callback(data));
    },
});
