import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('electronAPI', {
    getMyId: () => ipcRenderer.invoke('get-my-id'),
    getFriends: () => ipcRenderer.invoke('get-friends'),
    addFriend: (id, name) => ipcRenderer.invoke('add-friend', { id, name }),
    removeFriend: (id) => ipcRenderer.invoke('remove-friend', id),
    selectAndSendFile: (friendId) => ipcRenderer.invoke('send-file', friendId),
    onTransferProgress: (callback) => {
        ipcRenderer.on('transfer-progress', (_event, data) => callback(data));
    }
});
