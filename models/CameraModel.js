const db = require("../db");

class CameraModel {
  static async getAll() {
    const result = await db.query(
      `select * from(
SELECT m.mtcam_id as name, m.rtsp_url , m.rtsp_port , m.ffmpeg_options FROM mtcam m
UNION ALL 
SELECT b.bwcam_id as name, b.rtsp_url , b.rtsp_port, b.ffmpeg_options FROM bwcam b
)as cameras order by name;`
    );
    return result.rows;
  }
}

module.exports = CameraModel;
