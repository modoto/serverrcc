
const express = require('express');
const fs = require('node:fs');
const http = require("http");
const https = require('node:https');
const Stream = require('node-rtsp-stream');
const net = require('net');
const { Server } = require("socket.io");
// const Bwcam = require("./models/BwcamModel");
// const Mtcam = require("./models/MtCamModel");

const app = express();

const options = {
  key: fs.readFileSync('key.pem'),
  cert: fs.readFileSync('cert.pem'),
};

const server = http.createServer(app);
//const server = https.createServer(options, app);
const io = new Server(server, { cors: { origin: "*" } });
const restartingCameras = new Set();

app.use(express.static("public"));

io.on("connection", (socket) => {
  console.log("🔌 Client connected:", socket.id);

  // restart kamera tertentu
  socket.on("restart_camera", ({ name }) => {
    if (cameraManagers[name]) {
      cameraManagers[name].restart();
      broadcastStatus();
      socket.emit("action_result", { success: true, message: `${name} restarted` });
    } else {
      socket.emit("action_result", { success: false, message: "Camera not found" });
    }
  });

  // stop kamera
  socket.on("stop_camera", ({ name }) => {
    if (cameraManagers[name]) {
      cameraManagers[name].stop();
      socket.emit("action_result", { success: true, message: `${name} stopped` });
    }
  });

  // start kamera
  socket.on("start_camera", ({ name }) => {
    if (cameraManagers[name]) {
      cameraManagers[name].start();
      socket.emit("action_result", { success: true, message: `${name} started` });
    }
  });

  // restart semua kamera
  socket.on("restart_all", () => {
    Object.values(cameraManagers).forEach(cam => cam.restart());
    socket.emit("action_result", { success: true, message: "All cameras restarted" });
  });

  // cek status semua kamera
  socket.on("get_status", () => {
    const statuses = Object.values(cameraManagers).map(cam => cam.getStatus());
    socket.emit("camera_status", statuses);
  });
});


class StreamManager {
  constructor(config) {
    this.config = config;
    this.stream = null;
    this.retryCount = 0;
    this.maxRetries = config.maxRetries || 10;
    this.retryDelay = config.retryDelay || 5000;
    this.host = this.extractHost(config.streamUrl);
    this.port = this.extractPort(config.streamUrl);
    this.timeoutCount = 0;
    this.maxTimeoutBeforeRestart = 3; // restart setelah 3x gagal
    this.isRestarting = false;
    this.start();
    this.startWatchdog();

  }

  extractHost(url) {
    const match = url.match(/@([\d.]+):/);
    return match ? match[1] : '127.0.0.1';
  }

  extractPort(url) {
    const match = url.match(/:(\d+)\//);
    //return match ? parseInt(match[1]) : 554;
    return parseInt(match[1]);
  }

  startWatchdog() {
    let lastFrameTime = Date.now();

    this.stream.stream.stderr.on('data', data => {
      const line = data.toString();
      if (line.includes('frame=')) {
        lastFrameTime = Date.now();
      }
    });

    this.watchdogInterval = setInterval(() => {
      const now = Date.now();
      if (now - lastFrameTime > this.config.watchdogTimeout) {
        console.warn(`[${this.config.name}] No frame for ${this.config.watchdogTimeout / 1000}s. Restarting stream...`);
        clearInterval(this.watchdogInterval);
        this.retry();
      }
    }, this.config.watchdogCheckInterval);
  }

  async isRtspAlive(timeout = 3000) {
    return new Promise(resolve => {
      const socket = new net.Socket();
      socket.setTimeout(timeout);
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => resolve(false));
      socket.once('timeout', () => resolve(false));
      socket.connect(this.port, this.host);
    });
  }

  start() {
    console.log(`[${this.config.name}] Starting stream...`);

    this.stream = new Stream({
      name: this.config.name,
      streamUrl: this.config.streamUrl,
      wsPort: this.config.wsPort,
      ffmpegOptions: this.config.ffmpegOptions
    });

    this.isRunning = true;
    this.startWatchdog();

    this.stream.stream.on('exitWithError', () => {
      console.warn(`[${this.config.name}] FFmpeg error.`);
      this.retry();
    });
  }

  stop() {
    console.log(`[${this.config.name}] Stopping stream...`);
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval);
    }

    if (this.stream) {
      try {
        this.stream.stop();
      } catch (e) {
        console.warn(e.message);
      }
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

  async getStatus() {
    const ping = await this.getLatency();

    if (!ping.alive) {
      this.timeoutCount++;
      console.warn(`[${this.config.name}] Timeout count: ${this.timeoutCount}`);

      if (this.timeoutCount >= this.maxTimeoutBeforeRestart) {
        console.warn(`[${this.config.name}] Latency timeout 3x. Auto restarting...`);
        this.timeoutCount = 0;
        this.restart();
      }
    } else {
      // reset jika sukses
      this.timeoutCount = 0;
    }

    return {
      name: this.config.name,
      running: this.isRunning,
      retryCount: this.retryCount,
      latency: ping.latency,
      alive: ping.alive,
      timeoutCount: this.timeoutCount
    };
  }

  async retry() {
    if (this.retryCount >= this.maxRetries) {
      console.error(`[${this.config.name}] Max retries reached. Giving up.`);
      return;
    }

    this.retryCount++;
    try {
      if (this.stream) {
        this.stream.stop();
      }
    } catch (e) {
      console.warn(`[${this.config.name}] Error stopping stream: ${e.message}`);
    }

    const alive = await this.isRtspAlive();
    if (!alive) {
      console.log(`[${this.config.name}] RTSP not reachable. Retrying in ${this.retryDelay / 1000}s...`);
      return setTimeout(() => this.retry(), this.retryDelay);
    }

    console.log(`[${this.config.name}] RTSP reachable. Restarting stream...`);
    this.start();
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
}


// 🔁 Jalankan banyak kamera sekaligus manual
const cameras = [
  {
    name: 'MTC-16',
    streamUrl: 'rtsp://admin:spmkawal123%23@192.168.116.3:554/',
    wsPort: 9965,
    ffmpegOptions: {
      '-r': 60,
      '-vf': 'scale=1280:720', //scale=1536:432',
      '-b:v': '1024k',
      '-g': 60,
      '-codec:v': 'mpeg1video',
      '-codec:a': 'mp2',
      '-ar': 16000,
      '-ac': 1,
      '-stats': '',
      '-fflags': 'nobuffer'
    },
    maxRetries: 20,
    retryDelay: 5000,
    watchdogTimeout: 10000,         // restart jika tidak ada frame selama 10 detik
    watchdogCheckInterval: 3000     // cek setiap 3 detik
  },
  {
    name: 'BWC-16',
    streamUrl: 'rtsp://192.168.116.4:1554/live/1',
    wsPort: 9968,
    ffmpegOptions: {
      '-r': 60,
      '-vf': 'scale=1920:1080',
      '-b:v': '1024k',
      '-g': 60,
      '-codec:v': 'mpeg1video',
      '-codec:a': 'mp2',
      '-ar': 16000,
      '-ac': 1,
      '-stats': '',
      '-fflags': 'nobuffer'
    },
    maxRetries: 20,
    retryDelay: 5000,
    watchdogTimeout: 10000,         // restart jika tidak ada frame selama 10 detik
    watchdogCheckInterval: 3000     // cek setiap 3 detik
  },
  // {
  //   name: 'ESP32',
  //   streamUrl: 'rtsp://192.168.100.59:554/',
  //   wsPort: 9999,
  //   ffmpegOptions: {
  //     '-r': 60,
  //     '-vf': 'scale=1920:1080',
  //     '-b:v': '1024k',
  //     '-g': 60,
  //     '-codec:v': 'mpeg1video',
  //     '-codec:a': 'mp2',
  //     '-ar': 16000,
  //     '-ac': 1,
  //     '-stats': '',
  //     '-fflags': 'nobuffer'
  //   },
  //   maxRetries: 20,
  //   retryDelay: 5000,
  //   watchdogTimeout: 10000,         // restart jika tidak ada frame selama 10 detik
  //   watchdogCheckInterval: 3000     // cek setiap 3 detik
  // },
  // Tambahkan kamera lain di sini
];

//cameras.forEach(config => new StreamManager(config));
const cameraManagers = {};

cameras.forEach(config => {
  cameraManagers[config.name] = new StreamManager(config);
});

async function broadcastStatus() {
  const cams = Object.values(cameraManagers);
  const result = [];

  for (let i = 0; i < cams.length; i++) {
    const status = await cams[i].getStatus();
    result.push(status);
    await new Promise(r => setTimeout(r, 100)); // delay kecil
  }

  io.emit("camera_status", result);
}

// kirim status tiap 3 detik
setInterval(() => {
  broadcastStatus();
}, 3000);

server.listen(8443, () => {
  console.log("🚀 https://localhost:8443");
});
