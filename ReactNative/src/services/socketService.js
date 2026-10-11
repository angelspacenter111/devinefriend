import io from 'socket.io-client';
import { getSocketUrl } from '../config/api';

class SocketService {
  socket = null;
  isConnected = false;
  currentUrl = null;

  connect() {
    const targetUrl = getSocketUrl();

    // If already connected to the same URL, reuse
    if (this.socket && this.socket.connected && this.currentUrl === targetUrl) {
      return this.socket;
    }

    // If socket exists but URL changed or disconnected, cleanup old
    if (this.socket) {
      try {
        this.socket.disconnect();
      } catch (e) {}
      this.socket = null;
    }

    this.currentUrl = targetUrl;
    console.log(`[Socket] Connecting to: ${targetUrl}`);

    this.socket = io(targetUrl, {
      transports: ['polling', 'websocket'], // Polling first guarantees connection through mobile firewalls, then auto upgrades to websocket
      reconnection: true,
      reconnectionAttempts: 15,
      reconnectionDelay: 2000,
      timeout: 15000,
      autoConnect: true
    });

    this.socket.on('connect', () => {
      this.isConnected = true;
      console.log(`[Socket] Connected successfully: ${this.socket.id}`);
    });

    this.socket.on('disconnect', (reason) => {
      this.isConnected = false;
      console.log(`[Socket] Disconnected: ${reason}`);
    });

    this.socket.on('connect_error', (error) => {
      console.warn(`[Socket Warning] Connection attempt failed: ${error.message} (${targetUrl})`);
    });

    return this.socket;
  }

  joinCallRoom(data) {
    if (!this.socket) this.connect();
    this.socket.emit('join-call-room', data);
  }

  hangup(data) {
    if (this.socket) {
      this.socket.emit('hangup', data);
    }
  }

  on(event, callback) {
    if (!this.socket) this.connect();
    this.socket.on(event, callback);
  }

  off(event, callback) {
    if (this.socket) {
      this.socket.off(event, callback);
    }
  }

  emit(event, data) {
    if (!this.socket) this.connect();
    this.socket.emit(event, data);
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.isConnected = false;
    }
  }
}

const socketService = new SocketService();
export default socketService;
