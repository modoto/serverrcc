module.exports = [
  {
    name: 'MTC-17',
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
    }
  },
  {
    name: 'BWC-17',
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
    }
  }
];

