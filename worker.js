const Stream = require('node-rtsp-stream');
const net = require('net');
const cameras = require('./cameras');

const WORKER_ID = process.env.WORKER_ID || 0;
const restartingCameras = new Set();

const cameraManagers = {};

// ==== BAGI KAMERA KE WORKER ====
const chunkSize = Math.ceil(cameras.length / 3);
const start = WORKER_ID * chunkSize;
const end = start + chunkSize;
const myCameras = cameras.slice(start, end);

console.log(`👷 Worker ${WORKER_ID} handle cameras:`, myCameras.map(c => c.name));

class StreamManager {
  constructor(config) {
    this.config = config;
    this.stream = null;
    this.retryCount = 0;
    this.timeoutCount = 0;
    this.isRunning = false;

    this.host = this.extractHost(config.streamUrl);
    this.port = this.extractPort(config.streamUrl);

    this.start();
  }

  extractHost(url) {
    const match = url.match(/@?([\d.]+):/);
    return match ? match[1] : '127.0.0.1';
  }

  extractPort(url) {
    const match = url.match(/:(\d+)\//);
    return match ? parseInt(match[1]) : 554;
  }

  start() {
    console.log(`[${this.config.name}] Starting...`);

    this.stream = new Stream({
      name: this.config.name,
      streamUrl: this.config.streamUrl,
      wsPort: this.config.wsPort,
      ffmpegOptions: this.config.ffmpegOptions
    });

    this.isRunning = true;
    this.retryCount = 0;
  }

  stop() {
    if (this.stream) {
      try { this.stream.stop(); } catch {}
    }
    this.isRunning = false;
  }

  restart() {
    if (restartingCameras.has(this.config.name)) return;

    restartingCameras.add(this.config.name);

    this.stop();

    const delay = Math.min(30000, 3000 * (this.retryCount + 1));

    setTimeout(() => {
      this.start();
      restartingCameras.delete(this.config.name);
    }, delay);
  }

  async getLatency(timeout = 3000) {
    return new Promise(resolve => {
      const start = Date.now();
      const socket = new net.Socket();

      socket.setTimeout(timeout);

      socket.once("connect", () => {
        const latency = Date.now() - start;
        socket.destroy();
        resolve({ alive: true, latency });
      });

      socket.once("timeout", () => {
        socket.destroy();
        resolve({ alive: false, latency: null });
      });

      socket.once("error", () => {
        resolve({ alive: false, latency: null });
      });

      socket.connect(this.port, this.host);
    });
  }

  async getStatus() {
    const ping = await this.getLatency();

    if (!ping.alive) {
      this.timeoutCount++;
      if (this.timeoutCount >= 3) {
        this.timeoutCount = 0;
        this.restart();
      }
    } else {
      this.timeoutCount = 0;
    }

    return {
      name: this.config.name,
      running: this.isRunning,
      latency: ping.latency,
      alive: ping.alive,
      retryCount: this.retryCount || 0,
      timeoutCount: this.timeoutCount || 0
    };
  }
}

// ==== INIT CAMERA DI WORKER ====
myCameras.forEach(config => {
  cameraManagers[config.name] = new StreamManager(config);
});

// ==== KIRIM STATUS KE MASTER ====
async function broadcastStatus() {
  const cams = Object.values(cameraManagers);
  const result = [];

  for (let cam of cams) {
    result.push(await cam.getStatus());
    await new Promise(r => setTimeout(r, 100));
  }

  if (process.send) {
    process.send({
      type: "status",
      data: result
    });
  }
}

setInterval(broadcastStatus, 10000);

/* ===============================
   TERIMA COMMAND DARI MASTER
================================= */

process.on("message", (msg) => {
  if (msg.type === "command") {

    const { action, name } = msg.data;

    if (!cameraManagers[name]) return;

    console.log(`Worker ${WORKER_ID} received command:`, action, name);

    if (action === "restart") {
      cameraManagers[name].restart();
    }

    if (action === "stop") {
      cameraManagers[name].stop();
    }

    if (action === "start") {
      cameraManagers[name].start();
    }
  }
});