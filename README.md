# 🔗 P2P Share - Cross-platform Peer-to-Peer File Transfer & Chat

P2P Share is a modern, privacy-focused desktop application built with **Electron**, **React**, and **TypeScript**. It enables direct peer-to-peer file sharing and chat without intermediate servers, using **Hyperswarm** for discovery and **PeerJS** for secure WebRTC data channels.

![P2P Share UI](public/icon.png)

## ✨ Features

- 💬 **Private P2P Chat**: End-to-end encrypted real-time messaging.
- 📁 **Direct File Transfer**: Send any file size directly to your friends with high speed.
- 👥 **Friend System**: Add friends using their unique P2P IDs and see their online status.
- 📊 **Real-time Monitoring**: Track transfer progress, speed (MB/s), and connection status.
- 🌓 **Theming**: Beautiful glassmorphism UI with native Light and Dark mode support.
- ⚙️ **Automatic Startup**: Option to launch automatically with Windows.
- 🛡️ **Privacy First**: No central server stores your messages or files.

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher)
- [npm](https://www.npmjs.com/) or [yarn](https://yarnpkg.com/)

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/lamziiii/P2P-sender.git
   cd P2P-sender
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the development server:**
   ```bash
   npm run dev
   ```

### Building for Production

To create a distributed executable for your platform (Windows, macOS, or Linux):

```bash
npm run dist
```
The output will be located in the `release/` directory.

## 🛠️ Built With

- **Frontend**: [React 19](https://react.dev/), [Vite](https://vitejs.dev/)
- **Desktop**: [Electron](https://www.electronjs.org/)
- **P2P Networking**: [Hyperswarm](https://github.com/holepunchto/hyperswarm), [PeerJS](https://peerjs.com/)
- **Style**: Vanilla CSS with Glassmorphism
- **Languages**: TypeScript, HTML, CSS

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

Built with ❤️ by [lamziiii](https://github.com/lamziiii)
