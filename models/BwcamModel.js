const db = require("../db");

class BwcamModel {
  static async getAll() {
    const result = await db.query(
      "SELECT * FROM bwcam WHERE status=1 AND deleted_at IS NULL ORDER BY id ASC"
    );
    return result.rows;
  }

  static async findById(id) {
    const result = await db.query("SELECT * FROM bwcam WHERE id=$1", [id]);
    return result.rows[0];
  }

  static async findByCode(id) {
    const result = await db.query("SELECT * FROM bwcam WHERE bwcam_id=$1", [id]);
    return result.rows[0];
  }
}

module.exports = BwcamModel;
