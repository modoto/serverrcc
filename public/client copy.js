import * as mediasoupClient from "https://esm.sh/mediasoup-client@3";

console.log("🔥 client.js loaded");

const socket = io("https://192.168.100.5:8443", { transports: ["websocket"] });

let device, recvTransport;

socket.on("join", async clientId => {
  console.log("📥 join success:", clientId);

  const rtpCapabilities = await new Promise(res =>
    socket.emit("rtpCapabilities", res)
  );
  console.log("📥 rtpCapabilities:", rtpCapabilities);

  device = new mediasoupClient.Device();
  await device.load({ routerRtpCapabilities: rtpCapabilities });

  const recvParams = await new Promise(res =>
    socket.emit("createTransport", res)
  );
  console.log("📥 recvParams:", recvParams);

  recvTransport = device.createRecvTransport(recvParams);

  // Log ICE candidate
  recvTransport.on("icecandidate", c => {
    console.log("🧊 ICE candidate from browser:", c);
  });

  recvTransport.on("connect", ({ dtlsParameters }, cb) => {
    console.log("➡️ connectTransport fired");
    socket.emit("connectTransport", {
      transportId: recvTransport.id,
      dtlsParameters
    });
    cb();
  });

  recvTransport.on("connectionstatechange", state => {
    console.log("🚦 connection state:", state);
  });

  console.log("➡️ transportId :", recvTransport.id);

  socket.emit("consume", {
    transportId: recvTransport.id
  }, async params => {
    const consumer = await recvTransport.consume(params);
    const stream = new MediaStream();
    stream.addTrack(consumer.track);
    document.getElementById("video").srcObject = stream;
  }
  );

});