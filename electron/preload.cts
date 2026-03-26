const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  hideWindow: () => ipcRenderer.send('hide-window'),
  getMyId: () => ipcRenderer.invoke('get-my-id'),
  getFriends: () => ipcRenderer.invoke('get-friends'),
  addFriend: (id: string, name: string) => ipcRenderer.invoke('add-friend', { id, name }),
  removeFriend: (id: string) => ipcRenderer.invoke('remove-friend', id),
  getConfig: () => ipcRenderer.invoke('get-config'),
  setAutoLaunch: (enable: boolean) => ipcRenderer.invoke('set-auto-launch', enable),
  selectDownloadDir: () => ipcRenderer.invoke('select-download-dir'),
  selectAndSendFile: (friendId: string) => ipcRenderer.invoke('send-file', friendId),
  onTransferProgress: (callback: (data: any) => void) => {
    ipcRenderer.on('transfer-progress', (_event: any, data: any) => callback(data));
  },
  onSwitchTab: (callback: (tab: string) => void) => {
    ipcRenderer.on('switch-tab', (_event: any, tab: string) => callback(tab));
  },
  // Chat
  getMessages: (friendId: string) => ipcRenderer.invoke('get-messages', friendId),
  sendMessage: (friendId: string, text: string) => ipcRenderer.invoke('send-message', { friendId, text }),
  onNewMessage: (callback: (data: any) => void) => {
    ipcRenderer.on('new-message', (_event: any, data: any) => callback(data));
  },
  onOpenChat: (callback: (friendId: string) => void) => {
    ipcRenderer.on('open-chat', (_event: any, friendId: string) => callback(friendId));
  },
  // File offer (replaces blocking dialog)
  onShowFileOffer: (callback: (offer: any) => void) => {
    ipcRenderer.on('show-file-offer', (_event: any, offer: any) => callback(offer));
  },
  respondToFileOffer: (offerId: string, accepted: boolean) =>
    ipcRenderer.send(`file-offer-response-${offerId}`, accepted),
  // Presence
  onFriendStatus: (callback: (data: { friendId: string, online: boolean }) => void) => {
    ipcRenderer.on('friend-status', (_event: any, data: any) => callback(data));
  },
});
