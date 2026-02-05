const db = require("../db");

class MtcamModel {
  static async getAll() {
    const result = await db.query(
      "SELECT * FROM mtcam WHERE deleted_at IS NULL ORDER BY id ASC"
    );
    return result.rows;
  }

  static async findById(id) {
    const result = await db.query("SELECT * FROM mtcam WHERE id=$1", [id]);
    return result.rows[0];
  }

  static async findByCode(id) {
    const result = await db.query("SELECT * FROM mtcam WHERE mtcam_id=$1", [id]);
    return result.rows[0];
  }
}

module.exports = MtcamModel;
