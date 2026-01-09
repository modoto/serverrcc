const Stream = require('node-rtsp-stream');

const net = require('net');

function isRtspAlive(host, port = 554, timeout = 3000) {
    return new Promise(resolve => {
        const socket = new net.Socket();
        socket.setTimeout(timeout);
        socket.once('connect', () => {
            socket.destroy();
            resolve(true);
        });
        socket.once('error', () => resolve(false));
        socket.once('timeout', () => resolve(false));
        socket.connect(port, host);
    });
}


class StreamManager {
    constructor(config) {
        this.config = config;
        this.stream = null;
        this.retryCount = 0;
        this.maxRetries = config.maxRetries || 10;
        this.retryDelay = config.retryDelay || 5000;
        this.start();
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

        const host = this.config.streamUrl.match(/@([\d.]+):/)?.[1];
        const port = parseInt(this.config.streamUrl.match(/:(\d+)\//)?.[1]) || 554;

        const alive = await isRtspAlive(host, port);
        if (!alive) {
            console.log(`[${this.config.name}] RTSP not reachable. Retrying in ${this.retryDelay / 1000}s...`);
            return setTimeout(() => this.retry(), this.retryDelay);
        }

        console.log(`[${this.config.name}] RTSP reachable. Restarting stream...`);
        this.start();

    }
}

module.exports = StreamManager;