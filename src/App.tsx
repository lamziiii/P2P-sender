import { useState, useEffect, useRef } from 'react';

function App() {
  const [activeTab, setActiveTab] = useState('friends');
  const [friends, setFriends] = useState<any[]>([]);
  const [myId, setMyId] = useState('Chargement...');
  const [newFriendId, setNewFriendId] = useState('');
  const [newFriendName, setNewFriendName] = useState('');
  const [transfers, setTransfers] = useState<any[]>([]);
  const [config, setConfig] = useState<any>({});
  const [chatFriend, setChatFriend] = useState<any>(null);
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [fileOffers, setFileOffers] = useState<any[]>([]);
  const [rateLimitWarning, setRateLimitWarning] = useState(false);
  const [theme, setTheme] = useState<'light'|'dark'>(
    () => (localStorage.getItem('theme') as 'light'|'dark') ?? 'light'
  );
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Apply theme to root element whenever it changes
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme === 'dark' ? 'dark' : '');
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api) return;

    api.getMyId().then(setMyId);
    api.getFriends().then(setFriends);
    api.getConfig().then(setConfig);

    api.onTransferProgress((data: any) => {
      setTransfers(prev => {
        const idx = prev.findIndex(t => t.fileName === data.fileName && t.friendId === data.friendId);
        if (idx !== -1) {
          const next = [...prev];
          next[idx] = { ...next[idx], ...data };
          return next;
        }
        return [...prev, data];
      });
    });

    if (api.onSwitchTab) api.onSwitchTab((tab: string) => setActiveTab(tab));

    if (api.onNewMessage) {
      api.onNewMessage((data: any) => {
        setChatMessages(prev => {
          if ((window as any).__chatFriendId === data.friendId) return [...prev, data.message];
          return prev;
        });
      });
    }

    if (api.onOpenChat) {
      api.onOpenChat(async (friendId: string) => {
        const fs = await api.getFriends();
        const f = fs.find((x: any) => x.id === friendId);
        if (f) openChatWith(f);
      });
    }

    if (api.onShowFileOffer) {
      api.onShowFileOffer((offer: any) => {
        setFileOffers(prev => prev.find(o => o.offerId === offer.offerId) ? prev : [...prev, offer]);
      });
    }

    if (api.onFriendStatus) {
      api.onFriendStatus(({ friendId, online }: { friendId: string, online: boolean }) => {
        setFriends(prev => prev.map(f => f.id === friendId ? { ...f, online } : f));
      });
    }
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const openChatWith = async (friend: any) => {
    const api = (window as any).electronAPI;
    setChatFriend(friend);
    (window as any).__chatFriendId = friend.id;
    const msgs = await api.getMessages(friend.id);
    setChatMessages(msgs);
    setActiveTab('chat');
  };

  const sendChatMessage = async () => {
    if (!chatInput.trim() || !chatFriend) return;
    const api = (window as any).electronAPI;
    const entry = await api.sendMessage(chatFriend.id, chatInput.trim());
    if (entry?.error === 'rate_limited') {
      setRateLimitWarning(true);
      setTimeout(() => setRateLimitWarning(false), 3000);
      return;
    }
    setChatMessages(prev => [...prev, entry]);
    setChatInput('');
  };

  const respondToOffer = (offerId: string, accepted: boolean) => {
    (window as any).electronAPI?.respondToFileOffer(offerId, accepted);
    setFileOffers(prev => prev.filter(o => o.offerId !== offerId));
  };

  const addFriend = async () => {
    if (!newFriendId.trim() || !newFriendName.trim()) return;
    const api = (window as any).electronAPI;
    const updated = await api.addFriend(newFriendId, newFriendName);
    setFriends(updated);
    setNewFriendId('');
    setNewFriendName('');
  };

  const removeFriend = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = await (window as any).electronAPI?.removeFriend(id);
    setFriends(updated);
  };

  const sendFile = async (friendId: string) => {
    setActiveTab('transfers');
    await (window as any).electronAPI?.selectAndSendFile(friendId);
  };

  const transferColor = (status: string) => {
    if (status === 'completed') return 'var(--success)';
    if (status === 'declined') return 'var(--danger)';
    if (status === 'connecting' || status === 'waiting_consent') return 'var(--text-secondary)';
    return 'var(--accent)';
  };

  const transferLabel = (t: any) => {
    if (t.status === 'completed') return '✓ Terminé';
    if (t.status === 'declined') return '✕ Refusé';
    if (t.status === 'connecting') return 'Connexion P2P…';
    if (t.status === 'waiting_consent') return 'En attente…';
    return `${t.progress}%`;
  };

  const formatSpeed = (bps: number) => {
    if (!bps || bps <= 0) return '';
    if (bps >= 1024 * 1024) return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
    if (bps >= 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
    return `${bps} B/s`;
  };

  /* ─── Chat View ─── */
  if (activeTab === 'chat' && chatFriend) {
    return (
      <div className="app" style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="chat-header">
          <button className="icon-btn" onClick={() => setActiveTab('friends')}>←</button>
          <div className="avatar" style={{ width: 28, height: 28, fontSize: 12 }}>{chatFriend.name[0].toUpperCase()}</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{chatFriend.name}</div>
            <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>Message P2P chiffré</div>
          </div>
          <button className="icon-btn close" style={{ marginLeft: 'auto' }} onClick={() => (window as any).electronAPI?.hideWindow()}>✕</button>
        </div>

        <div className="chat-messages">
          {chatMessages.length === 0 && (
            <div className="empty-state">
              <span className="emoji">💬</span>
              Aucun message. Dites bonjour !
            </div>
          )}
          {chatMessages.map((m: any) => {
            const mine = m.from === myId;
            return (
              <div key={m.id} className={`bubble-row ${mine ? 'mine' : ''}`}>
                <div className={`bubble ${mine ? 'mine' : 'theirs'}`}>
                  {m.text}
                  <div className="bubble-time">{new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        <div className="chat-input-row">
          {rateLimitWarning && (
            <div style={{ position: 'absolute', bottom: 58, left: 12, right: 12, background: 'rgba(255,90,90,0.15)', border: '1px solid var(--danger)', borderRadius: 7, padding: '6px 10px', fontSize: 12, color: 'var(--danger)', textAlign: 'center' }}>
              ⚡ Trop vite ! Attendez quelques secondes.
            </div>
          )}
          <input
            className="input"
            placeholder="Écrire un message…"
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendChatMessage()}
            style={{ flex: 1 }}
          />
          <button className="btn" onClick={sendChatMessage} style={{ padding: '8px 13px' }}>➤</button>
        </div>
      </div>
    );
  }

  /* ─── Main View ─── */
  return (
    <div className="app">
      {/* Header */}
      <div className="header">
        <div className="logo">
          <div className="logo-icon">🔗</div>
          <span className="logo-text">P2P Share</span>
          <div className="online-dot" />
        </div>
        <div className="header-actions">
          <button className={`icon-btn ${activeTab === 'settings' ? 'active' : ''}`} title="Paramètres" onClick={() => setActiveTab('settings')}>⚙</button>
          <button className="icon-btn close" title="Réduire" onClick={() => (window as any).electronAPI?.hideWindow()}>✕</button>
        </div>
      </div>

      {/* Nav */}
      {activeTab !== 'settings' && (
        <div className="nav">
          <button className={`nav-btn ${activeTab === 'friends' ? 'active' : ''}`} onClick={() => setActiveTab('friends')}>
            👥 Amis
          </button>
          <button className={`nav-btn ${activeTab === 'transfers' ? 'active' : ''}`} onClick={() => setActiveTab('transfers')}>
            📦 Transferts{transfers.length > 0 && ` (${transfers.length})`}
          </button>
        </div>
      )}

      <div className="content">

        {/* ── File Offer Banners ── */}
        {fileOffers.map(offer => (
          <div key={offer.offerId} className="offer-banner">
            <div className="offer-title">📁 Fichier entrant</div>
            <div className="offer-desc">
              <strong style={{ color: 'var(--text)' }}>{offer.senderName}</strong> vous envoie{' '}
              <strong style={{ color: 'var(--text)' }}>"{offer.fileName}"</strong>{' '}
              ({(offer.fileSize / (1024 * 1024)).toFixed(2)} Mo)
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-success" style={{ flex: 1 }} onClick={() => respondToOffer(offer.offerId, true)}>✓ Accepter</button>
              <button className="btn btn-danger" style={{ flex: 1 }} onClick={() => respondToOffer(offer.offerId, false)}>✕ Refuser</button>
            </div>
          </div>
        ))}

        {/* ── Friends Tab ── */}
        {activeTab === 'friends' && (
          <>
            {/* My ID */}
            <div className="id-box">
              <div style={{ minWidth: 0 }}>
                <div className="id-label">Mon ID</div>
                <div className="id-value">{myId}</div>
              </div>
              <button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={() => navigator.clipboard.writeText(myId)}>Copier</button>
            </div>

            {/* Friend List */}
            {friends.length > 0 && <div className="section-header">Amis ({friends.length})</div>}
            {friends.map(f => (
              <div key={f.id} className="friend-item">
                <div className="friend-left">
                  <div className="avatar">{f.name[0].toUpperCase()}</div>
                  <div>
                    <div className="friend-name">{f.name}</div>
                    <div className={`friend-status ${f.online ? 'online' : ''}`}>
                      {f.online ? '● En ligne' : '○ Hors ligne'}
                    </div>
                  </div>
                </div>
                <div className="friend-actions">
                  <button className="btn btn-ghost" title="Chat" onClick={() => openChatWith(f)} style={{ padding: '5px 8px' }}>💬</button>
                  <button className="btn btn-ghost" title="Envoyer un fichier" onClick={() => sendFile(f.id)} style={{ padding: '5px 8px' }}>📁</button>
                  <button className="btn btn-danger" title="Supprimer" onClick={(e) => removeFriend(f.id, e)} style={{ padding: '5px 8px' }}>✕</button>
                </div>
              </div>
            ))}
            {friends.length === 0 && (
              <div className="empty-state">
                <span className="emoji">👤</span>
                Aucun ami. Ajoutez quelqu'un ci-dessous.
              </div>
            )}

            {/* Add Friend */}
            <div className="divider" />
            <div className="section-header">Ajouter un ami</div>
            <input className="input" placeholder="ID de l'ami (ex: a1b2c3d4…)" value={newFriendId} onChange={e => setNewFriendId(e.target.value)} />
            <input className="input" placeholder="Pseudo (ex: Alice)" value={newFriendName} onChange={e => setNewFriendName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addFriend()} />
            <button className="btn" style={{ width: '100%' }} onClick={addFriend}>+ Ajouter cet ami</button>
          </>
        )}

        {/* ── Transfers Tab ── */}
        {activeTab === 'transfers' && (
          <>
            {transfers.length === 0 && (
              <div className="empty-state">
                <span className="emoji">📦</span>
                Aucun transfert en cours.
              </div>
            )}
            {transfers.map((t, idx) => (
              <div key={idx} className="transfer-item">
                <div className="transfer-header">
                  <span className="transfer-name">{t.fileName}</span>
                  <span className="transfer-status" style={{ color: transferColor(t.status) }}>
                    {transferLabel(t)}
                  </span>
                </div>
                <div className="progress-track">
                  <div
                    className="progress-fill"
                    style={{
                      width: `${t.status === 'declined' ? 100 : t.progress ?? 0}%`,
                      background: t.status === 'completed' ? 'var(--success)' : t.status === 'declined' ? 'var(--danger)' : 'linear-gradient(90deg, var(--accent), #b47aff)'
                    }}
                  />
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 6, display: 'flex', justifyContent: 'space-between' }}>
                  <span>
                    {t.status === 'sending' ? '⬆ Envoi' : t.status === 'receiving' ? '⬇ Réception' : ''}
                    {t.friendId && friends.find((f: any) => f.id === t.friendId)?.name ? ` · ${friends.find((f: any) => f.id === t.friendId).name}` : ''}
                  </span>
                  {(t.status === 'receiving' || t.status === 'sending') && t.speed > 0 && (
                    <span style={{ color: 'var(--success)', fontWeight: 600 }}>{formatSpeed(t.speed)}</span>
                  )}
                </div>
              </div>
            ))}
          </>
        )}

        {/* ── Settings Tab ── */}
        {activeTab === 'settings' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <button className="icon-btn" onClick={() => setActiveTab('friends')}>←</button>
              <span style={{ fontWeight: 700, fontSize: 14 }}>Paramètres</span>
            </div>

            <div className="card">
              <div className="card-label">Dossier de téléchargement</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div className="path-box" title={config.downloadPath}>{config.downloadPath || 'Dossier système'}</div>
                <button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={async () => {
                  const api = (window as any).electronAPI;
                  const p = await api?.selectDownloadDir();
                  if (p) setConfig({ ...config, downloadPath: p });
                }}>Changer</button>
              </div>
            </div>

            <div className="card">
              <div className="setting-row">
                <div>
                  <div className="setting-label">Lancement au démarrage</div>
                  <div className="setting-sub">Démarrer automatiquement avec Windows</div>
                </div>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={config.autoLaunch ?? true}
                    onChange={async (e) => {
                      const api = (window as any).electronAPI;
                      const val = await api?.setAutoLaunch(e.target.checked);
                      setConfig({ ...config, autoLaunch: val });
                    }}
                  />
                  <span className="toggle-track" />
                </label>
              </div>
            </div>

            <div className="card">
              <div className="setting-row">
                <div>
                  <div className="setting-label">Mode sombre</div>
                  <div className="setting-sub">Thème foncé / thème clair</div>
                </div>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={theme === 'dark'}
                    onChange={e => setTheme(e.target.checked ? 'dark' : 'light')}
                  />
                  <span className="toggle-track" />
                </label>
              </div>
            </div>

            <div className="card" style={{ opacity: 0.6 }}>
              <div className="card-label">Mon identifiant P2P</div>
              <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--accent)', wordBreak: 'break-all', lineHeight: 1.5 }}>{myId}</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default App;
