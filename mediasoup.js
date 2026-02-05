const mediasoup = require("mediasoup");

let worker;
let router;

async function createMediasoup() {
  worker = await mediasoup.createWorker();

  router = await worker.createRouter({
    mediaCodecs: [
      {
        kind: "audio",
        mimeType: "audio/opus",
        clockRate: 48000,
        channels: 2,
      },
    ],
  });

  return { worker, router };
}

module.exports = { createMediasoup };
