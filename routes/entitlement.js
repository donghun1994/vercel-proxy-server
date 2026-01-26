import express from 'express';

const entitlementRoutes = (pool) => {
  const router = express.Router();

  const MAX_LIMIT = 500;

  const parsePagingParams = (page = 1, limit = 50) => {
    const parsedPage = parseInt(page, 10);
    const parsedLimit = parseInt(limit, 10);
    const safePage = Number.isNaN(parsedPage) ? 1 : parsedPage;
    const safeLimit = Number.isNaN(parsedLimit) ? 50 : parsedLimit;
    const pageNum = Math.max(1, safePage);
    const limitNum = Math.max(1, Math.min(MAX_LIMIT, safeLimit));
    const offset = (pageNum - 1) * limitNum;
    return { pageNum, limitNum, offset };
  };

  const parseSubjectIds = (subjectIdsRaw) => {
    if (!subjectIdsRaw) return [];
    return subjectIdsRaw
      .split(',')
      .map((v) => parseInt(v.trim()))
      .filter((v) => !Number.isNaN(v));
  };

  const parseCsvStrings = (raw) => {
    if (!raw) return [];
    return raw
      .split(',')
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
  };

  const buildProblemBaseQuery = ({ includeLimit = true, subjectIdArray, limitNum, offset }) => {
    const subjectFilter = subjectIdArray.length
      ? `AND subject_id IN (${subjectIdArray.map(() => '?').join(',')})`
      : '';

    const limitClause = includeLimit ? `LIMIT ${limitNum} OFFSET ${offset}` : '';

    const query = `
      SELECT
        id,
        subject_group,
        subject_id,
        subject_name,
        large_chapter_name,
        middle_chapter_name,
        small_chapter_name,
        unit_name,
        unit_code,
        lv1_count,
        lv2_count,
        lv3_count,
        lv4_count,
        lv5_count,
        total_count,
        DATE_FORMAT(snapshot_date, '%Y-%m-%d') AS snapshot_date,
        DATE_FORMAT(created_dt, '%Y-%m-%d %H:%i:%s') AS created_dt,
        DATE_FORMAT(updated_dt, '%Y-%m-%d %H:%i:%s') AS updated_dt,
        COALESCE(subject_name, large_chapter_name, middle_chapter_name, small_chapter_name, unit_name, '-') AS display_subject_name,
        COALESCE(large_chapter_name, middle_chapter_name, small_chapter_name, unit_name, '-') AS display_large_chapter_name,
        COALESCE(middle_chapter_name, '-') AS display_middle_chapter_name,
        COALESCE(small_chapter_name, '-') AS display_small_chapter_name,
        COALESCE(unit_name, '-') AS display_unit_name
      FROM pulley_statistic.htht_problem_entitlement_current
      WHERE subject_group = ?
      ${subjectFilter}
      ORDER BY display_subject_name, display_large_chapter_name, display_middle_chapter_name, display_small_chapter_name, display_unit_name
      ${limitClause}
    `;
    return query;
  };

  // 문제풀이 현황 조회
  router.get('/problems', async (req, res) => {
    try {
      const { subjectGroup, subjectIds, page = 1, limit = 50, full = 'false' } = req.query;

      if (!subjectGroup) {
        return res.status(400).json({
          success: false,
          message: '과목군(subjectGroup)을 선택해주세요.'
        });
      }

      const subjectIdArray = parseSubjectIds(subjectIds);
      const { pageNum, limitNum, offset } = parsePagingParams(page, limit);
      const includeLimit = full !== 'true';

      const baseParams = [subjectGroup];
      const listParams = subjectIdArray.length ? [...baseParams, ...subjectIdArray] : baseParams;
      const countParams = subjectIdArray.length ? [...baseParams, ...subjectIdArray] : baseParams;

      const [rows] = await pool.execute(
        buildProblemBaseQuery({
          includeLimit,
          limitNum,
          offset,
          subjectIdArray
        }),
        listParams
      );

      const [countRows] = await pool.execute(
        `SELECT COUNT(*) AS total
         FROM pulley_statistic.htht_problem_entitlement_current
         WHERE subject_group = ?
         ${subjectIdArray.length ? `AND subject_id IN (${subjectIdArray.map(() => '?').join(',')})` : ''}`,
        countParams
      );

      const total = includeLimit ? (countRows[0]?.total || 0) : rows.length;
      const totalPages = includeLimit ? Math.ceil(total / limitNum) : 1;

      res.json({
        success: true,
        data: {
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
      console.error('Get entitlement problems error:', error);
      res.status(500).json({
        success: false,
        message: '문제풀이 현황을 가져오는 중 오류가 발생했습니다.'
      });
    }
  });

  // 문제풀이 현황 CSV 다운로드
  router.get('/problems/download', async (req, res) => {
    try {
      const { subjectGroup, subjectIds } = req.query;

      if (!subjectGroup) {
        return res.status(400).json({
          success: false,
          message: '과목군(subjectGroup)을 선택해주세요.'
        });
      }

      const subjectIdArray = parseSubjectIds(subjectIds);
      const baseParams = [subjectGroup];
      const listParams = subjectIdArray.length ? [...baseParams, ...subjectIdArray] : baseParams;

      const [rows] = await pool.execute(
        buildProblemBaseQuery({
          includeLimit: false,
          subjectIdArray
        }),
        listParams
      );

      const headers = [
        'subject_group',
        'subject_id',
        'display_subject_name',
        'display_large_chapter_name',
        'display_middle_chapter_name',
        'display_small_chapter_name',
        'display_unit_name',
        'unit_code',
        'lv1_count',
        'lv2_count',
        'lv3_count',
        'lv4_count',
        'lv5_count',
        'total_count'
      ];

      const csvRows = [headers.join(',')];

      rows.forEach((row) => {
        const csvRow = [
          row.subject_group ?? '',
          row.subject_id ?? '',
          `"${row.display_subject_name ?? ''}"`,
          `"${row.display_large_chapter_name ?? ''}"`,
          `"${row.display_middle_chapter_name ?? ''}"`,
          `"${row.display_small_chapter_name ?? ''}"`,
          `"${row.display_unit_name ?? ''}"`,
          `"${row.unit_code ?? ''}"`,
          row.lv1_count ?? 0,
          row.lv2_count ?? 0,
          row.lv3_count ?? 0,
          row.lv4_count ?? 0,
          row.lv5_count ?? 0,
          row.total_count ?? 0
        ];
        csvRows.push(csvRow.join(','));
      });

      const csvContent = csvRows.join('\n');
      const filename = `problems_entitlement_${subjectGroup}_${Date.now()}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send('\uFEFF' + csvContent);
    } catch (error) {
      console.error('Download entitlement problems error:', error);
      res.status(500).json({
        success: false,
        message: '문제풀이 현황 CSV 생성 중 오류가 발생했습니다.'
      });
    }
  });

  // 개념학습 카테고리 목록
  router.get('/concepts/categories', async (req, res) => {
    try {
      const { subjectGroup } = req.query;

      if (!subjectGroup) {
        return res.status(400).json({
          success: false,
          message: '과목군(subjectGroup)을 선택해주세요.'
        });
      }

      const [rows] = await pool.execute(
        `
        SELECT
          subject_group,
          subject_category,
          COUNT(DISTINCT subject_name) AS subject_count,
          COUNT(*) AS row_count
        FROM pulley_statistic.htht_problem_entitlement_current
        WHERE subject_group = ?
        GROUP BY subject_group, subject_category
        ORDER BY subject_category
        `,
        [subjectGroup]
      );

      res.json({ success: true, data: rows });
    } catch (error) {
      console.error('Get entitlement concept categories error:', error);
      res.status(500).json({
        success: false,
        message: '개념학습 카테고리 조회 중 오류가 발생했습니다.'
      });
    }
  });

  // 개념학습 현황 조회
  router.get('/concepts', async (req, res) => {
    try {
      const { subjectGroup, subjectCategory, subjectCategories, page = 1, limit = 50 } = req.query;

      if (!subjectGroup) {
        return res.status(400).json({
          success: false,
          message: '과목군(subjectGroup)을 선택해주세요.'
        });
      }

      const categories = parseCsvStrings(subjectCategories || subjectCategory);
      const { pageNum, limitNum, offset } = parsePagingParams(page, limit);

      let categoryFilter = '';
      const listParams = [subjectGroup];
      const countParams = [subjectGroup];
      if (categories.length === 1) {
        categoryFilter = 'AND subject_category = ?';
        listParams.push(categories[0]);
        countParams.push(categories[0]);
      } else if (categories.length > 1) {
        categoryFilter = `AND subject_category IN (${categories.map(() => '?').join(',')})`;
        listParams.push(...categories);
        countParams.push(...categories);
      }
      const limitClause = `LIMIT ${limitNum} OFFSET ${offset}`;
      const [rows] = await pool.execute(
        `
        SELECT
          subject_group,
          subject_category,
          subject_name,
          COALESCE(large_chapter_name, '-') AS large_chapter_name,
          COALESCE(middle_chapter_name, '-') AS middle_chapter_name,
          COALESCE(small_chapter_name, '-') AS small_chapter_name,
          COUNT(*) AS concept_count
        FROM pulley_statistic.htht_concept_entitlement_current
        WHERE subject_group = ?
        ${categoryFilter}
        GROUP BY subject_group, subject_category, subject_name, large_chapter_name, middle_chapter_name, small_chapter_name
        ORDER BY subject_name, large_chapter_name, middle_chapter_name, small_chapter_name
        ${limitClause}
        `,
        listParams
      );

      const [countRows] = await pool.execute(
        `
        SELECT COUNT(*) AS total FROM (
          SELECT 1
          FROM pulley_statistic.htht_concept_entitlement_current
          WHERE subject_group = ?
          ${categoryFilter}
          GROUP BY subject_group, subject_category, subject_name, large_chapter_name, middle_chapter_name, small_chapter_name
        ) AS grouped
        `,
        countParams
      );

      const total = countRows[0]?.total || 0;
      const totalPages = Math.ceil(total / limitNum);

      res.json({
        success: true,
        data: {
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
      console.error('Get entitlement concepts error:', error);
      res.status(500).json({
        success: false,
        message: '개념학습 현황을 가져오는 중 오류가 발생했습니다.'
      });
    }
  });

  // 개념학습 현황 CSV 다운로드
  router.get('/concepts/download', async (req, res) => {
    try {
      const { subjectGroup, subjectCategory, subjectCategories } = req.query;

      if (!subjectGroup) {
        return res.status(400).json({
          success: false,
          message: '과목군(subjectGroup)을 선택해주세요.'
        });
      }

      const categories = parseCsvStrings(subjectCategories || subjectCategory);
      let categoryFilter = '';
      const listParams = [subjectGroup];
      if (categories.length === 1) {
        categoryFilter = 'AND subject_category = ?';
        listParams.push(categories[0]);
      } else if (categories.length > 1) {
        categoryFilter = `AND subject_category IN (${categories.map(() => '?').join(',')})`;
        listParams.push(...categories);
      }

      const [rows] = await pool.execute(
        `
        SELECT
          subject_group,
          subject_category,
          subject_name,
          COALESCE(large_chapter_name, '-') AS large_chapter_name,
          COALESCE(middle_chapter_name, '-') AS middle_chapter_name,
          COALESCE(small_chapter_name, '-') AS small_chapter_name,
          COUNT(*) AS concept_count
        FROM pulley_statistic.htht_concept_entitlement_current
        WHERE subject_group = ?
        ${categoryFilter}
        GROUP BY subject_group, subject_category, subject_name, large_chapter_name, middle_chapter_name, small_chapter_name
        ORDER BY subject_name, large_chapter_name, middle_chapter_name, small_chapter_name
        `,
        listParams
      );

      const headers = [
        'subject_group',
        'subject_category',
        'subject_name',
        'large_chapter_name',
        'middle_chapter_name',
        'small_chapter_name'
      ];

      const csvRows = [headers.join(',')];

      rows.forEach((row) => {
        const csvRow = [
          row.subject_group ?? '',
          `"${row.subject_category ?? ''}"`,
          `"${row.subject_name ?? ''}"`,
          `"${row.large_chapter_name ?? ''}"`,
          `"${row.middle_chapter_name ?? ''}"`,
          `"${row.small_chapter_name ?? ''}"`
        ];
        csvRows.push(csvRow.join(','));
      });

      const csvContent = csvRows.join('\n');
      const filename = `concepts_entitlement_${subjectGroup}_${Date.now()}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send('\uFEFF' + csvContent);
    } catch (error) {
      console.error('Download entitlement concepts error:', error);
      res.status(500).json({
        success: false,
        message: '개념학습 현황 CSV 생성 중 오류가 발생했습니다.'
      });
    }
  });

  return router;
};

export default entitlementRoutes;

