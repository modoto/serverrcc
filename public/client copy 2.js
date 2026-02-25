import * as mediasoupClient from "https://esm.sh/mediasoup-client@3";

const socket = io("https://192.168.100.5:8443", {
  transports: ["websocket"]
});

let device;
let recvTransport;

async function start() {

  const rtpCapabilities = await new Promise(res =>
    socket.emit("getRtpCapabilities", res)
  );

  device = new mediasoupClient.Device();
  await device.load({ routerRtpCapabilities: rtpCapabilities });

  const transportParams = await new Promise(res =>
    socket.emit("createTransport", res)
  );

  recvTransport = device.createRecvTransport(transportParams);

  recvTransport.on("connect", ({ dtlsParameters }, cb) => {
    socket.emit("connectTransport", {
      transportId: recvTransport.id,
      dtlsParameters
    });
    cb();
  });

   recvTransport.on("connectionstatechange", state => {
    console.log("🚦 connection state:", state);
  });

  socket.emit("consume", {
    transportId: recvTransport.id,
    rtpCapabilities: device.rtpCapabilities
  }, async params => {

    const consumer = await recvTransport.consume(params);

    const stream = new MediaStream();
    stream.addTrack(consumer.track);

    document.getElementById("video").srcObject = stream;
  });
}

socket.on("connect", start);
