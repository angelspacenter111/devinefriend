import io from 'socket.io-client';
import { getSocketUrl } from '../config/api';

class SocketService {
  socket = null;
  isConnected = false;
  currentUrl = null;
  listeners = new Map(); // event -> Set of callbacks

  connect() {
    const targetUrl = getSocketUrl();

    // If socket exists for this URL, reuse and ensure it is connected
    if (this.socket && this.currentUrl === targetUrl) {
      if (!this.socket.connected) {
        this.socket.connect();
      }
      return this.socket;
    }

    // URL changed or initial connect
    if (this.socket) {
      try {
        this.socket.disconnect();
      } catch (e) {}
      this.socket = null;
    }

    this.currentUrl = targetUrl;
    console.log(`[SocketService] Connecting to: ${targetUrl}`);

    this.socket = io(targetUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      autoConnect: true
    });

    this.socket.on('connect', () => {
      this.isConnected = true;
      console.log(`[SocketService] Connected successfully. Socket ID: ${this.socket.id}`);
    });

    this.socket.on('disconnect', (reason) => {
      this.isConnected = false;
      console.log(`[SocketService] Disconnected: ${reason}`);
    });

    this.socket.on('connect_error', (error) => {
      console.warn(`[SocketService] Connection attempt error: ${error.message} (${targetUrl})`);
    });

    // Re-bind all persistent listeners to the active socket instance
    for (const [event, callbackSet] of this.listeners.entries()) {
      for (const cb of callbackSet) {
        this.socket.on(event, cb);
      }
    }

    return this.socket;
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);

    if (this.socket) {
      this.socket.on(event, callback);
    } else {
      this.connect();
    }
  }

  off(event, callback) {
    if (this.listeners.has(event)) {
      if (callback) {
        this.listeners.get(event).delete(callback);
      } else {
        this.listeners.delete(event);
      }
    }

    if (this.socket) {
      if (callback) {
        this.socket.off(event, callback);
      } else {
        this.socket.off(event);
      }
    }
  }

  emit(event, data) {
    if (!this.socket) {
      this.connect();
    }

    if (this.socket && this.socket.connected) {
      this.socket.emit(event, data);
    } else if (this.socket) {
      // If still connecting, queue emit on immediate connect
      this.socket.once('connect', () => {
        this.socket.emit(event, data);
      });
    }
  }

  joinCallRoom(data) {
    this.emit('join-call-room', data);
  }

  hangup(data) {
    this.emit('hangup', data);
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.isConnected = false;
    }
  }
}

export const socketService = new SocketService();
export default socketService;
