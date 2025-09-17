const express = require('express');

module.exports = (pool) => {
  const router = express.Router();

  // 대학교 목록 조회
  router.get('/', async (req, res) => {
    try {
      const [universities] = await pool.execute(
        'SELECT id, name FROM htht_university ORDER BY name ASC'
      );

      res.json({
        success: true,
        data: universities
      });

    } catch (error) {
      console.error('Get universities error:', error);
      res.status(500).json({
        success: false,
        message: '대학교 목록을 가져오는 중 오류가 발생했습니다.'
      });
    }
  });

  return router;
};
