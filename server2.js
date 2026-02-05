

const fs = require('node:fs');
const https = require('node:https');
const { createProxyServer } = require("http-proxy");
const Stream = require('node-rtsp-stream');
const net = require('net');
const pool = require('./db');
const Bwcam = require("./models/BwcamModel");
const Mtcam = require("./models/MtCamModel");

const app = express();
const proxy = createProxyServer({ ws: true });

const options = {
  key: fs.readFileSync('key.pem'),
  cert: fs.readFileSync('cert.pem'),
};

//const server = http.createServer(app);
const server = https.createServer(options, app);

app.use(express.static("public"));

class StreamManager {
  constructor(config) {
    this.config = config;
    this.stream = null;
    this.retryCount = 0;
    this.maxRetries = config.maxRetries || 10;
    this.retryDelay = config.retryDelay || 5000;
    this.host = this.extractHost(config.streamUrl);
    this.port = this.extractPort(config.streamUrl);
    this.start();
    this.startWatchdog();

  }

  extractHost(url) {
    const match = url.match(/@([\d.]+):/);
    return match ? match[1] : '127.0.0.1';
  }

  extractPort(url) {
    const match = url.match(/:(\d+)\//);
    return match ? parseInt(match[1]) : 554;
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

    this.stream.stream.on('exitWithError', () => {
      console.warn(`[${this.config.name}] FFmpeg error. Retrying in ${this.retryDelay / 1000}s...`);
      this.retry();
    });
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
}


// 🔁 Jalankan banyak kamera sekaligus manual
const cameras = [
  {
    name: 'kamera-1',
    streamUrl: 'rtsp://admin:spmkawal123%23@192.168.10.163:554/',
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
    name: 'kamera-1',
    streamUrl: 'rtsp://admin:spmkawal123%23@192.168.10.153:554/',
    wsPort: 9966,
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
  // {
  //   name: 'kamera-2',
  //   streamUrl: 'rtsp://192.167.0.4:1554/live/1',
  //   wsPort: 9998,
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

cameras.forEach(config => new StreamManager(config));



// 🔁 Jalankan banyak kamera sekaligus dari database
async function loadCamerasFromDB() {
  const bwcams = await Bwcam.getAll();
  const mtcams = await Bwcam.getAll();

  let cameras = []; // Tetap sebagai array

  bwcams.forEach(item => {
    const port = item.stream_url.split(':').pop(); 
    const camera = {
      name: item.mtcam_id,
      streamUrl: item.rtsp_url,
      wsPort: port,
      ffmpegOptions: item.ffmpeg_options,
      maxRetries: 20,
      retryDelay: 5000,
      watchdogTimeout: 10000,
      watchdogCheckInterval: 3000
    };
    cameras.push(camera);
  });

  //console.log(`Starting camera: ${cameras}`);

  cameras.forEach(config => new StreamManager(config));

}

//loadCamerasFromDB();