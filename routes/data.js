import express from 'express';

const dataRoutes = (pool) => {
  const router = express.Router();

  // 강의 목록 조회
  router.get('/lectures', async (req, res) => {
    try {
      const { universityId, subjectGroup } = req.query;

      if (!universityId || !subjectGroup) {
        return res.status(400).json({
          success: false,
          message: '대학교와 과목군을 선택해주세요.'
        });
      }

      const [lectures] = await pool.execute(
        `SELECT 
          id,
          htht_university_id,
          htht_university_user_id,
          subject_group,
          name
        FROM pulley.lecture 
        WHERE htht_university_id = ? AND subject_group = ? AND is_deleted = 0 
        ORDER BY id DESC`,
        [universityId, subjectGroup]
      );

      res.json({
        success: true,
        data: lectures
      });

    } catch (error) {
      console.error('Get lectures error:', error);
      res.status(500).json({
        success: false,
        message: '강의 목록을 가져오는 중 오류가 발생했습니다.'
      });
    }
  });

  // 통계 조회
  router.get('/stats', async (req, res) => {
    try {
      const { universityId, startDate, endDate } = req.query;

      if (!universityId || !startDate || !endDate) {
        return res.status(400).json({
          success: false,
          message: '대학교, 시작일, 종료일을 모두 선택해주세요.'
        });
      }

      const [statsResult] = await pool.execute(
        `SELECT 
          SUM(total_questions) as total_questions,
          SUM(total_solved) as total_solved,
          SUM(total_correct) as total_correct,
          AVG(total_accuracy) as avg_accuracy,
          AVG(original_accuracy) as avg_original_accuracy,
          AVG(similar_accuracy) as avg_similar_accuracy
        FROM pulley_statistic.htht_daily_piece_problem_history 
        WHERE university_id = ? AND study_date BETWEEN ? AND ?`,
        [universityId, startDate, endDate]
      );

      const stats = statsResult[0];

      res.json({
        success: true,
        data: {
          totalProblems: Number(stats.total_questions || 0),
          totalSolved: Number(stats.total_solved || 0),
          totalCorrect: Number(stats.total_correct || 0),
          averageRate: Number(stats.total_questions || 0) > 0 
            ? (Number(stats.total_solved || 0) / Number(stats.total_questions || 0)) * 100 
            : 0,
          originalRate: Number(stats.avg_original_accuracy || 0),
          similarRate: Number(stats.avg_similar_accuracy || 0)
        }
      });

    } catch (error) {
      console.error('Get stats error:', error);
      res.status(500).json({
        success: false,
        message: '통계를 가져오는 중 오류가 발생했습니다.'
      });
    }
  });

  // 강의별 통계 조회
  router.get('/lecture-stats', async (req, res) => {
    try {
      const { universityId, lectureIds, startDate, endDate } = req.query;

      if (!universityId || !lectureIds || !startDate || !endDate) {
        return res.status(400).json({
          success: false,
          message: '모든 필드를 선택해주세요.'
        });
      }

      const lectureIdArray = lectureIds.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
      
      if (lectureIdArray.length === 0) {
        return res.status(400).json({
          success: false,
          message: '유효한 강의를 선택해주세요.'
        });
      }

      const placeholders = lectureIdArray.map(() => '?').join(',');

      const [statsResult] = await pool.execute(
        `SELECT 
          SUM(h.total_questions) as total_questions,
          SUM(h.total_solved) as total_solved,
          SUM(h.total_correct) as total_correct,
          AVG(h.total_accuracy) as avg_accuracy,
          AVG(h.original_accuracy) as avg_original_accuracy,
          AVG(h.similar_accuracy) as avg_similar_accuracy
        FROM pulley_statistic.htht_daily_piece_problem_history h
        INNER JOIN pulley.lecture_student_mapping m ON h.htht_university_user_id = m.htht_university_user_id
        INNER JOIN pulley.lecture l ON m.lecture_id = l.id
        WHERE h.university_id = ? AND h.study_date BETWEEN ? AND ? 
        AND m.lecture_id IN (${placeholders}) AND m.is_deleted = 0`,
        [universityId, startDate, endDate, ...lectureIdArray]
      );

      const stats = statsResult[0];

      res.json({
        success: true,
        data: {
          totalProblems: Number(stats.total_questions || 0),
          totalSolved: Number(stats.total_solved || 0),
          totalCorrect: Number(stats.total_correct || 0),
          averageRate: Number(stats.avg_accuracy || 0),
          originalRate: Number(stats.avg_original_accuracy || 0),
          similarRate: Number(stats.avg_similar_accuracy || 0)
        }
      });

    } catch (error) {
      console.error('Get lecture stats error:', error);
      res.status(500).json({
        success: false,
        message: '통계 데이터를 가져오는 중 오류가 발생했습니다.'
      });
    }
  });

  // 일일 문제 이력 조회
  router.get('/daily-problem-history', async (req, res) => {
    try {
      const { universityId, startDate, endDate, page = 1, limit = 20 } = req.query;

      if (!universityId || !startDate || !endDate) {
        return res.status(400).json({
          success: false,
          message: '대학교, 시작일, 종료일을 모두 선택해주세요.'
        });
      }

      // 파라미터 검증 및 변환
      const universityIdNum = parseInt(universityId);
      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);

      if (isNaN(universityIdNum) || isNaN(pageNum) || isNaN(limitNum)) {
        return res.status(400).json({
          success: false,
          message: '유효하지 않은 파라미터입니다.'
        });
      }

      const offset = (pageNum - 1) * limitNum;

      console.log('Daily problem history query:', {
        universityId: universityIdNum,
        startDate,
        endDate,
        page: pageNum,
        limit: limitNum,
        offset
      });

      // 간단한 테스트 쿼리 먼저 실행
      const [testResult] = await pool.execute(
        `SELECT COUNT(*) as count
        FROM pulley_statistic.htht_daily_piece_problem_history 
        WHERE university_id = ?`,
        [universityIdNum]
      );
      
      console.log('Test query result:', testResult);

      const [historyResult] = await pool.execute(
        `SELECT 
          study_date,
          total_questions,
          total_solved,
          total_correct,
          total_accuracy,
          original_accuracy,
          similar_accuracy
        FROM pulley_statistic.htht_daily_piece_problem_history 
        WHERE university_id = ? AND study_date BETWEEN ? AND ?
        ORDER BY study_date DESC
        LIMIT ${limitNum} OFFSET ${offset}`,
        [universityIdNum, startDate, endDate]
      );

      // 전체 개수 조회
      const [countResult] = await pool.execute(
        `SELECT COUNT(*) as total
        FROM pulley_statistic.htht_daily_piece_problem_history 
        WHERE university_id = ? AND study_date BETWEEN ? AND ?`,
        [universityIdNum, startDate, endDate]
      );

      const total = countResult[0].total;
      const totalPages = Math.ceil(total / limitNum);

      res.json({
        success: true,
        data: {
          history: historyResult,
          pagination: {
            currentPage: pageNum,
            totalPages,
            totalItems: total,
            itemsPerPage: limitNum
          }
        }
      });

    } catch (error) {
      console.error('Get daily problem history error:', error);
      console.error('Error details:', {
        message: error.message,
        stack: error.stack,
        universityId: req.query.universityId,
        startDate: req.query.startDate,
        endDate: req.query.endDate
      });
      res.status(500).json({
        success: false,
        message: '일일 문제 이력을 가져오는 중 오류가 발생했습니다.',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  return router;
};

export default dataRoutes;
