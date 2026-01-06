import express from 'express';

const dataRoutes = (pool) => {
  const router = express.Router();

  // 공통 설정
  const MAX_LIMIT = 200;

  const parsePagingParams = (page = 1, limit = 20) => {
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(MAX_LIMIT, Math.max(1, parseInt(limit)));
    return { pageNum, limitNum, offset: (pageNum - 1) * limitNum };
  };

  // 로컬 타임존(서버 시간)을 그대로 사용해 파일명에 표기
  const formatKstNow = () => {
    const now = new Date();
    const yyyy = String(now.getFullYear());
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    return { display: `${yyyy}-${mm}-${dd} ${hh}시 ${min}분`, iso: now.toISOString() };
  };

  const validateDateRange = (startDate, endDate) => {
    if ((startDate && !endDate) || (!startDate && endDate)) {
      return false;
    }
    return true;
  };

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

  // 학습지 진행률 (학습지 기준) 조회
  router.get('/piece-progress', async (req, res) => {
    try {
      const { universityId, startDate, endDate, page = 1, limit = 20 } = req.query;

      if (!universityId) {
        return res.status(400).json({
          success: false,
          message: '대학교를 선택해주세요.'
        });
      }

      if (!validateDateRange(startDate, endDate)) {
        return res.status(400).json({
          success: false,
          message: '학습지 생성일 기간을 모두 입력하거나 비워주세요.'
        });
      }

      const universityIdNum = parseInt(universityId);
      if (isNaN(universityIdNum)) {
        return res.status(400).json({
          success: false,
          message: '유효하지 않은 대학교입니다.'
        });
      }

      const { pageNum, limitNum, offset } = parsePagingParams(page, limit);
      const useDateFilter = !!(startDate && endDate);
      const dateClause = useDateFilter ? 'AND created_at BETWEEN ? AND ?' : '';
      const params = useDateFilter
        ? [universityIdNum, startDate, endDate]
        : [universityIdNum];

      const [rows] = await pool.execute(
        `SELECT 
          id,
          university_id,
          school_name,
          htht_university_user_id,
          account,
          student_name,
          student_no,
          study_type,
          piece_id,
          piece_name,
          subject_group,
          total_questions,
          solved_questions,
          correct_questions,
          DATE_FORMAT(created_at, '%Y-%m-%d') AS created_at,
          DATE_FORMAT(updated_at, '%Y-%m-%d') AS updated_at,
          CASE 
            WHEN total_questions IS NULL OR total_questions = 0 THEN 0
            ELSE ROUND((COALESCE(solved_questions,0) / total_questions) * 100, 2)
          END AS progress_rate
        FROM pulley_statistic.htht_piece_process_overview
        WHERE university_id = ?
        ${dateClause}
        ORDER BY created_at DESC, piece_name
        LIMIT ${limitNum} OFFSET ${offset}`,
        params
      );

      const countParams = useDateFilter
        ? [universityIdNum, startDate, endDate]
        : [universityIdNum];
      const [countResult] = await pool.execute(
        `SELECT COUNT(*) AS total
        FROM pulley_statistic.htht_piece_process_overview
        WHERE university_id = ?
        ${dateClause}`,
        countParams
      );

      const total = countResult[0]?.total || 0;
      const totalPages = Math.ceil(total / limitNum);

      res.json({
        success: true,
        data: {
          note: '조회시점 기준이라서 데이터가 다를 수 있습니다.',
          items: rows,
          pagination: {
            currentPage: pageNum,
            totalPages,
            totalItems: total,
            itemsPerPage: limitNum
          }
        }
      });
    } catch (error) {
      console.error('Get piece progress error:', error);
      res.status(500).json({
        success: false,
        message: '학습지 진행률 데이터를 가져오는 중 오류가 발생했습니다.'
      });
    }
  });

  // 학습지 진행률 (학습지 기준) CSV
  router.get('/piece-progress-download', async (req, res) => {
    try {
      const { universityId, startDate, endDate, schoolName = '' } = req.query;

      if (!universityId) {
        return res.status(400).json({
          success: false,
          message: '대학교를 선택해주세요.'
        });
      }

      if (!validateDateRange(startDate, endDate)) {
        return res.status(400).json({
          success: false,
          message: '학습지 생성일 기간을 모두 입력하거나 비워주세요.'
        });
      }

      const universityIdNum = parseInt(universityId);
      if (isNaN(universityIdNum)) {
        return res.status(400).json({
          success: false,
          message: '유효하지 않은 대학교입니다.'
        });
      }

      const useDateFilter = !!(startDate && endDate);
      const dateClause = useDateFilter ? 'AND created_at BETWEEN ? AND ?' : '';
      const params = useDateFilter
        ? [universityIdNum, startDate, endDate]
        : [universityIdNum];

      const [rows] = await pool.execute(
        `SELECT 
          id,
          university_id,
          school_name,
          htht_university_user_id,
          account,
          student_name,
          student_no,
          study_type,
          piece_id,
          piece_name,
          subject_group,
          total_questions,
          solved_questions,
          correct_questions,
          DATE_FORMAT(created_at, '%Y-%m-%d') AS created_at,
          DATE_FORMAT(updated_at, '%Y-%m-%d') AS updated_at,
          CASE 
            WHEN total_questions IS NULL OR total_questions = 0 THEN 0
            ELSE ROUND((COALESCE(solved_questions,0) / total_questions) * 100, 2)
          END AS progress_rate
        FROM pulley_statistic.htht_piece_process_overview
        WHERE university_id = ?
        ${dateClause}
        ORDER BY created_at DESC, piece_name`,
        params
      );

      const headers = [
        '생성일',
        '최근학습일',
        '학습유형',
        '대학교ID',
        '학교명',
        '대학사용자ID',
        '계정',
        '학생명',
        '학번',
        '학습지ID',
        '학습지명',
        '과목군',
        '총문항수',
        '푼문항수',
        '정답문항수',
        '진행률(%)'
      ];
      const csvRows = [headers.join(',')];
      rows.forEach((row) => {
        const csvRow = [
          row.created_at ? `"${row.created_at}"` : '',
          row.updated_at ? `"${row.updated_at}"` : '',
          `"${row.study_type ?? ''}"`,
          row.university_id ?? '',
          `"${row.school_name ?? ''}"`,
          row.htht_university_user_id ?? '',
          `"${row.account ?? ''}"`,
          `"${row.student_name ?? ''}"`,
          `"${row.student_no ?? ''}"`,
          row.piece_id ?? '',
          `"${row.piece_name ?? ''}"`,
          `"${row.subject_group ?? ''}"`,
          row.total_questions ?? 0,
          row.solved_questions ?? 0,
          row.correct_questions ?? 0,
          row.progress_rate ?? 0
        ];
        csvRows.push(csvRow.join(','));
      });

      const csvContent = csvRows.join('\n');
      const { display } = formatKstNow();
      const safeSchool = String(schoolName || '학교').replace(/[\\/:*?"<>|]/g, '_');
      const rawFilename = `${safeSchool} 학습지 진행률 (${display} 기준).csv`;
      const filename = encodeURIComponent(rawFilename);

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send('\uFEFF' + csvContent);
    } catch (error) {
      console.error('Get piece progress download error:', error);
      res.status(500).json({
        success: false,
        message: '학습지 진행률 CSV 생성 중 오류가 발생했습니다.'
      });
    }
  });

  // 개념학습 진행률 (학습지 기준) 조회
  router.get('/concept-progress', async (req, res) => {
    try {
      const { universityId, startDate, endDate, page = 1, limit = 20 } = req.query;

      if (!universityId) {
        return res.status(400).json({
          success: false,
          message: '대학교를 선택해주세요.'
        });
      }

      if (!validateDateRange(startDate, endDate)) {
        return res.status(400).json({
          success: false,
          message: '학습지 생성일 기간을 모두 입력하거나 비워주세요.'
        });
      }

      const universityIdNum = parseInt(universityId);
      if (isNaN(universityIdNum)) {
        return res.status(400).json({
          success: false,
          message: '유효하지 않은 대학교입니다.'
        });
      }

      const { pageNum, limitNum, offset } = parsePagingParams(page, limit);
      const useDateFilter = !!(startDate && endDate);
      const dateClause = useDateFilter ? 'AND created_at BETWEEN ? AND ?' : '';
      const params = useDateFilter
        ? [universityIdNum, startDate, endDate]
        : [universityIdNum];
      const [rows] = await pool.execute(
        `SELECT 
          id,
          university_id,
          school_name,
          htht_university_user_id,
          account,
          student_name,
          student_no,
          subject_group,
          concept_chapter_id,
          subject_name,
          chapter_name,
          total_questions,
          solved_questions,
          correct_questions,
          DATE_FORMAT(created_at, '%Y-%m-%d') AS created_at,
          DATE_FORMAT(updated_at, '%Y-%m-%d') AS updated_at,
          CASE 
            WHEN total_questions IS NULL OR total_questions = 0 THEN 0
            ELSE ROUND((COALESCE(solved_questions,0) / total_questions) * 100, 2)
          END AS progress_rate
        FROM pulley_statistic.htht_concept_process_overview
        WHERE university_id = ?
        ${dateClause}
        ORDER BY created_at DESC, concept_chapter_id
        LIMIT ${limitNum} OFFSET ${offset}`,
        params
      );

      const countParams = useDateFilter
        ? [universityIdNum, startDate, endDate]
        : [universityIdNum];
      const [countResult] = await pool.execute(
        `SELECT COUNT(*) AS total
        FROM pulley_statistic.htht_concept_process_overview
        WHERE university_id = ?
        ${dateClause}`,
        countParams
      );

      const total = countResult[0]?.total || 0;
      const totalPages = Math.ceil(total / limitNum);

      res.json({
        success: true,
        data: {
          note: '조회시점 기준이라서 데이터가 다를 수 있습니다.',
          items: rows,
          pagination: {
            currentPage: pageNum,
            totalPages,
            totalItems: total,
            itemsPerPage: limitNum
          }
        }
      });
    } catch (error) {
      console.error('Get concept progress error:', error);
      res.status(500).json({
        success: false,
        message: '개념학습 진행률 데이터를 가져오는 중 오류가 발생했습니다.'
      });
    }
  });

  // 개념학습 진행률 (학습지 기준) CSV
  router.get('/concept-progress-download', async (req, res) => {
    try {
      const { universityId, startDate, endDate, schoolName = '' } = req.query;

      if (!universityId) {
        return res.status(400).json({
          success: false,
          message: '대학교를 선택해주세요.'
        });
      }

      if (!validateDateRange(startDate, endDate)) {
        return res.status(400).json({
          success: false,
          message: '학습지 생성일 기간을 모두 입력하거나 비워주세요.'
        });
      }

      const universityIdNum = parseInt(universityId);
      if (isNaN(universityIdNum)) {
        return res.status(400).json({
          success: false,
          message: '유효하지 않은 대학교입니다.'
        });
      }

      const useDateFilter = !!(startDate && endDate);
      const dateClause = useDateFilter ? 'AND created_at BETWEEN ? AND ?' : '';
      const params = useDateFilter
        ? [universityIdNum, startDate, endDate]
        : [universityIdNum];

      const [rows] = await pool.execute(
        `SELECT 
          id,
          university_id,
          school_name,
          htht_university_user_id,
          account,
          student_name,
          student_no,
          subject_group,
          concept_chapter_id,
          subject_name,
          chapter_name,
          total_questions,
          solved_questions,
          correct_questions,
          DATE_FORMAT(created_at, '%Y-%m-%d') AS created_at,
          DATE_FORMAT(updated_at, '%Y-%m-%d') AS updated_at,
          CASE 
            WHEN total_questions IS NULL OR total_questions = 0 THEN 0
            ELSE ROUND((COALESCE(solved_questions,0) / total_questions) * 100, 2)
          END AS progress_rate
        FROM pulley_statistic.htht_concept_process_overview
        WHERE university_id = ?
        ${dateClause}
        ORDER BY created_at DESC, concept_chapter_id`,
        params
      );

      const headers = [
        'id',
        'university_id',
        'school_name',
        'htht_university_user_id',
        'account',
        'student_name',
        'student_no',
        'subject_group',
        'concept_chapter_id',
        'subject_name',
        'chapter_name',
        'total_questions',
        'solved_questions',
        'correct_questions',
        'created_at',
        'updated_at'
      ];
      const csvRows = [headers.join(',')];
      rows.forEach((row) => {
        const csvRow = [
          row.id ?? '',
          row.university_id ?? '',
          `"${row.school_name ?? ''}"`,
          row.htht_university_user_id ?? '',
          `"${row.account ?? ''}"`,
          `"${row.student_name ?? ''}"`,
          `"${row.student_no ?? ''}"`,
          `"${row.subject_group ?? ''}"`,
          `"${row.concept_chapter_id ?? ''}"`,
        `"${row.subject_name ?? ''}"`,
        `"${row.chapter_name ?? ''}"`,
          row.total_questions ?? 0,
          row.solved_questions ?? 0,
          row.correct_questions ?? 0,
          row.created_at ? `"${row.created_at}"` : '',
          row.updated_at ? `"${row.updated_at}"` : '',
          
        ];
        csvRows.push(csvRow.join(','));
      });

      const csvContent = csvRows.join('\n');
      const { display } = formatKstNow();
      const safeSchool = String(schoolName || '학교').replace(/[\\/:*?"<>|]/g, '_');
      const rawFilename = `${safeSchool} 개념학습 진행률 (${display} 기준).csv`;
      const filename = encodeURIComponent(rawFilename);

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send('\uFEFF' + csvContent);
    } catch (error) {
      console.error('Get concept progress download error:', error);
      res.status(500).json({
        success: false,
        message: '개념학습 진행률 CSV 생성 중 오류가 발생했습니다.'
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
          totalCorrect: Number(stats.total_correct || 0),
          averageRate: Number(stats.avg_accuracy || 0),
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

      // daily-problem-history는 단일 테이블에서 모든 데이터 조회
      const [historyResult] = await pool.execute(
        `SELECT 
          DATE_FORMAT(study_date, '%Y-%m-%d') as study_date,
          university_id,
          school_name,
          account,
          student_name,
          student_no,
          study_type,
          piece_name,
          subject_group,
          CAST(total_questions AS UNSIGNED) as total_questions,
          CAST(original_questions AS UNSIGNED) as original_questions,
          CAST(similar_questions AS UNSIGNED) as similar_questions,
          CAST(original_correct AS UNSIGNED) as original_correct,
          CAST(similar_correct AS UNSIGNED) as similar_correct,
          CAST(total_correct AS UNSIGNED) as total_correct,
          CAST(total_accuracy AS DECIMAL(5,2)) as total_accuracy,
          CAST(original_accuracy AS DECIMAL(5,2)) as original_accuracy,
          CAST(similar_accuracy AS DECIMAL(5,2)) as similar_accuracy
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

      // 데이터 타입 변환 (문자열을 숫자로)
      const processedHistory = historyResult.map(row => ({
        ...row,
        total_questions: Number(row.total_questions) || 0,
        original_questions: Number(row.original_questions) || 0,
        similar_questions: Number(row.similar_questions) || 0,
        
        original_correct: Number(row.original_correct) || 0,
        similar_correct: Number(row.similar_correct) || 0,
        total_correct: Number(row.total_correct) || 0,
        total_accuracy: Number(row.total_accuracy) || 0,
        original_accuracy: Number(row.original_accuracy) || 0,
        similar_accuracy: Number(row.similar_accuracy) || 0
      }));

      res.json({
        success: true,
        data: {
          history: processedHistory,
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

  // 강의별 학습 이력 조회
  router.get('/lecture-history', async (req, res) => {
    try {
      const { universityId, lectureIds, startDate, endDate, page = 1, limit = 20 } = req.query;

      if (!universityId || !lectureIds || !startDate || !endDate) {
        return res.status(400).json({
          success: false,
          message: '모든 필드를 선택해주세요.'
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

      const lectureIdArray = lectureIds.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
      
      if (lectureIdArray.length === 0) {
        return res.status(400).json({
          success: false,
          message: '유효한 강의를 선택해주세요.'
        });
      }

      const offset = (pageNum - 1) * limitNum;
      const placeholders = lectureIdArray.map(() => '?').join(',');

      const [historyResult] = await pool.execute(
        `SELECT 
          DATE_FORMAT(h.study_date, '%Y-%m-%d') as study_date,
          h.university_id,
          h.school_name,
          h.account,
          h.student_name,
          h.student_no,
          h.study_type,
          h.piece_name,
          h.subject_group,
          l.name as lecture_name,
          CAST(h.total_questions AS UNSIGNED) as total_questions,
          CAST(h.original_questions AS UNSIGNED) as original_questions,
          CAST(h.similar_questions AS UNSIGNED) as similar_questions,
          CAST(h.original_correct AS UNSIGNED) as original_correct,
          CAST(h.similar_correct AS UNSIGNED) as similar_correct,
          CAST(h.total_correct AS UNSIGNED) as total_correct,
          CAST(h.total_accuracy AS DECIMAL(5,2)) as total_accuracy,
          CAST(h.original_accuracy AS DECIMAL(5,2)) as original_accuracy,
          CAST(h.similar_accuracy AS DECIMAL(5,2)) as similar_accuracy
        FROM pulley_statistic.htht_daily_piece_problem_history h
        INNER JOIN pulley.lecture_student_mapping m ON h.htht_university_user_id = m.htht_university_user_id
        INNER JOIN pulley.lecture l ON m.lecture_id = l.id
        WHERE h.university_id = ? AND h.study_date BETWEEN ? AND ? 
        AND m.lecture_id IN (${placeholders}) AND m.is_deleted = 0
        ORDER BY h.study_date DESC, l.name, h.account
        LIMIT ${limitNum} OFFSET ${offset}`,
        [universityIdNum, startDate, endDate, ...lectureIdArray]
      );

      // 전체 개수 조회
      const [countResult] = await pool.execute(
        `SELECT COUNT(*) as total
        FROM pulley_statistic.htht_daily_piece_problem_history h
        INNER JOIN pulley.lecture_student_mapping m ON h.htht_university_user_id = m.htht_university_user_id
        WHERE h.university_id = ? AND h.study_date BETWEEN ? AND ? 
        AND m.lecture_id IN (${placeholders}) AND m.is_deleted = 0`,
        [universityIdNum, startDate, endDate, ...lectureIdArray]
      );

      const total = countResult[0].total;
      const totalPages = Math.ceil(total / limitNum);

      // 데이터 타입 변환 (문자열을 숫자로)
      const processedHistory = historyResult.map(row => ({
        ...row,
        total_questions: Number(row.total_questions) || 0,
        original_questions: Number(row.original_questions) || 0,
        similar_questions: Number(row.similar_questions) || 0,
        // total_solved: Number(row.total_solved) || 0,
        // original_solved: Number(row.original_solved) || 0,
        // similar_solved: Number(row.similar_solved) || 0,
        original_correct: Number(row.original_correct) || 0,
        similar_correct: Number(row.similar_correct) || 0,
        total_correct: Number(row.total_correct) || 0,
        total_accuracy: Number(row.total_accuracy) || 0,
        original_accuracy: Number(row.original_accuracy) || 0,
        similar_accuracy: Number(row.similar_accuracy) || 0
      }));

      res.json({
        success: true,
        data: {
          history: processedHistory,
          pagination: {
            currentPage: pageNum,
            totalPages,
            totalItems: total,
            itemsPerPage: limitNum
          }
        }
      });

    } catch (error) {
      console.error('Get lecture history error:', error);
      console.error('Error details:', {
        message: error.message,
        stack: error.stack,
        universityId: req.query.universityId,
        lectureIds: req.query.lectureIds,
        startDate: req.query.startDate,
        endDate: req.query.endDate
      });
      res.status(500).json({
        success: false,
        message: '강의별 학습 이력을 가져오는 중 오류가 발생했습니다.',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // 강의 다운로드 (CSV)
  router.get('/lecture-download', async (req, res) => {
    try {
      const { universityId, lectureIds, startDate, endDate } = req.query;

      if (!universityId || !lectureIds || !startDate || !endDate) {
        return res.status(400).json({
          success: false,
          message: '모든 필드를 선택해주세요.'
        });
      }

      const universityIdNum = parseInt(universityId);
      const lectureIdArray = lectureIds.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
      
      if (lectureIdArray.length === 0) {
        return res.status(400).json({
          success: false,
          message: '유효한 강의를 선택해주세요.'
        });
      }

      const placeholders = lectureIdArray.map(() => '?').join(',');

      const [downloadResult] = await pool.execute(
        `SELECT 
          DATE_FORMAT(h.study_date, '%Y-%m-%d') as study_date,
          h.university_id,
          h.school_name,
          h.account,
          h.student_name,
          h.student_no,
          h.study_type,
          h.piece_id,
          h.piece_name,
          h.subject_group,
          l.name as lecture_name,
          CAST(h.total_questions AS UNSIGNED) as total_questions,
          CAST(h.original_questions AS UNSIGNED) as original_questions,
          CAST(h.similar_questions AS UNSIGNED) as similar_questions,
          CAST(h.original_correct AS UNSIGNED) as original_correct,
          CAST(h.similar_correct AS UNSIGNED) as similar_correct,
          CAST(h.total_correct AS UNSIGNED) as total_correct,
          CAST(h.total_accuracy AS DECIMAL(5,2)) as total_accuracy,
          CAST(h.original_accuracy AS DECIMAL(5,2)) as original_accuracy,
          CAST(h.similar_accuracy AS DECIMAL(5,2)) as similar_accuracy
        FROM pulley_statistic.htht_daily_piece_problem_history h
        INNER JOIN pulley.lecture_student_mapping m ON h.htht_university_user_id = m.htht_university_user_id
        INNER JOIN pulley.lecture l ON m.lecture_id = l.id
        WHERE h.university_id = ? AND h.study_date BETWEEN ? AND ? 
        AND m.lecture_id IN (${placeholders}) AND m.is_deleted = 0
        ORDER BY h.study_date DESC, l.name, h.account`,
        [universityIdNum, startDate, endDate, ...lectureIdArray]
      );

      // CSV 헤더
      const headers = [
        '학습일자', '대학교', '학교명', '계정', '학생명', '학번', '학습유형','학습지id', '학습지명', '과목군', '강의명',
         '전체풀이수', '원본풀이수', '유사풀이수',
        '원본정답수', '유사정답수', '전체정답수', '전체정답률', '원본정답률', '유사정답률'
      ];

      // CSV 데이터 생성
      const csvRows = [headers.join(',')];
      
      downloadResult.forEach(row => {
        const csvRow = [
          row.study_date || '',
          row.university_id,
          `"${row.school_name || ''}"`,
          `"${row.account || ''}"`,
          `"${row.student_name || ''}"`,
          `"${row.student_no || ''}"`,
          `"${row.study_type || ''}"`,
          `"${row.piece_id || ''}"`,
          `"${row.piece_name || ''}"`,
          `"${row.subject_group || ''}"`,
          `"${row.lecture_name || ''}"`,
          row.total_questions || 0,
          row.original_questions || 0,
          row.similar_questions || 0,
          // row.total_solved || 0,
          // row.original_solved || 0,
          // row.similar_solved || 0,
          row.original_correct || 0,
          row.similar_correct || 0,
          row.total_correct || 0,
          row.total_accuracy || 0,
          row.original_accuracy || 0,
          row.similar_accuracy || 0
        ];
        csvRows.push(csvRow.join(','));
      });

      const csvContent = csvRows.join('\n');
      const filename = `lecture_problem_history_${startDate}_${endDate}.csv`;

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send('\uFEFF' + csvContent); // BOM 추가로 한글 깨짐 방지

    } catch (error) {
      console.error('Get lecture download error:', error);
      res.status(500).json({
        success: false,
        message: '강의 다운로드 데이터를 가져오는 중 오류가 발생했습니다.'
      });
    }
  });

  // 일반 다운로드 (CSV)
  router.get('/download', async (req, res) => {
    try {
      const { universityId, startDate, endDate } = req.query;

      if (!universityId || !startDate || !endDate) {
        return res.status(400).json({
          success: false,
          message: '대학교, 시작일, 종료일을 모두 선택해주세요.'
        });
      }

      const universityIdNum = parseInt(universityId);

      const [downloadResult] = await pool.execute(
        `SELECT 
          DATE_FORMAT(study_date, '%Y-%m-%d') as study_date,
          university_id,
          school_name,
          account,
          student_name,
          student_no,
          study_type,
          piece_id,
          piece_name,
          subject_group,
          CAST(total_questions AS UNSIGNED) as total_questions,
          CAST(original_questions AS UNSIGNED) as original_questions,
          CAST(similar_questions AS UNSIGNED) as similar_questions,
          CAST(original_correct AS UNSIGNED) as original_correct,
          CAST(similar_correct AS UNSIGNED) as similar_correct,
          CAST(total_correct AS UNSIGNED) as total_correct,
          CAST(total_accuracy AS DECIMAL(5,2)) as total_accuracy,
          CAST(original_accuracy AS DECIMAL(5,2)) as original_accuracy,
          CAST(similar_accuracy AS DECIMAL(5,2)) as similar_accuracy
        FROM pulley_statistic.htht_daily_piece_problem_history 
        WHERE university_id = ? AND study_date BETWEEN ? AND ?
        ORDER BY study_date DESC, account`,
        [universityIdNum, startDate, endDate]
      );

      // CSV 헤더
      const headers = [
        '학습일자', '대학교', '학교명', '계정', '학생명', '학번', '학습유형', '학습지id', '학습지명', '과목군',
        '전체풀이수', '원본풀이수', '유사풀이수',
        '원본정답수', '유사정답수', '전체정답수', '전체정답률', '원본정답률', '유사정답률'
      ];

      // CSV 데이터 생성
      const csvRows = [headers.join(',')];
      
      downloadResult.forEach(row => {
        const csvRow = [
          row.study_date || '',
          row.university_id,
          `"${row.school_name || ''}"`,
          `"${row.account || ''}"`,
          `"${row.student_name || ''}"`,
          `"${row.student_no || ''}"`,
          `"${row.study_type || ''}"`,
          `"${row.piece_id || ''}"`,
          `"${row.piece_name || ''}"`,
          `"${row.subject_group || ''}"`,
          row.total_questions || 0,
          row.original_questions || 0,
          row.similar_questions || 0,
          // row.total_solved || 0,
          // row.original_solved || 0,
          // row.similar_solved || 0,
          row.original_correct || 0,
          row.similar_correct || 0,
          row.total_correct || 0,
          row.total_accuracy || 0,
          row.original_accuracy || 0,
          row.similar_accuracy || 0
        ];
        csvRows.push(csvRow.join(','));
      });

      const csvContent = csvRows.join('\n');
      const filename = `problem_history_${startDate}_${endDate}.csv`;

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send('\uFEFF' + csvContent); // BOM 추가로 한글 깨짐 방지

    } catch (error) {
      console.error('Get download error:', error);
      res.status(500).json({
        success: false,
        message: '다운로드 데이터를 가져오는 중 오류가 발생했습니다.'
      });
    }
  });

  return router;
};

export default dataRoutes;
